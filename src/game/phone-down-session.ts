/**
 * Phone-down session controller — orchestrates the pure machine, the sensor
 * providers and the offline queue for one armed session.
 *
 * Lifecycle: `arm(sessionId)` once the server session exists → providers
 * stream edges into `feedEdge` → AppState suspend/resume updates coverage
 * (FGS drain on Android, retro query on iOS) → spans/violations are
 * persisted to the queue as they are recorded (survives kill) → `stop()`
 * flushes the queue so evidence lands before the session closes.
 *
 * React-free so it stays unit-testable; the screen holds it in a lazy
 * useState singleton (survives re-renders, drives effects via onStateChange).
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';

import type { PhoneDownSpanPayload, PhoneDownViolationPayload } from '@/api/types';
import type { EventQueue } from './event-queue';
import {
  CoverageTracker,
  PhoneDownMachine,
  resolveSpanTier,
  type Evidence,
  type PhoneDownSpan,
  type PhoneDownState,
  type PhoneDownViolation,
  type SuspensionGap,
  type Tier,
} from './phone-down';
import type { OrientationEdgeEvent, OrientationProvider, RetroProvider } from './sensors/types';
import { AccelerometerOrientationProvider } from './sensors/accelerometer';
import { ProximityOrientationProvider } from './sensors/proximity';
import { FocusServiceProvider } from './sensors/focus-service';
import { MotionRecorderProvider } from './sensors/motion-recorder';

export interface ResolvedSpan extends PhoneDownSpan {
  tier: Tier;
  evidence: Evidence;
}

export interface PhoneDownSummary {
  sessionId: number;
  spans: ResolvedSpan[];
  violations: PhoneDownViolation[];
  /** True when the event queue still holds unsent events after flush. */
  syncFailed: boolean;
  /** Enqueue writes that failed outright (durable storage fault) — an
   *  honest count, since these spans/violations can never reach the server. */
  evidenceDropped: number;
}

export interface PhoneDownSessionDeps {
  queue: EventQueue;
  orientation?: OrientationProvider[];
  retro?: RetroProvider[];
  now?: () => number;
  /** Poll interval for draining the FGS transition buffer (foreground). */
  drainPollMs?: number;
  onStateChange?: (s: PhoneDownSession) => void;
}

/** Default provider stack — dev-build providers report themselves
 *  unavailable in Expo Go and are skipped at arm time. */
export function defaultOrientationProviders(): OrientationProvider[] {
  return [
    new AccelerometerOrientationProvider(),
    new ProximityOrientationProvider(),
    new FocusServiceProvider(),
  ];
}

export function defaultRetroProviders(): RetroProvider[] {
  return [new MotionRecorderProvider()];
}

/** Sub-2s spans are sensor flick (proximity edges skip the accel dwell) —
 *  kept in the summary, never reported to the server. */
export const MIN_SPAN_MS = 2_000;
/** Accelerometer silence beyond this while foreground means the stream
 *  died — live coverage ends at the last sample. */
const STREAM_DEAD_MS = 1_500;
/** A drain proof this fresh counts as the covering service being alive
 *  at resume — a NOT_STICKY service cannot restart, so alive-at-drain
 *  proves it covered the whole suspended interval. */
const COVERAGE_PROOF_FRESH_MS = 30_000;
/** Mirrors FocusSessionService.HEARTBEAT_MS — the covering FGS emits a
 *  liveness row this often, so a silent mid-foreground death takes up to
 *  one heartbeat plus the freshness bound to notice. */
const HEARTBEAT_MS = 60_000;

export class PhoneDownSession {
  private readonly queue: EventQueue;
  private readonly orientationProviders: OrientationProvider[];
  private readonly retroProviders: RetroProvider[];
  private readonly now: () => number;
  private readonly drainPollMs: number;
  private readonly onStateChange: (s: PhoneDownSession) => void;

  readonly machine: PhoneDownMachine;
  private readonly tracker = new CoverageTracker();

  private sessionId: number | null = null;
  private runningProviders: OrientationProvider[] = [];
  private runningRetro: RetroProvider[] = [];
  private spans: ResolvedSpan[] = [];
  private violations: PhoneDownViolation[] = [];
  private suspendedAt: number | null = null;
  /** Newest liveness proof seen in any provider DRAIN (heartbeat rows and
   *  the drain-time stamp). A covering provider that can't produce one at
   *  resume died mid-gap — coverage claims end at the last proof. Only a
   *  real drain may set this; the arm-time optimism lives in
   *  coverageTrustSeed so it can't satisfy coverageProven. */
  private coverageProofTs: number | null = null;
  /** Arm-time liveness bound for a covering provider that hasn't produced
   *  a drain proof yet — bounds detection latency (dead-at-birth is
   *  unmasked within one heartbeat+freshness), never a coverage proof. */
  private coverageTrustSeed: number | null = null;
  /** In-flight evidence writes — flush must see them inside events before
   *  posting, so emitEvidence awaits them all first. */
  private pendingEnqueues: Promise<unknown>[] = [];
  /** Bumped on every arm/disarm — a stale arm's in-flight continuation
   *  must not push providers into the next session's runningProviders. */
  private armGen = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;

  constructor(deps: PhoneDownSessionDeps) {
    this.queue = deps.queue;
    this.orientationProviders = deps.orientation ?? defaultOrientationProviders();
    this.retroProviders = deps.retro ?? defaultRetroProviders();
    this.now = deps.now ?? Date.now;
    this.drainPollMs = deps.drainPollMs ?? 2000;
    this.onStateChange = deps.onStateChange ?? (() => {});
    this.machine = new PhoneDownMachine({
      onSpanClosed: (span) => this.onSpanClosed(span),
      onViolation: (v) => {
        this.violations.push(v);
        this.enqueueViolation(v);
      },
    });
  }

  get state(): PhoneDownState {
    return this.machine.state;
  }

  get activeProviderNames(): string[] {
    return this.runningProviders.map((p) => p.name);
  }

  /** True while at least one running provider can prove it is still
   *  delivering — feeds the honesty chip. A continuous emitter gone silent
   *  (dead stream) or a covering service past its heartbeat bound can't
   *  claim verified; mirrors the liveness bound resolveSpanTier applies. */
  get liveCovering(): boolean {
    if (this.runningProviders.length === 0) return false;
    return this.liveBounds(this.now()).live;
  }

  /** Per-provider liveness folded across the stack:
   *  - covering (FGS): provable via DRAIN proofs only; the arm-time seed
   *    bounds detection latency while no proof exists (stale bound).
   *  - continuous emitter: provable via its sample clock (STREAM_DEAD_MS).
   *  - event-driven, no clock: presence trusted — can't be probed.
   *  When nothing is provably live, `bound` is the newest provable
   *  instant — where the coverage window honestly ends. */
  private liveBounds(now: number): { live: boolean; bound: number | null } {
    let bound: number | null = null;
    for (const p of this.runningProviders) {
      if (p.coversSuspension) {
        const provable = this.coverageProofTs ?? this.coverageTrustSeed;
        if (provable === null) continue;
        bound = Math.max(bound ?? provable, provable);
        if (now - provable <= HEARTBEAT_MS + COVERAGE_PROOF_FRESH_MS) {
          return { live: true, bound: null };
        }
        continue;
      }
      const last = p.lastSampleAt;
      if (last === undefined || last === null) return { live: true, bound: null };
      bound = Math.max(bound ?? last, last);
      if (now - last <= STREAM_DEAD_MS) return { live: true, bound: null };
    }
    return { live: false, bound };
  }

  graceRemainingMs(): number | null {
    return this.machine.graceRemainingMs(this.now());
  }

  /**
   * Arm for a server session that already exists. Starts every available
   * orientation provider + the retro recorder, and subscribes AppState.
   */
  async arm(sessionId: number): Promise<boolean> {
    if (this.machine.state !== 'idle') return false;
    const gen = ++this.armGen;
    this.sessionId = sessionId;
    this.spans = [];
    this.violations = [];
    this.suspendedAt = null;
    this.coverageProofTs = null;
    this.coverageTrustSeed = null;
    this.tracker.reset();
    this.machine.arm();
    // Attach BEFORE the first await — a suspend landing inside the provider
    // starts (the POST_NOTIFICATIONS prompt can hold this window open for
    // user-time) must record suspendedAt, or the live window opened below
    // claims verified over time nobody covered.
    this.appStateSub = AppState.addEventListener('change', (s) =>
      this.handleAppState(s).catch(() => {}),
    );
    // Same suspending predicate as handleAppState — iOS 'inactive'
    // (Control Center / shade) isn't a real backgrounding there either.
    const cur = AppState.currentState;
    const suspended = Platform.OS !== 'ios' ? cur !== 'active' : cur === 'background';
    if (suspended) {
      this.suspendedAt = this.now();
      if (!this.anyCoversSuspension()) this.tracker.suspend(this.now());
    }

    const available = await Promise.all(
      this.orientationProviders.map(async (p) => ((await p.isAvailable()) ? p : null)),
    );
    // Providers this arm actually started — a stale continuation must
    // stop ONLY these; shared fields may already belong to a newer arm.
    const startedHere: OrientationProvider[] = [];
    const retroHere: RetroProvider[] = [];
    const bailIfStale = async (): Promise<boolean> => {
      if (gen === this.armGen) return false;
      await Promise.all([
        ...startedHere.map((p) => p.stop().catch(() => {})),
        ...retroHere.map((r) => r.stopRecording().catch(() => {})),
      ]);
      return true;
    };
    for (const provider of available) {
      if (!provider) continue;
      try {
        await provider.start((e) => this.feedEdge(e));
        startedHere.push(provider);
        if (await bailIfStale()) return false;
        this.runningProviders.push(provider);
        // Live coverage starts at the FIRST provider up — an event-driven
        // edge (proximity 'near' on registration) or a slow later start
        // (the FGS's permission prompt) must not open uncovered spans.
        if (this.runningProviders.length === 1) this.tracker.liveStart(this.now());
      } catch {
        // A provider that lies about availability just doesn't join.
      }
    }
    // A covering provider's liveness bound starts AT ARM, not at first
    // proof — a service dead-at-birth (or a drain that never returns one)
    // is trusted for at most heartbeat+freshness, never indefinitely.
    // The seed bounds LIVENESS DETECTION only: it can never satisfy
    // coverageProven — a resumed gap still needs a real drain stamp.
    if (this.anyCoversSuspension() && this.coverageTrustSeed === null) {
      this.coverageTrustSeed = this.now();
    }
    // A covering FGS on Android buffers the same orientation edges the
    // live proximity listener emits — running both double-feeds the
    // machine (down→up→down inside one drain window would replay as
    // fabricated spans). The FGS is the honest Android source.
    if (this.anyCoversSuspension()) {
      const dup = this.runningProviders.filter((p) => p.name === 'proximity');
      this.runningProviders = this.runningProviders.filter((p) => p.name !== 'proximity');
      await Promise.all(dup.map((p) => p.stop().catch(() => {})));
    }
    if (await bailIfStale()) return false;
    // A stop() landing mid-arm leaves the machine idle while sensors keep
    // streaming — tear down what we started and bail.
    if (this.machine.state === 'idle') {
      this.sessionId = null;
      await this.teardown(this.now());
      return false;
    }
    if (this.runningProviders.length === 0) {
      // Zero live coverage can ever exist — an armed overlay claiming
      // verification is a lie. Unwind to idle and refuse the arm.
      this.machine.dispatch({ type: 'STOP', ts: this.now() });
      this.sessionId = null;
      await this.teardown(this.now());
      return false;
    }

    for (const retro of this.retroProviders) {
      try {
        if (await retro.isAvailable()) {
          await retro.startRecording();
          retroHere.push(retro);
          if (await bailIfStale()) return false;
          this.runningRetro.push(retro);
        }
      } catch {
        // Recording failed — gaps for this session resolve 'unknown'.
      }
    }
    if (this.machine.state === 'idle') {
      this.sessionId = null;
      await this.teardown(this.now());
      return false;
    }

    this.scheduleDrainPoll();
    this.onStateChange(this);
    return true;
  }

  /**
   * Feed one orientation edge into the machine. A late FACE_DOWN (ts past
   * the grace deadline — sensor dwell or buffered replay) must let grace
   * expire FIRST so the closed span is marked violated correctly.
   */
  feedEdge(e: OrientationEdgeEvent): void {
    const deadline = this.machine.graceDeadlineMs;
    if (this.machine.state === 'grace' && deadline !== null && e.ts >= deadline) {
      this.machine.dispatch({ type: 'GRACE_EXPIRED', ts: deadline });
    }
    this.machine.dispatch({ type: e.edge === 'face_down' ? 'FACE_DOWN' : 'PICKED_UP', ts: e.ts });
    this.afterTransition();
  }

  private afterTransition(): void {
    // Grace timer while foreground; cancelled when grace resolves.
    if (this.machine.state === 'grace') {
      const deadline = this.machine.graceDeadlineMs;
      if (deadline !== null && this.graceTimer === null) {
        this.graceTimer = setTimeout(
          () => {
            this.graceTimer = null;
            this.expireGraceLive(deadline);
          },
          Math.max(0, deadline - this.now()),
        );
      }
    } else if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    this.onStateChange(this);
  }

  /** Live grace expiry. Corroboration veto: a continuous emitter still
   *  reading face-down at the deadline means the pickup edge was a blip
   *  (desk-edge / earpiece proximity) — real pickups tilt the gravity
   *  vector, so a full grace of 'down' wins over one 'far' edge. The
   *  resume path (settleGraceIfDue) stays unconditional: still-flat NOW
   *  can't prove the phone was never lifted while suspended. */
  private expireGraceLive(deadline: number): void {
    const now = this.now();
    const corroborated = this.runningProviders.some(
      (p) =>
        p.stillFlat === true && p.lastSampleAt != null && now - p.lastSampleAt <= STREAM_DEAD_MS,
    );
    this.machine.dispatch(
      corroborated ? { type: 'FACE_DOWN', ts: now } : { type: 'GRACE_EXPIRED', ts: deadline },
    );
    this.afterTransition();
  }

  /** Pickup outlasted grace while JS couldn't run — settle on resume/stop. */
  private settleGraceIfDue(nowTs: number): void {
    const deadline = this.machine.graceDeadlineMs;
    if (this.machine.state === 'grace' && deadline !== null && nowTs >= deadline) {
      this.machine.dispatch({ type: 'GRACE_EXPIRED', ts: deadline });
      this.afterTransition();
    }
  }

  private async handleAppState(next: AppStateStatus): Promise<void> {
    if (this.machine.state === 'idle') return;
    const now = this.now();
    if (next === 'active') {
      if (this.suspendedAt === null) return;
      const gapFrom = this.suspendedAt;
      this.suspendedAt = null;
      if (this.anyCoversSuspension()) {
        // Android FGS buffered the real transitions — replay them in order.
        await this.drainBuffers();
        // A suspend landing mid-drain owns the real coverage story now —
        // writing windows/gaps off this stale resume would corrupt both.
        if (this.suspendedAt !== null) return;
        if (this.coverageProven(now)) {
          // The FGS covered the gap — replayed transitions already fed real
          // edges. Mark the suspended interval covered and reopen the live
          // window: it may have closed at suspend if the covering provider
          // hadn't joined yet (start() still in flight).
          const gap = this.tracker.resume(now, this.runningProviders.length > 0);
          if (gap !== null) this.tracker.resolveGap(gap, 'stayed_flat');
        } else {
          // The covering service died mid-gap: buffered rows prove coverage
          // only up to the last one — the unproven tail becomes a gap no
          // Android retro can resolve, so it lands unverified.
          const provenUntil = Math.min(this.coverageProofTs ?? gapFrom, now);
          this.tracker.suspend(provenUntil);
          const gap = this.tracker.resume(now, this.runningProviders.length > 0);
          if (gap !== null) await this.resolveGap(gap);
        }
      } else {
        const gap = this.tracker.resume(now, this.runningProviders.length > 0);
        if (gap !== null) {
          await this.resolveGap(gap);
        }
      }
      this.settleGraceIfDue(now);
      // The suspend cleared any pending grace timer — a resume INSIDE the
      // window leaves the machine in `grace` with no timer, wedging the
      // overlay until an unrelated edge lands. afterTransition re-arms.
      this.afterTransition();
    } else {
      // iOS fires 'inactive' for Control Center / the notification shade —
      // seconds-long interruptions where the accelerometer still delivers.
      // Only a real backgrounding ends coverage there; any non-'active'
      // state on Android (this branch already excluded 'active') suspends.
      const suspending = Platform.OS !== 'ios' || next === 'background';
      if (!suspending) return;
      // First suspending event owns the gap start — a second (Android
      // 'inactive' then 'background') must not slide it forward and leave
      // the earlier stretch outside any recorded gap.
      if (this.suspendedAt === null) this.suspendedAt = now;
      // A stale grace fire must not preempt the buffered replay at resume —
      // settleGraceIfDue runs after the drain and decides from real ts.
      if (this.graceTimer !== null) {
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
      }
      if (!this.anyCoversSuspension()) this.tracker.suspend(now);
    }
  }

  private anyCoversSuspension(): boolean {
    return this.runningProviders.some((p) => p.coversSuspension);
  }

  /**
   * True only when a drain produced a proof stamped at/after the gap's
   * end — on Android that's the heartbeat the drain itself appends while
   * the FGS is alive (START_NOT_STICKY ⇒ alive-at-drain ⇒ it covered the
   * whole gap). A proof from before the gap closed (last buffered row of
   * a service that died mid-gap) can never satisfy this.
   */
  private coverageProven(gapEnd: number): boolean {
    return this.coverageProofTs !== null && this.coverageProofTs >= gapEnd;
  }

  /** Serialized so overlapping callers (2s poll, resume, stop/disarm) can't
   *  race the native drain — focus-service's toList→removeAll isn't atomic,
   *  so two concurrent drains could replay the same rows into the machine:
   *  duplicated spans and fabricated grace_expired violations. Each caller
   *  queues its own drain after the previous completes. */
  private draining: Promise<void> = Promise.resolve();

  private drainBuffers(): Promise<void> {
    const p = this.draining.then(() => this.doDrainBuffers());
    this.draining = p.catch(() => {});
    return p;
  }

  private async doDrainBuffers(): Promise<void> {
    for (const provider of this.runningProviders) {
      if (!provider.drainTransitions) continue;
      try {
        // Bound each native IPC: a never-resolving drain wedges the whole
        // serialized chain — poll, resume, and stop() behind it forever.
        // A drain resolving AFTER the timeout may still have consumed
        // rows natively; those are lost under-claims, never fabrications.
        const drain = await Promise.race([
          provider.drainTransitions(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
        ]);
        if (drain === null) continue;
        for (const t of drain.transitions) {
          this.feedEdge({ edge: t.near ? 'face_down' : 'picked_up', ts: t.ts });
        }
        if (drain.lastProofTs !== null) {
          this.coverageProofTs = Math.max(this.coverageProofTs ?? 0, drain.lastProofTs);
        }
      } catch {
        // One throwing provider must not starve the others' buffered edges.
      }
    }
  }

  private async resolveGap(gap: SuspensionGap): Promise<void> {
    for (const retro of this.runningRetro) {
      try {
        const verdict = await retro.verifyGap(gap.from, gap.to);
        if (verdict !== 'unknown') {
          this.tracker.resolveGap(gap, verdict);
          if (verdict === 'moved') {
            this.machine.dispatch({ type: 'EXTERNAL_VIOLATION', ts: gap.to, kind: 'pickup' });
            this.afterTransition();
          }
          return;
        }
      } catch {
        // A provider that can't answer leaves the gap 'unknown' — try the next.
      }
    }
    // No retro proof available — gap stays 'unknown' → unverified spans.
  }

  private scheduleDrainPoll(): void {
    this.drainTimer = setInterval(() => void this.drainBuffers().catch(() => {}), this.drainPollMs);
  }

  /**
   * A span just closed — bound its live coverage to provider liveness
   * before resolving the tier. A continuous emitter (accelerometer) that
   * went silent is dead: coverage ends at its last sample, and the dead
   * tail downgrades the span to unverified rather than claiming a window
   * nobody was covering.
   */
  private onSpanClosed(span: PhoneDownSpan): void {
    this.syncLiveCoverageLiveness(this.now());
    const { tier, evidence } = resolveSpanTier(span, this.tracker);
    const resolved = { ...span, tier, evidence };
    this.spans.push(resolved);
    this.enqueueSpan(resolved);
  }

  /**
   * Close the open live window when every running provider exposes a
   * sample clock and all of them have been silent past STREAM_DEAD_MS.
   * Event-driven providers (undefined lastSampleAt) can't be probed this
   * way — their presence keeps the window trusted.
   */
  private syncLiveCoverageLiveness(nowTs: number): void {
    if (this.runningProviders.length === 0) return;
    const { live, bound } = this.liveBounds(nowTs);
    if (!live) {
      // Dead stack — coverage ends at the newest provable instant; the
      // tail it can't prove downgrades rather than claiming a window
      // nobody covered. A covering FGS's drain proof, a dead-at-birth
      // seed bound, and continuous sample clocks all compete honestly.
      if (bound !== null) this.tracker.liveEnd(bound);
      return;
    }
    // Live: no-op while the window is open; a recovered provider reopens
    // it at now — the stretch between last proof and recovery stays
    // unproven and correctly downgrades to unverified.
    if (this.suspendedAt === null) this.tracker.liveStart(nowTs);
  }

  /**
   * Persist a closed span the moment it resolves — evidence in the queue
   * survives an app kill; dedupe on client_event_id makes the enqueue
   * idempotent. Sub-2s flick spans (proximity edges bypass the accel
   * dwell) are machine noise and never leave the device.
   */
  private enqueueSpan(span: ResolvedSpan): void {
    const sessionId = this.sessionId;
    if (sessionId === null || span.end_ts - span.start_ts < MIN_SPAN_MS) return;
    const payload: PhoneDownSpanPayload = {
      session_id: sessionId,
      start_ts: new Date(span.start_ts).toISOString(),
      end_ts: new Date(span.end_ts).toISOString(),
      claimed_tier: span.tier,
      evidence: span.evidence,
    };
    this.track(this.queue.enqueue('phone_down_span', { ...payload }));
  }

  private enqueueViolation(v: PhoneDownViolation): void {
    const sessionId = this.sessionId;
    if (sessionId === null) return;
    const payload: PhoneDownViolationPayload = {
      session_id: sessionId,
      at_ts: new Date(v.at_ts).toISOString(),
      kind: v.kind,
    };
    this.track(this.queue.enqueue('phone_down_violation', { ...payload }));
  }

  /** Record a fire-and-forget write — failures surface through the queue's
   *  pending count / flush result, not as unhandled rejections. The flag
   *  lets emitEvidence count drops inside ITS OWN batch: a rejection
   *  landing after the snapshot belongs to the closing session's batch
   *  (its promise was swapped into it), not the next arm's counter. */
  private track(p: Promise<unknown>): void {
    this.pendingEnqueues.push(
      p.then(
        () => true,
        () => false,
      ),
    );
  }

  /**
   * End the armed session: drain, settle, close the open span, tear down
   * providers, then flush the queue so queued evidence lands before the
   * session stops. Returns the resolved summary for the end-of-session card.
   */
  async stop(): Promise<PhoneDownSummary> {
    const now = this.now();
    this.armGen++;
    await this.drainBuffers().catch(() => {});
    this.settleGraceIfDue(now);
    if (this.machine.state !== 'idle') {
      this.machine.dispatch({ type: 'STOP', ts: now });
    }
    // Snapshot + clear the closing session's identity and evidence in the
    // same synchronous section — a re-arm during teardown's awaits then
    // owns this.sessionId/spans/violations outright (even a same-id re-arm:
    // OFF→ON and pause→resume reuse session.id), and the emit below works
    // only on the snapshot so it can never steal them back.
    const sessionId = this.sessionId;
    const spans = this.spans;
    const violations = this.violations;
    this.sessionId = null;
    this.spans = [];
    this.violations = [];
    await this.teardown(now);
    return this.emitEvidence(sessionId, spans, violations);
  }

  /** Toggle off mid-session — same teardown + evidence emission; the
   *  spans earned so far still belong to the session. */
  async disarm(): Promise<PhoneDownSummary> {
    const now = this.now();
    this.armGen++;
    await this.drainBuffers().catch(() => {});
    // A grace deadline that passed while suspended must mark the pending
    // span violated — it must not emit clean just because we disarm now.
    this.settleGraceIfDue(now);
    if (this.machine.state !== 'idle') {
      this.machine.dispatch({ type: 'STOP', ts: now });
    }
    const sessionId = this.sessionId;
    const spans = this.spans;
    const violations = this.violations;
    this.sessionId = null;
    this.spans = [];
    this.violations = [];
    await this.teardown(now);
    return this.emitEvidence(sessionId, spans, violations);
  }

  /**
   * Flush queued evidence and build the summary. Spans/violations were
   * already persisted when they resolved — a repeat call (unmount disarm
   * after a stop) finds the session cleared and emits nothing twice. The
   * (sessionId, spans, violations) snapshot is the closing session's;
   * callers cleared live state before teardown, so nothing here can touch
   * a re-armed session.
   */
  private async emitEvidence(
    sessionId: number | null,
    spans: ResolvedSpan[],
    violations: PhoneDownViolation[],
  ): Promise<PhoneDownSummary> {
    // Land every recorded span/violation inside events before flushing —
    // enqueue's hydrate await could otherwise let flush read an empty list.
    // Swap the array out first so a re-arm's track() calls aren't captured:
    // pushes landing BEFORE the swap (teardown-drain edges) belong to this
    // session and are awaited here; pushes after belong to the re-arm.
    const pending = this.pendingEnqueues;
    this.pendingEnqueues = [];
    // No arm() ⇒ no session id ⇒ no evidence can exist to emit. A span
    // with a forged/missing session_id would record unscored server-side.
    if (sessionId === null) {
      return { sessionId: 0, spans, violations, syncFailed: false, evidenceDropped: 0 };
    }
    // Rejected enqueues in THIS batch (track's flag) are this session's
    // drops — a rejection landing during the await can't slip onto a
    // re-arm's freshly-reset counter.
    const evidenceDropped = (await Promise.all(pending)).filter((r) => r === false).length;
    const summary: PhoneDownSummary = {
      sessionId,
      spans,
      violations,
      syncFailed: false,
      evidenceDropped,
    };
    try {
      const flushed = await this.queue.flush();
      // Joining an in-flight flush whose loop already exited leaves the
      // just-pushed evidence queued with failed=false — pending>0 says
      // it hasn't landed yet, so the summary stays honest either way.
      summary.syncFailed = flushed.failed || flushed.pending > 0;
    } catch {
      // A storage fault must not cascade: callers still run sessionsApi.stop
      // — the evidence stays persisted and flushes on the next attempt.
      summary.syncFailed = true;
    }
    return summary;
  }

  private async teardown(nowTs: number): Promise<void> {
    // Detach everything this session owns SYNCHRONOUSLY, before the first
    // await — a re-arm landing mid-teardown builds on empty fields, so its
    // providers, timers and subscriptions can never be torn down under it.
    const graceTimer = this.graceTimer;
    const drainTimer = this.drainTimer;
    const appStateSub = this.appStateSub;
    const providers = this.runningProviders;
    const retro = this.runningRetro;
    this.graceTimer = null;
    this.drainTimer = null;
    this.appStateSub = null;
    this.runningProviders = [];
    this.runningRetro = [];
    this.suspendedAt = null;
    if (graceTimer !== null) clearTimeout(graceTimer);
    if (drainTimer !== null) clearInterval(drainTimer);
    appStateSub?.remove();
    this.tracker.liveEnd(nowTs);
    this.onStateChange(this);
    // Only the snapshot gets stopped — never a re-arm's providers. Every
    // stop() is invoked inside the SAME map (synchronously): providers are
    // shared instances across arms, so sequential awaits would let a
    // re-arm's start() interleave before a later stop() killed it.
    await Promise.all(providers.map((p) => p.stop().catch(() => {})));
    await Promise.all(retro.map((r) => r.stopRecording().catch(() => {})));
  }
}
