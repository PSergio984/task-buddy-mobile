/**
 * PhoneDownSession tests — the ledger-event contract pinned against the
 * backend literals (phone_down_span / phone_down_violation payloads,
 * VIOLATION_KINDS, ISO-Z timestamps), kill-survival (spans/violations are
 * persisted to the queue as they are recorded, not at stop), the sub-2s
 * flick floor, and the one-shot emit (a repeat emit can't double-report).
 * Providers and the queue are injected fakes; the machine is real.
 */
import type { EventQueue } from '../event-queue';
import { PhoneDownSession } from '../phone-down-session';
import type { OrientationProvider } from '../sensors/types';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function makeQueue() {
  const enqueue = jest.fn().mockResolvedValue({});
  const flush = jest.fn().mockResolvedValue({ sent: 0, pending: 0, dropped: 0, failed: false });
  return { enqueue, flush, asQueue: { enqueue, flush } as unknown as EventQueue };
}

function fakeProvider(overrides: Partial<OrientationProvider> = {}): OrientationProvider {
  return {
    name: 'fake',
    coversSuspension: false,
    isAvailable: jest.fn().mockResolvedValue(true),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSession() {
  const clock = { now: 0 };
  const queue = makeQueue();
  const provider = fakeProvider();
  const session = new PhoneDownSession({
    queue: queue.asQueue,
    orientation: [provider],
    retro: [],
    now: () => clock.now,
    drainPollMs: 60_000,
  });
  return { session, clock, queue, provider };
}

describe('PhoneDownSession — ledger contract', () => {
  it('emits phone_down_span with the backend payload shape and ISO-Z ts', async () => {
    const { session, clock, queue } = makeSession();
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 1_000 });
    session.feedEdge({ edge: 'picked_up', ts: 10_000 }); // grace, deadline 20_000
    clock.now = 15_000; // stop inside grace — the span settles clean
    const sum = await session.stop();

    const spanCalls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_span');
    expect(spanCalls).toHaveLength(1);
    const payload = spanCalls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['claimed_tier', 'end_ts', 'evidence', 'session_id', 'start_ts'].sort(),
    );
    expect(payload).toEqual({
      session_id: 7,
      start_ts: new Date(1_000).toISOString(),
      end_ts: new Date(10_000).toISOString(),
      claimed_tier: 'verified',
      evidence: 'live',
    });
    expect(payload.start_ts).toEqual(expect.stringMatching(ISO_Z));
    expect(payload.end_ts).toEqual(expect.stringMatching(ISO_Z));
    expect(sum.sessionId).toBe(7);
    expect(sum.spans).toHaveLength(1);
    expect(sum.violations).toHaveLength(0);
  });

  it('emits phone_down_violation with kind ∈ pickup|grace_expired', async () => {
    const { session, clock, queue } = makeSession();
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 1_000 });
    session.feedEdge({ edge: 'picked_up', ts: 10_000 }); // grace, deadline 20_000
    // A buffered edge stamped past the deadline settles the grace first.
    session.feedEdge({ edge: 'picked_up', ts: 25_000 });

    const calls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_violation');
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['at_ts', 'kind', 'session_id'].sort());
    expect(payload).toEqual({
      session_id: 7,
      at_ts: new Date(20_000).toISOString(),
      kind: 'grace_expired',
    });
    expect(payload.at_ts).toEqual(expect.stringMatching(ISO_Z));
    expect(['pickup', 'grace_expired']).toContain(payload.kind);
    clock.now = 30_000;
    await session.stop();
  });

  it('persists each span/violation at record time — evidence survives kill', async () => {
    const { session, clock, queue } = makeSession();
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 1_000 });
    session.feedEdge({ edge: 'picked_up', ts: 10_000 });
    session.feedEdge({ edge: 'picked_up', ts: 25_000 }); // grace expiry → violation
    // Both records are queued before stop() ever runs.
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.flush).not.toHaveBeenCalled();
    clock.now = 30_000;
    await session.stop();
    // Every enqueue lands before the flush for delivery ordering.
    expect(queue.flush).toHaveBeenCalledTimes(1);
    const lastEnq = Math.max(...queue.enqueue.mock.invocationCallOrder);
    expect(lastEnq).toBeLessThan(queue.flush.mock.invocationCallOrder[0]);
  });

  it('drops sub-2s flick spans from emission but keeps them in the summary', async () => {
    const { session, clock, queue } = makeSession();
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 0 });
    session.feedEdge({ edge: 'picked_up', ts: 1_000 }); // grace
    session.feedEdge({ edge: 'face_down', ts: 5_000 }); // 1s span settles clean
    clock.now = 30_000;
    const sum = await session.stop();

    const spanCalls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_span');
    // The 1s flick is not reported; the open [5_000, 30_000] span is.
    expect(spanCalls).toHaveLength(1);
    expect(spanCalls[0][1]).toMatchObject({
      start_ts: new Date(5_000).toISOString(),
      end_ts: new Date(30_000).toISOString(),
    });
    expect(sum.spans).toHaveLength(2); // machine keeps the flick internally
  });

  it('emit is one-shot — a repeat disarm reports nothing twice', async () => {
    const { session, clock, queue } = makeSession();
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 0 });
    session.feedEdge({ edge: 'picked_up', ts: 5_000 }); // grace
    session.feedEdge({ edge: 'face_down', ts: 8_000 }); // settle + reopen
    clock.now = 20_000;
    const first = await session.disarm();
    expect(first.spans).toHaveLength(2);
    expect(queue.flush).toHaveBeenCalledTimes(1);

    const second = await session.disarm();
    expect(second.spans).toHaveLength(0);
    expect(second.violations).toHaveLength(0);
    // No second emission: the queue never sees the same spans re-enqueued.
    const spanCalls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_span');
    expect(spanCalls).toHaveLength(2);
    expect(queue.flush).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneDownSession — arm/disarm races', () => {
  it('arm resolves true when providers start cleanly', async () => {
    const { session } = makeSession();
    await expect(session.arm(7)).resolves.toBe(true);
    await session.disarm();
  });

  it('stop landing mid-arm → arm resolves false and the late provider is torn down', async () => {
    const clock = { now: 0 };
    const queue = makeQueue();
    let resolveStart!: () => void;
    const provider = fakeProvider({
      start: jest.fn().mockImplementation(() => new Promise<void>((r) => (resolveStart = r))),
    });
    const session = new PhoneDownSession({
      queue: queue.asQueue,
      orientation: [provider],
      retro: [],
      now: () => clock.now,
      drainPollMs: 60_000,
    });

    const armPromise = session.arm(7);
    // Flush the microtask queue so arm() reaches the pending provider.start.
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(provider.start).toHaveBeenCalled();
    await session.stop(); // machine → idle while start is still in-flight
    resolveStart(); // the provider now "finishes" starting

    await expect(armPromise).resolves.toBe(false);
    // The provider that joined after the machine was already idle is stopped.
    expect(provider.stop).toHaveBeenCalled();
    expect(session.state).toBe('idle');
  });

  it('OFF→ON during pending provider.stop — the re-arm keeps its session and sensors', async () => {
    const clock = { now: 0 };
    const queue = makeQueue();
    let resolveStop!: () => void;
    const provider = fakeProvider({
      // Only the FIRST stop parks (the stale teardown's); the final
      // session.stop() teardown resolves immediately.
      stop: jest
        .fn()
        .mockImplementationOnce(() => new Promise<void>((r) => (resolveStop = r)))
        .mockResolvedValue(undefined),
    });
    const session = new PhoneDownSession({
      queue: queue.asQueue,
      orientation: [provider],
      retro: [],
      now: () => clock.now,
      drainPollMs: 60_000,
    });

    await session.arm(7);
    const disarmPromise = session.disarm(); // teardown now awaits provider.stop
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(provider.stop).toHaveBeenCalledTimes(1);

    // Re-arm while the old teardown is still parked on provider.stop.
    const armPromise = session.arm(9);
    resolveStop(); // the stale teardown finishes under the new arm
    await expect(armPromise).resolves.toBe(true);
    await disarmPromise;

    // The new arm's provider was never stopped under it — only the
    // snapshot taken before the await was torn down.
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('armed');

    // Spans from the re-armed session reach the queue under session 9 —
    // the stale emitEvidence could not steal sessionId.
    clock.now = 100_000;
    session.feedEdge({ edge: 'face_down', ts: 50_000 });
    session.feedEdge({ edge: 'picked_up', ts: 60_000 });
    clock.now = 120_000;
    const sum = await session.stop();
    const spanCalls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_span');
    expect(spanCalls).toHaveLength(1);
    expect(spanCalls[0][1]).toMatchObject({ session_id: 9 });
    expect(sum.sessionId).toBe(9);
  });

  it('same-id re-arm mid-teardown — the stale emit cannot steal sessionId', async () => {
    const clock = { now: 0 };
    const queue = makeQueue();
    let resolveStop!: () => void;
    const provider = fakeProvider({
      stop: jest
        .fn()
        .mockImplementationOnce(() => new Promise<void>((r) => (resolveStop = r)))
        .mockResolvedValue(undefined),
    });
    const session = new PhoneDownSession({
      queue: queue.asQueue,
      orientation: [provider],
      retro: [],
      now: () => clock.now,
      drainPollMs: 60_000,
    });

    await session.arm(7);
    const disarmPromise = session.disarm(); // teardown parks on provider.stop
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(provider.stop).toHaveBeenCalledTimes(1);

    // OFF→ON and pause→resume both re-arm the SAME session.id — the real
    // app path the snapshot-clear must protect.
    const armPromise = session.arm(7);
    resolveStop();
    await expect(armPromise).resolves.toBe(true);
    await disarmPromise;
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('armed');

    clock.now = 100_000;
    session.feedEdge({ edge: 'face_down', ts: 50_000 });
    session.feedEdge({ edge: 'picked_up', ts: 60_000 });
    clock.now = 120_000;
    const sum = await session.stop();
    const spanCalls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_span');
    expect(spanCalls).toHaveLength(1);
    expect(spanCalls[0][1]).toMatchObject({ session_id: 7 });
    expect(sum.sessionId).toBe(7);
  });

  it('a flush throw is contained — stop reports syncFailed, never rejects', async () => {
    const { session, clock, queue } = makeSession();
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 0 });
    clock.now = 10_000;
    queue.flush.mockRejectedValueOnce(new Error('storage gone'));
    const sum = await session.stop();
    expect(sum.syncFailed).toBe(true);
    // Evidence was persisted to the queue — a later flush still delivers it.
    expect(queue.enqueue).toHaveBeenCalled();
  });

  it('concurrent drains are serialized — buffered rows replay exactly once', async () => {
    const clock = { now: 0 };
    const queue = makeQueue();
    // Emulates the native drain's non-atomic toList→removeAll: the copy
    // happens at call time, the removal when the promise resolves. Two
    // overlapping drains would each return the same rows — duplicated
    // spans and a fabricated grace_expired violation.
    const buffer = [
      { near: true, ts: 1_000 },
      { near: false, ts: 10_000 },
    ];
    const drainTransitions = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          const drained = buffer.slice();
          queueMicrotask(() => {
            for (const d of drained) {
              const i = buffer.indexOf(d);
              if (i >= 0) buffer.splice(i, 1);
            }
            resolve({ transitions: drained, lastProofTs: drained.at(-1)?.ts ?? null });
          });
        }),
    );
    const provider = fakeProvider({ coversSuspension: true, drainTransitions });
    const session = new PhoneDownSession({
      queue: queue.asQueue,
      orientation: [provider],
      retro: [],
      now: () => clock.now,
      drainPollMs: 60_000,
    });
    await session.arm(7);
    clock.now = 30_000;
    // Race stop's teardown drain against disarm's — each runs its own
    // drain, but strictly after the previous one completes.
    await Promise.all([session.stop(), session.disarm()]);

    // Each buffered row replays exactly once: the PU at 10s outlives its
    // 10s grace (now = 30s), so ONE span + ONE grace_expired land — a
    // doubled replay would fabricate a second of each.
    const violationCalls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_violation');
    const spanCalls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_span');
    expect(violationCalls).toHaveLength(1);
    expect(violationCalls[0][1]).toMatchObject({
      at_ts: new Date(20_000).toISOString(),
      kind: 'grace_expired',
    });
    expect(spanCalls).toHaveLength(1);
    expect(spanCalls[0][1]).toMatchObject({
      start_ts: new Date(1_000).toISOString(),
      end_ts: new Date(10_000).toISOString(),
    });
  });
});

describe('PhoneDownSession — durable-write failure', () => {
  it('stop() reports evidenceDropped for rejected enqueues without rejecting', async () => {
    const clock = { now: 0 };
    const queue = makeQueue();
    // Every write fails — a broken AsyncStorage must surface through the
    // summary, not crash the teardown or lose the count silently.
    queue.enqueue.mockRejectedValue(new Error('storage full'));
    const provider = fakeProvider();
    const session = new PhoneDownSession({
      queue: queue.asQueue,
      orientation: [provider],
      retro: [],
      now: () => clock.now,
      drainPollMs: 60_000,
    });
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 1_000 });
    session.feedEdge({ edge: 'picked_up', ts: 5_000 });
    clock.now = 16_000; // past the 10s grace → violated + one span
    const sum = await session.stop();
    expect(sum.evidenceDropped).toBe(2); // span + grace_expired violation
    expect(sum.spans).toHaveLength(1);
  });
});

describe('PhoneDownSession — dead continuous stream', () => {
  it('a silenced accelerometer ends live coverage at its last sample → unverified', async () => {
    const clock = { now: 0 };
    const queue = makeQueue();
    // Continuous emitter whose sample clock the test controls.
    const live = { lastSampleAt: 0 };
    const provider = fakeProvider({
      get lastSampleAt() {
        return live.lastSampleAt;
      },
    });
    const session = new PhoneDownSession({
      queue: queue.asQueue,
      orientation: [provider],
      retro: [],
      now: () => clock.now,
      drainPollMs: 60_000,
    });
    await session.arm(7);
    session.feedEdge({ edge: 'face_down', ts: 1_000 });
    clock.now = 1_000;
    live.lastSampleAt = 1_000;
    // Stream dies at 1s; the phone stays down until 30s — only the
    // ~1s provable window can claim verified.
    clock.now = 30_000;
    const sum = await session.stop();
    expect(sum.spans).toHaveLength(1);
    expect(sum.spans[0].tier).toBe('unverified');
  });
});

describe('PhoneDownSession — grace deadline honesty', () => {
  it('a direct FACE_DOWN dispatched past the deadline expires, not recovers', async () => {
    const { session, clock, queue } = makeSession();
    await session.arm(7);
    session.machine.dispatch({ type: 'FACE_DOWN', ts: 1_000 });
    session.machine.dispatch({ type: 'PICKED_UP', ts: 5_000 }); // grace → deadline 15_000
    // Bypasses feedEdge's pre-emption: the reducer itself must expire.
    session.machine.dispatch({ type: 'FACE_DOWN', ts: 20_000 });
    const calls = queue.enqueue.mock.calls.filter((c) => c[0] === 'phone_down_violation');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      at_ts: new Date(15_000).toISOString(),
      kind: 'grace_expired',
    });
    clock.now = 25_000;
    await session.stop();
  });
});
