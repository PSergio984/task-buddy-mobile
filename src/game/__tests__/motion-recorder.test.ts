/**
 * classifyGapStats — the iOS retro verdict boundaries: not enough data is
 * 'unknown' (never promoted), a z-window pinned inside the flat band is
 * 'stayed_flat', anything outside is 'moved'. The flat bounds are strict:
 * a sample exactly ON a bound is not flat. The samples must also BRACKET
 * the gap — a recorder hole at either end is 'unknown', never promoted.
 */
import { classifyGapStats, type AccelerometerWindowStats } from '../sensors/motion-recorder';

const FROM = 1_000_000;
const TO = FROM + 10 * 60_000; // 10-minute gap

const stats = (over: Partial<AccelerometerWindowStats>): AccelerometerWindowStats => ({
  count: 10,
  minZ: 1.0,
  maxZ: 1.0,
  meanZ: 1.0,
  firstTs: FROM,
  lastTs: TO,
  ...over,
});

const call = (s: AccelerometerWindowStats | null, t?: Parameters<typeof classifyGapStats>[3]) =>
  classifyGapStats(s, FROM, TO, t);

describe('classifyGapStats', () => {
  it('null stats or too few samples → unknown', () => {
    expect(call(null)).toBe('unknown');
    expect(call(stats({ count: 0 }))).toBe('unknown');
    expect(call(stats({ count: 2 }))).toBe('unknown'); // < minSamples 3
  });

  it('samples missing a gap edge beyond the slop → unknown', () => {
    const inside = 60_000 - 1;
    const outside = 60_000 + 1;
    // Inside slop still proves; outside it the tail is unmeasured.
    expect(call(stats({ firstTs: FROM + inside }))).toBe('stayed_flat');
    expect(call(stats({ firstTs: FROM + outside }))).toBe('unknown');
    expect(call(stats({ lastTs: TO - inside }))).toBe('stayed_flat');
    expect(call(stats({ lastTs: TO - outside }))).toBe('unknown');
    // Three samples clustered at the gap start — the cubic P1 hole.
    expect(call(stats({ count: 3, lastTs: FROM + 1_000 }))).toBe('unknown');
  });

  it('z pinned inside the flat window for the whole gap → stayed_flat', () => {
    expect(call(stats({ minZ: 0.95, maxZ: 1.05 }))).toBe('stayed_flat');
    expect(call(stats({ minZ: 0.81, maxZ: 1.44 }))).toBe('stayed_flat');
  });

  it('the flat bounds are strict — exactly on a bound is not flat → moved', () => {
    expect(call(stats({ minZ: 0.8, maxZ: 1.0 }))).toBe('moved');
    expect(call(stats({ minZ: 1.0, maxZ: 1.45 }))).toBe('moved');
  });

  it('any excursion outside the window → moved', () => {
    expect(call(stats({ minZ: -0.5, maxZ: 1.0 }))).toBe('moved');
    expect(call(stats({ minZ: 1.0, maxZ: 2.2 }))).toBe('moved');
  });

  it('custom thresholds are respected', () => {
    const t = { minSamples: 5, flatMin: 0.9, flatMax: 1.1, edgeSlopMs: 60_000 };
    expect(call(stats({ count: 4 }), t)).toBe('unknown');
    expect(call(stats({ minZ: 0.95, maxZ: 1.05 }), t)).toBe('stayed_flat');
    expect(call(stats({ minZ: 0.85 }), t)).toBe('moved');
  });
});
