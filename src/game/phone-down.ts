/**
 * Phone-down verification — pure logic, no React, no native imports.
 *
 * Three pieces, each independently testable:
 *
 *  - `FaceDownClassifier`: raw gravity-z samples (in g) → debounced
 *    'face_down' / 'picked_up' edges. Face-down = |z|≈1g on the platform's
 *    face-down side — the sign is platform-dependent (Android raw accel
 *    reads ≈ −1g face-down, iOS ≈ +1g) and confirmed against a baseline
 *    sample set at arm time (`calibrate`).
 *
 *  - `PhoneDownMachine`: idle | armed | running | grace | violated.
 *    Consumes edges; opens a span per continuous face-down interval, closes
 *    it when the phone comes up; a pickup longer than `graceMs` is a
 *    violation. Emits nothing itself — span/violation records are collected
 *    by the caller and become phone_down_span / phone_down_violation events.
 *
 *  - `CoverageTracker` + `resolveSpanTier`: honesty layer. A span is only
 *    `verified` when every instant of it has proof — live provider coverage
 *    or a retro (iOS CMSensorRecorder) verdict over a suspended gap. A gap
 *    nobody can prove is `unverified`; proven pickup is `violated`. Nothing
 *    is ever upgraded past what the evidence shows.
 *
 * All timestamps are epoch ms; ISO conversion happens at the event boundary.
 */

import { Platform } from 'react-native';

/* ------------------------------------------------------------------ */
/* Face-down classifier                                                */
/* ------------------------------------------------------------------ */

export type FlatSign = 1 | -1;
export type OrientationEdge = 'face_down' | 'picked_up';
export type CalibrationQuality = 'measured' | 'assumed' | 'already_down';

export interface CalibrationResult {
  faceDownSign: FlatSign;
  quality: CalibrationQuality;
}

export interface ClassifierOptions {
  /** |z| must exceed this to count as "flat" (≈cos of max tilt off flat). */
  flatMin?: number;
  /** |z| beyond this means shaking/moving, not resting face-down. */
  flatMax?: number;
  /** Continuous dwell (ms) before an edge is emitted — rejects transients. */
  dwellMs?: number;
  /** Platform prior for the face-down z sign (Android −1, iOS +1). */
  platformFaceDownSign?: FlatSign;
}

export const DEFAULT_PLATFORM_FACE_DOWN_SIGN: FlatSign = Platform.OS === 'android' ? -1 : 1;

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export class FaceDownClassifier {
  private readonly flatMin: number;
  private readonly flatMax: number;
  private readonly dwellMs: number;
  private readonly platformSign: FlatSign;

  private faceDownSign: FlatSign;
  private emitted = false; // currently reported direction (false = up)
  private pendingDir: boolean | null = null;
  private pendingSince: number | null = null;

  constructor(options: ClassifierOptions = {}) {
    this.flatMin = options.flatMin ?? 0.8;
    this.flatMax = options.flatMax ?? 1.45;
    this.dwellMs = options.dwellMs ?? 750;
    this.platformSign = options.platformFaceDownSign ?? DEFAULT_PLATFORM_FACE_DOWN_SIGN;
    this.faceDownSign = this.platformSign;
  }

  get sign(): FlatSign {
    return this.faceDownSign;
  }

  /** The direction the classifier currently reports — corroboration for
   *  event-driven edges (a proximity 'far' while this still says down is a
   *  blip, not a pickup). */
  get isDown(): boolean {
    return this.emitted;
  }

  /** Fresh arm — prior `emitted`/dwell state belongs to the last session;
   *  keeping it would suppress the real first edge of the next one. */
  reset(): void {
    this.emitted = false;
    this.pendingDir = null;
    this.pendingSince = null;
    this.faceDownSign = this.platformSign;
  }

  /**
   * Validate the face-down sign against a baseline sample set taken at arm
   * time (the user just tapped the toggle — the phone is in hand,
   * presumptively face-up). The sign always stays the platform prior:
   * |z| alone can never distinguish "armed while face-down on a
   * normal-sign device" from "armed face-up on a flipped-sign device", so
   * the baseline can only *confirm* or *flag* the orientation — 'measured'
   * (flat face-up, convention confirmed), 'already_down' (flat reading on
   * the face-down side — either armed while down or a flipped device, and
   * the caller may want to warn), or 'assumed' (not flat — can't tell).
   * Overriding the convention on ambiguous data would be a lie, not a fix.
   */
  calibrate(baselineZ: number[]): CalibrationResult {
    if (baselineZ.length === 0) {
      return { faceDownSign: this.faceDownSign, quality: 'assumed' };
    }
    const med = median(baselineZ);
    if (Math.abs(med) < this.flatMin) {
      return { faceDownSign: this.faceDownSign, quality: 'assumed' };
    }
    if (Math.sign(med) === this.platformSign) {
      return { faceDownSign: this.platformSign, quality: 'already_down' };
    }
    return { faceDownSign: this.faceDownSign, quality: 'measured' };
  }

  private isFaceDown(z: number): boolean {
    const v = z * this.faceDownSign;
    return v > this.flatMin && v < this.flatMax;
  }

  /**
   * Feed one gravity-z sample (g). Returns an edge when the new direction
   * has persisted for dwellMs, else null. Dwell applies in both directions
   * so a jostle while face-down doesn't close a span.
   */
  sample(z: number, nowMs: number): OrientationEdge | null {
    const down = this.isFaceDown(z);
    if (down === this.emitted) {
      this.pendingDir = null;
      this.pendingSince = null;
      return null;
    }
    if (this.pendingDir !== down) {
      this.pendingDir = down;
      this.pendingSince = nowMs;
      return null;
    }
    if (this.pendingSince === null || nowMs - this.pendingSince < this.dwellMs) {
      return null;
    }
    this.emitted = down;
    this.pendingDir = null;
    this.pendingSince = null;
    return down ? 'face_down' : 'picked_up';
  }
}

/* ------------------------------------------------------------------ */
/* Phone-down state machine                                            */
/* ------------------------------------------------------------------ */

export type PhoneDownState = 'idle' | 'armed' | 'running' | 'grace' | 'violated';

/**
 * Violation kinds — must match the backend's phone_down.VIOLATION_KINDS
 * ('pickup' | 'grace_expired'); anything else is rejected at ingest.
 * 'grace_expired' = pickup outlasted grace; 'pickup' = proven movement
 * while a span was open (e.g. a retro-recorder 'moved' verdict).
 */
export type ViolationKind = 'pickup' | 'grace_expired';

export interface PhoneDownEventInput {
  type: 'FACE_DOWN' | 'PICKED_UP' | 'GRACE_EXPIRED' | 'STOP' | 'EXTERNAL_VIOLATION';
  /** Epoch ms. */
  ts: number;
  /** Violation kind for EXTERNAL_VIOLATION. */
  kind?: ViolationKind;
}

export interface PhoneDownSpan {
  start_ts: number;
  end_ts: number;
  violated: boolean;
}

export interface PhoneDownViolation {
  at_ts: number;
  kind: ViolationKind;
}

export interface MachineHooks {
  onSpanClosed?: (span: PhoneDownSpan) => void;
  onViolation?: (violation: PhoneDownViolation) => void;
}

export const DEFAULT_GRACE_MS = 10_000;

/**
 * armed ──FACE_DOWN──▶ running ──PICKED_UP──▶ grace
 *                                       ▲          │FACE_DOWN (inside grace)
 *                    running ◀──────────┘          │GRACE_EXPIRED (≥ grace ms)
 *                                                  ▼
 *                                              violated ──FACE_DOWN──▶ running
 *
 * STOP anywhere → idle (open span closes at the stop ts).
 * GRACE_EXPIRED before the boundary is ignored — callers may fire it early
 * (timer drift); the machine re-checks the timestamp, never the clock.
 */
export class PhoneDownMachine {
  private readonly graceMs: number;
  private readonly hooks: MachineHooks;

  state: PhoneDownState = 'idle';
  /** Open face-down span's start ts (running) or null. */
  private spanStart: number | null = null;
  private graceStart: number | null = null;
  /**
   * Span that closed at the current pickup, held back until grace resolves:
   * re-down inside grace emits it clean, grace expiry emits it violated.
   */
  private pendingSpan: PhoneDownSpan | null = null;

  constructor(options: { graceMs?: number } & MachineHooks = {}) {
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.hooks = { onSpanClosed: options.onSpanClosed, onViolation: options.onViolation };
  }

  get graceDeadlineMs(): number | null {
    return this.state === 'grace' && this.graceStart !== null
      ? this.graceStart + this.graceMs
      : null;
  }

  /** Milliseconds left before the current pickup becomes a violation. */
  graceRemainingMs(nowMs: number): number | null {
    const deadline = this.graceDeadlineMs;
    return deadline === null ? null : Math.max(0, deadline - nowMs);
  }

  arm(): void {
    if (this.state !== 'idle') return;
    this.state = 'armed';
    this.spanStart = null;
    this.graceStart = null;
  }

  /** Close the open span → held in pendingSpan (not yet emitted). */
  private closeSpan(endTs: number): void {
    if (this.spanStart === null) return;
    if (endTs > this.spanStart) {
      this.pendingSpan = { start_ts: this.spanStart, end_ts: endTs, violated: false };
    }
    this.spanStart = null;
  }

  /** Emit whatever is pending with a final verdict. */
  private settlePendingSpan(violated: boolean): void {
    if (this.pendingSpan === null) return;
    this.pendingSpan.violated = violated;
    this.hooks.onSpanClosed?.(this.pendingSpan);
    this.pendingSpan = null;
  }

  /** Emit the open span directly (no grace pending — STOP / forced paths). */
  private emitOpenSpan(endTs: number, violated: boolean): void {
    if (this.spanStart === null) return;
    if (endTs > this.spanStart) {
      this.hooks.onSpanClosed?.({ start_ts: this.spanStart, end_ts: endTs, violated });
    }
    this.spanStart = null;
  }

  private openSpan(ts: number): void {
    this.spanStart = ts;
  }

  private recordViolation(ts: number, kind: ViolationKind): void {
    this.hooks.onViolation?.({ at_ts: ts, kind });
  }

  dispatch(event: PhoneDownEventInput): void {
    const { type, ts } = event;
    switch (this.state) {
      case 'idle':
        return; // disarmed — sensor edges are noise
      case 'armed':
        if (type === 'FACE_DOWN') {
          this.openSpan(ts);
          this.state = 'running';
        } else if (type === 'STOP') {
          this.state = 'idle';
        }
        return;
      case 'running':
        if (type === 'PICKED_UP') {
          // Span closes at the pickup, held pending until grace resolves.
          this.closeSpan(ts);
          this.graceStart = ts;
          this.state = 'grace';
        } else if (type === 'EXTERNAL_VIOLATION') {
          this.emitOpenSpan(ts, true);
          this.recordViolation(ts, event.kind ?? 'pickup');
          this.state = 'violated';
        } else if (type === 'STOP') {
          this.emitOpenSpan(ts, false);
          this.state = 'idle';
        }
        return;
      case 'grace':
        if (type === 'FACE_DOWN') {
          this.settlePendingSpan(false); // corrected inside grace — clean
          this.graceStart = null;
          this.openSpan(ts);
          this.state = 'running';
        } else if (type === 'GRACE_EXPIRED') {
          // Timestamp-checked: an early timer wake must not violate.
          if (this.graceStart !== null && ts >= this.graceStart + this.graceMs) {
            this.settlePendingSpan(true); // pickup outlasted grace — violated
            this.recordViolation(this.graceStart + this.graceMs, 'grace_expired');
            this.graceStart = null;
            this.state = 'violated';
          }
        } else if (type === 'EXTERNAL_VIOLATION') {
          this.settlePendingSpan(true);
          this.recordViolation(ts, event.kind ?? 'pickup');
          this.graceStart = null;
          this.state = 'violated';
        } else if (type === 'STOP') {
          this.settlePendingSpan(false); // session ended mid-grace — no violation
          this.graceStart = null;
          this.state = 'idle';
        }
        return;
      case 'violated':
        if (type === 'FACE_DOWN') {
          this.openSpan(ts);
          this.state = 'running';
        } else if (type === 'STOP') {
          this.state = 'idle';
        }
        return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Coverage → tier resolution                                          */
/* ------------------------------------------------------------------ */

export type Tier = 'verified' | 'unverified' | 'violated';
export type Evidence = 'live' | 'retro' | 'none';

/** What an app-suspension gap resolves to after a retro query. */
export type GapVerdict = 'stayed_flat' | 'moved' | 'unknown';

export interface SuspensionGap {
  from: number;
  to: number;
  verdict?: GapVerdict;
}

interface LiveWindow {
  start: number;
  end: number;
}

/**
 * Tracks where proof exists for a session:
 *  - live windows: an orientation provider was actively reporting
 *    (foreground accel, or the Android FGS proximity buffer which keeps
 *    firing through suspension).
 *  - suspension gaps: app went background→active while a span was open;
 *    verdict filled later by the retro provider (or left 'unknown').
 */
export class CoverageTracker {
  private live: LiveWindow[] = [];
  private openLiveStart: number | null = null;
  private gaps: SuspensionGap[] = [];
  /** Live coverage ended at this ts because the app suspended (iOS). */
  private liveSuspendedAt: number | null = null;

  /** Drop all accumulated coverage — re-arm starts a fresh session. */
  reset(): void {
    this.live = [];
    this.openLiveStart = null;
    this.gaps = [];
    this.liveSuspendedAt = null;
  }

  /** Provider began actively reporting. */
  liveStart(ts: number): void {
    if (this.openLiveStart === null) this.openLiveStart = ts;
  }

  /** Provider stopped (session end, or app suspended — call explicitly). */
  liveEnd(ts: number): void {
    if (this.openLiveStart !== null && ts > this.openLiveStart) {
      this.live.push({ start: this.openLiveStart, end: ts });
    }
    this.openLiveStart = null;
  }

  /** App backgrounded — close any live window and open a gap at resume. */
  suspend(ts: number): void {
    if (this.openLiveStart !== null) this.liveEnd(ts);
    // Record the suspension even with no live window open — a span that just
    // closed on a dead stream still needs the gap at resume so retro gets
    // queried (moved → violation; stayed_flat → honest upgrade). First
    // suspend owns the start — a repeated suspend must not slide it.
    if (this.liveSuspendedAt === null) this.liveSuspendedAt = ts;
  }

  /** App foregrounded — the [suspend, resume] interval becomes a gap and is
   *  returned so the caller's retro verdict binds to THIS gap, not whatever
   *  happens to be newest when the query lands. */
  resume(ts: number, providerResumes: boolean): SuspensionGap | null {
    let gap: SuspensionGap | null = null;
    if (this.liveSuspendedAt !== null && ts > this.liveSuspendedAt) {
      gap = { from: this.liveSuspendedAt, to: ts, verdict: 'unknown' };
      this.gaps.push(gap);
    }
    this.liveSuspendedAt = null;
    if (providerResumes) this.liveStart(ts);
    return gap;
  }

  /** Fill the verdict on the gap the query actually measured. */
  resolveGap(gap: SuspensionGap | null, verdict: GapVerdict): void {
    if (gap !== null && gap.verdict === 'unknown') gap.verdict = verdict;
  }

  /**
   * Intervals of [start,end] with no live coverage. Each uncovered piece is
   * explained by a recorded suspension gap when one contains it; anything
   * else is unproven dead time (provider denied/lost mid-foreground).
   */
  coverageFor(
    start: number,
    end: number,
  ): { liveCovered: boolean; gaps: SuspensionGap[]; unproven: boolean } {
    // Copy before sorting — the open-live splice already copies, the plain
    // path must too or sort() would reorder this.live in place.
    const windows =
      this.openLiveStart !== null
        ? [...this.live, { start: this.openLiveStart, end }]
        : [...this.live];
    let cursor = start;
    const spanGaps: SuspensionGap[] = [];
    let unproven = false;
    for (const w of windows.sort((a, b) => a.start - b.start)) {
      if (w.end <= cursor || w.start >= end) continue;
      const deadStart = Math.max(cursor, start);
      if (w.start > deadStart) {
        const gap = this.gaps.find((g) => g.from <= deadStart && g.to >= Math.min(w.start, end));
        if (gap) spanGaps.push(gap);
        else unproven = true;
      }
      cursor = Math.max(cursor, Math.min(w.end, end));
      if (cursor >= end) break;
    }
    if (cursor < end) {
      const gap = this.gaps.find((g) => g.from <= cursor && g.to >= end);
      if (gap) spanGaps.push(gap);
      else unproven = true;
    }
    return {
      liveCovered: cursor >= end && spanGaps.length === 0 && !unproven,
      gaps: spanGaps,
      unproven,
    };
  }
}

/**
 * Map a closed span to its honest (tier, evidence).
 *  - violated flag or a proven pickup inside a gap → violated
 *  - fully live-covered → verified/live
 *  - gaps all retro-proven flat → verified/retro
 *  - anything unproven → unverified/none
 */
export function resolveSpanTier(
  span: { start_ts: number; end_ts: number; violated: boolean },
  coverage: CoverageTracker,
): { tier: Tier; evidence: Evidence } {
  const { liveCovered, gaps, unproven } = coverage.coverageFor(span.start_ts, span.end_ts);
  if (gaps.some((g) => g.verdict === 'moved')) {
    return { tier: 'violated', evidence: 'retro' };
  }
  if (span.violated) {
    return { tier: 'violated', evidence: liveCovered ? 'live' : 'none' };
  }
  if (liveCovered) return { tier: 'verified', evidence: 'live' };
  if (unproven || gaps.length === 0) return { tier: 'unverified', evidence: 'none' };
  if (gaps.every((g) => g.verdict === 'stayed_flat')) {
    return { tier: 'verified', evidence: 'retro' };
  }
  return { tier: 'unverified', evidence: 'none' };
}
