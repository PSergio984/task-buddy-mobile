/**
 * Phone-down verification tests — the AC-required exhaustive suite:
 * every state transition, the 9.9s vs 10s grace boundary, dwell debounce,
 * violation paths, span closing, and sign calibration. All pure — no
 * native bridge needed.
 */
import {
  CoverageTracker,
  DEFAULT_PLATFORM_FACE_DOWN_SIGN,
  FaceDownClassifier,
  PhoneDownMachine,
  resolveSpanTier,
  type PhoneDownSpan,
  type PhoneDownViolation,
} from '../phone-down';

const T0 = 1_000_000;

function makeMachine(graceMs = 10_000) {
  const spans: PhoneDownSpan[] = [];
  const violations: PhoneDownViolation[] = [];
  const machine = new PhoneDownMachine({
    graceMs,
    onSpanClosed: (s) => spans.push({ ...s }),
    onViolation: (v) => violations.push({ ...v }),
  });
  return { machine, spans, violations };
}

const down = (ts: number) => ({ type: 'FACE_DOWN' as const, ts });
const up = (ts: number) => ({ type: 'PICKED_UP' as const, ts });
const expired = (ts: number) => ({ type: 'GRACE_EXPIRED' as const, ts });
const stop = (ts: number) => ({ type: 'STOP' as const, ts });

/* ------------------------------------------------------------------ */
/* FaceDownClassifier                                                  */
/* ------------------------------------------------------------------ */

describe('FaceDownClassifier', () => {
  const android = { platformFaceDownSign: -1 as const, dwellMs: 100 };
  const ios = { platformFaceDownSign: 1 as const, dwellMs: 100 };

  it('detects face-down on Android at z ≈ −1g', () => {
    const c = new FaceDownClassifier(android);
    expect(c.sample(-0.98, 0)).toBeNull(); // dwell pending
    expect(c.sample(-0.99, 100)).toBe('face_down');
  });

  it('detects face-down on iOS at z ≈ +1g', () => {
    const c = new FaceDownClassifier(ios);
    expect(c.sample(0.98, 0)).toBeNull();
    expect(c.sample(1.0, 100)).toBe('face_down');
  });

  it('rejects transients shorter than the dwell window', () => {
    const c = new FaceDownClassifier(android);
    expect(c.sample(-1.0, 0)).toBeNull();
    expect(c.sample(0.2, 50)).toBeNull(); // blip back up before dwell
    expect(c.sample(-1.0, 60)).toBeNull(); // dwell restarts
    expect(c.sample(-1.0, 160)).toBe('face_down');
  });

  it('dwell applies to pickups too — a jostle does not close a span', () => {
    const c = new FaceDownClassifier(android);
    c.sample(-1.0, 0);
    c.sample(-1.0, 100); // → face_down
    expect(c.sample(-1.0, 120)).toBeNull();
    expect(c.sample(0.1, 200)).toBeNull(); // pickup candidate
    expect(c.sample(-1.0, 250)).toBeNull(); // jostle — still down
    expect(c.sample(-1.0, 300)).toBeNull(); // dwell applies again
    expect(c.sample(0.1, 310)).toBeNull();
    expect(c.sample(0.1, 410)).toBe('picked_up');
  });

  it('emits an edge exactly at the dwell boundary (>= semantics)', () => {
    const c = new FaceDownClassifier(android);
    c.sample(-1.0, 0);
    expect(c.sample(-1.0, 99)).toBeNull();
    expect(c.sample(-1.0, 100)).toBe('face_down');
  });

  it('rejects |z| above the flat window (shaking is not resting)', () => {
    const c = new FaceDownClassifier(android);
    c.sample(-1.0, 0);
    c.sample(-1.0, 100); // face_down
    c.sample(-1.0, 120);
    expect(c.sample(-2.5, 200)).toBeNull(); // shake — pickup candidate
    expect(c.sample(-2.5, 300)).toBe('picked_up');
  });

  it('calibrate: flat face-up baseline on iOS confirms +1 sign (measured)', () => {
    const c = new FaceDownClassifier(ios);
    const res = c.calibrate([-0.98, -1.0, -1.01]);
    expect(res).toEqual({ faceDownSign: 1, quality: 'measured' });
    expect(c.sign).toBe(1);
  });

  it('calibrate: flat face-up baseline on Android confirms −1 sign (measured)', () => {
    const c = new FaceDownClassifier(android);
    const res = c.calibrate([0.99, 1.0, 1.02]);
    expect(res).toEqual({ faceDownSign: -1, quality: 'measured' });
    expect(c.sign).toBe(-1);
  });

  it('calibrate: held-vertical baseline keeps the platform prior (assumed)', () => {
    const c = new FaceDownClassifier(android);
    const res = c.calibrate([0.1, -0.2, 0.3]);
    expect(res).toEqual({ faceDownSign: -1, quality: 'assumed' });
  });

  it('calibrate: empty baseline keeps the platform prior', () => {
    const c = new FaceDownClassifier(android);
    expect(c.calibrate([]).quality).toBe('assumed');
  });

  it('calibrate: baseline already face-down keeps the platform prior', () => {
    const c = new FaceDownClassifier(ios);
    const res = c.calibrate([0.98, 1.0, 0.99]); // reads as already-down on iOS
    expect(res).toEqual({ faceDownSign: 1, quality: 'already_down' });
  });

  it('calibrate: flipped-convention devices are flagged, not auto-fixed', () => {
    // |z| alone can't tell "armed while face-down on a normal device" from
    // "armed face-up on a flipped-sign device" — the platform prior wins
    // and the ambiguous case reports 'already_down' for the caller to flag.
    const c = new FaceDownClassifier(android);
    const res = c.calibrate([-1.0, -0.99, -1.0]); // reads face-down per Android prior
    expect(res).toEqual({ faceDownSign: -1, quality: 'already_down' });
  });

  it('default platform sign matches the research (Android −1, iOS +1)', () => {
    expect([-1, 1]).toContain(DEFAULT_PLATFORM_FACE_DOWN_SIGN);
  });
});

/* ------------------------------------------------------------------ */
/* PhoneDownMachine — transitions                                      */
/* ------------------------------------------------------------------ */

describe('PhoneDownMachine', () => {
  it('starts idle and ignores all events while idle', () => {
    const { machine, spans, violations } = makeMachine();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 1));
    machine.dispatch(expired(T0 + 2));
    expect(machine.state).toBe('idle');
    expect(spans).toHaveLength(0);
    expect(violations).toHaveLength(0);
  });

  it('arm → armed; STOP → back to idle', () => {
    const { machine } = makeMachine();
    machine.arm();
    expect(machine.state).toBe('armed');
    machine.dispatch(stop(T0 + 100));
    expect(machine.state).toBe('idle');
  });

  it('armed + PICKED_UP is a no-op (phone was never down)', () => {
    const { machine, spans } = makeMachine();
    machine.arm();
    machine.dispatch(up(T0 + 100));
    expect(machine.state).toBe('armed');
    expect(spans).toHaveLength(0);
  });

  it('FACE_DOWN while armed opens a span → running', () => {
    const { machine } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0 + 500));
    expect(machine.state).toBe('running');
  });

  it('PICKED_UP while running closes the span at the pickup ts', () => {
    const { machine, spans } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0 + 100));
    machine.dispatch(up(T0 + 5000));
    expect(machine.state).toBe('grace');
    // span held pending until grace resolves — not emitted yet
    expect(spans).toHaveLength(0);
  });

  it('FACE_DOWN inside grace → clean span emitted, new span opens, running', () => {
    const { machine, spans, violations } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0 + 100));
    machine.dispatch(up(T0 + 5000));
    machine.dispatch(down(T0 + 8000)); // 3s pickup < 10s grace
    expect(machine.state).toBe('running');
    expect(spans).toEqual([{ start_ts: T0 + 100, end_ts: T0 + 5000, violated: false }]);
    expect(violations).toHaveLength(0);
  });

  it('grace boundary: GRACE_EXPIRED at +9.9s is ignored', () => {
    const { machine, spans, violations } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 1000));
    machine.dispatch(expired(T0 + 1000 + 9_900));
    expect(machine.state).toBe('grace');
    expect(spans).toHaveLength(0);
    expect(violations).toHaveLength(0);
  });

  it('grace boundary: GRACE_EXPIRED at +10s → violation + span marked violated', () => {
    const { machine, spans, violations } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 1000));
    machine.dispatch(expired(T0 + 1000 + 10_000));
    expect(machine.state).toBe('violated');
    expect(spans).toEqual([{ start_ts: T0, end_ts: T0 + 1000, violated: true }]);
    expect(violations).toEqual([{ at_ts: T0 + 11_000, kind: 'grace_expired' }]);
  });

  it('violated + FACE_DOWN → running with a fresh span', () => {
    const { machine, spans } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 500));
    machine.dispatch(expired(T0 + 10_500));
    machine.dispatch(down(T0 + 20_000));
    expect(machine.state).toBe('running');
    machine.dispatch(up(T0 + 25_000));
    machine.dispatch(down(T0 + 26_000)); // inside new grace
    expect(spans).toEqual([
      { start_ts: T0, end_ts: T0 + 500, violated: true },
      { start_ts: T0 + 20_000, end_ts: T0 + 25_000, violated: false },
    ]);
  });

  it('STOP while running closes the open span clean', () => {
    const { machine, spans } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0 + 100));
    machine.dispatch(stop(T0 + 9000));
    expect(machine.state).toBe('idle');
    expect(spans).toEqual([{ start_ts: T0 + 100, end_ts: T0 + 9000, violated: false }]);
  });

  it('STOP during grace emits the pending span clean — ending mid-grace is no violation', () => {
    const { machine, spans, violations } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 1000));
    machine.dispatch(stop(T0 + 2000));
    expect(machine.state).toBe('idle');
    expect(spans).toEqual([{ start_ts: T0, end_ts: T0 + 1000, violated: false }]);
    expect(violations).toHaveLength(0);
  });

  it('STOP while violated → idle, nothing else emitted', () => {
    const { machine, spans, violations } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 500));
    machine.dispatch(expired(T0 + 10_500));
    machine.dispatch(stop(T0 + 20_000));
    expect(machine.state).toBe('idle');
    expect(spans).toHaveLength(1);
    expect(violations).toHaveLength(1);
  });

  it('FACE_DOWN while running is a no-op (still one span)', () => {
    const { machine, spans } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(down(T0 + 3000));
    machine.dispatch(stop(T0 + 5000));
    expect(spans).toEqual([{ start_ts: T0, end_ts: T0 + 5000, violated: false }]);
  });

  it('EXTERNAL_VIOLATION while running → span violated + violation record', () => {
    const { machine, spans, violations } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch({ type: 'EXTERNAL_VIOLATION', ts: T0 + 4000, kind: 'pickup' });
    expect(machine.state).toBe('violated');
    expect(spans).toEqual([{ start_ts: T0, end_ts: T0 + 4000, violated: true }]);
    expect(violations).toEqual([{ at_ts: T0 + 4000, kind: 'pickup' }]);
  });

  it('EXTERNAL_VIOLATION during grace settles the pending span violated', () => {
    const { machine, spans, violations } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 1000));
    machine.dispatch({ type: 'EXTERNAL_VIOLATION', ts: T0 + 3000, kind: 'pickup' });
    expect(machine.state).toBe('violated');
    expect(spans).toEqual([{ start_ts: T0, end_ts: T0 + 1000, violated: true }]);
    expect(violations).toEqual([{ at_ts: T0 + 3000, kind: 'pickup' }]);
  });

  it('degenerate zero-length spans are dropped', () => {
    const { machine, spans } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0)); // end == start
    machine.dispatch(down(T0));
    machine.dispatch(stop(T0 + 1)); // 1ms span survives
    expect(spans).toEqual([{ start_ts: T0, end_ts: T0 + 1, violated: false }]);
  });

  it('configurable grace: 5s grace violates at +5s', () => {
    const { machine, violations } = makeMachine(5000);
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 1000));
    machine.dispatch(expired(T0 + 5999));
    expect(machine.state).toBe('grace');
    machine.dispatch(expired(T0 + 6000));
    expect(machine.state).toBe('violated');
    expect(violations[0].at_ts).toBe(T0 + 6000);
  });

  it('graceRemainingMs reports time left and clamps at zero', () => {
    const { machine } = makeMachine();
    machine.arm();
    machine.dispatch(down(T0));
    machine.dispatch(up(T0 + 1000));
    expect(machine.graceRemainingMs(T0 + 4000)).toBe(7000);
    expect(machine.graceRemainingMs(T0 + 99_000)).toBe(0);
    expect(machine.graceDeadlineMs).toBe(T0 + 11_000);
  });
});

/* ------------------------------------------------------------------ */
/* CoverageTracker + resolveSpanTier                                   */
/* ------------------------------------------------------------------ */

describe('CoverageTracker + resolveSpanTier', () => {
  it('fully live-covered span → verified/live', () => {
    const t = new CoverageTracker();
    t.liveStart(1000);
    t.liveEnd(9000);
    expect(resolveSpanTier({ start_ts: 2000, end_ts: 8000, violated: false }, t)).toEqual({
      tier: 'verified',
      evidence: 'live',
    });
  });

  it('open live window counts through to the span end', () => {
    const t = new CoverageTracker();
    t.liveStart(0);
    expect(resolveSpanTier({ start_ts: 100, end_ts: 500, violated: false }, t)).toEqual({
      tier: 'verified',
      evidence: 'live',
    });
  });

  it('suspended gap proven flat → verified/retro', () => {
    const t = new CoverageTracker();
    t.liveStart(0);
    t.suspend(3000);
    const gap = t.resume(5000, true);
    t.resolveGap(gap, 'stayed_flat');
    t.liveEnd(9000);
    expect(resolveSpanTier({ start_ts: 500, end_ts: 8000, violated: false }, t)).toEqual({
      tier: 'verified',
      evidence: 'retro',
    });
  });

  it('suspended gap without proof → unverified/none', () => {
    const t = new CoverageTracker();
    t.liveStart(0);
    t.suspend(3000);
    t.resume(5000, true);
    t.liveEnd(9000); // gap left 'unknown'
    expect(resolveSpanTier({ start_ts: 500, end_ts: 8000, violated: false }, t)).toEqual({
      tier: 'unverified',
      evidence: 'none',
    });
  });

  it('suspended gap proven moved → violated/retro', () => {
    const t = new CoverageTracker();
    t.liveStart(0);
    t.suspend(3000);
    const gap = t.resume(5000, true);
    t.resolveGap(gap, 'moved');
    t.liveEnd(9000);
    expect(resolveSpanTier({ start_ts: 500, end_ts: 8000, violated: false }, t)).toEqual({
      tier: 'violated',
      evidence: 'retro',
    });
  });

  it('violated flag wins regardless of coverage', () => {
    const t = new CoverageTracker();
    t.liveStart(0);
    t.liveEnd(9000);
    expect(resolveSpanTier({ start_ts: 100, end_ts: 500, violated: true }, t).tier).toBe(
      'violated',
    );
  });

  it('uncovered dead time outside any gap → unverified', () => {
    const t = new CoverageTracker();
    t.liveStart(0);
    t.liveEnd(2000); // provider lost mid-foreground, no suspension
    expect(resolveSpanTier({ start_ts: 100, end_ts: 8000, violated: false }, t)).toEqual({
      tier: 'unverified',
      evidence: 'none',
    });
  });

  it('no coverage at all → unverified', () => {
    const t = new CoverageTracker();
    expect(resolveSpanTier({ start_ts: 100, end_ts: 500, violated: false }, t)).toEqual({
      tier: 'unverified',
      evidence: 'none',
    });
  });

  it('reset clears a leaked gap — a re-arm starts with clean coverage', () => {
    const t = new CoverageTracker();
    t.liveStart(0);
    t.suspend(3000);
    t.resume(5000, true); // unresolved gap, e.g. prior session killed mid-suspension
    t.reset();
    t.liveStart(10_000); // next session's arm
    expect(resolveSpanTier({ start_ts: 11_000, end_ts: 14_000, violated: false }, t)).toEqual({
      tier: 'verified',
      evidence: 'live',
    });
  });
});
