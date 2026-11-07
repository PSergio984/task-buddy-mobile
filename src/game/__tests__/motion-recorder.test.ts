/**
 * classifyGapStats — the iOS retro verdict boundaries: not enough data is
 * 'unknown' (never promoted), a z-window pinned inside the flat band is
 * 'stayed_flat', anything outside is 'moved'. The flat bounds are strict:
 * a sample exactly ON a bound is not flat.
 */
import { classifyGapStats, type AccelerometerWindowStats } from '../sensors/motion-recorder';

const stats = (over: Partial<AccelerometerWindowStats>): AccelerometerWindowStats => ({
  count: 10,
  minZ: 1.0,
  maxZ: 1.0,
  meanZ: 1.0,
  ...over,
});

describe('classifyGapStats', () => {
  it('null stats or too few samples → unknown', () => {
    expect(classifyGapStats(null)).toBe('unknown');
    expect(classifyGapStats(stats({ count: 0 }))).toBe('unknown');
    expect(classifyGapStats(stats({ count: 2 }))).toBe('unknown'); // < minSamples 3
  });

  it('z pinned inside the flat window for the whole gap → stayed_flat', () => {
    expect(classifyGapStats(stats({ minZ: 0.95, maxZ: 1.05 }))).toBe('stayed_flat');
    expect(classifyGapStats(stats({ minZ: 0.81, maxZ: 1.44 }))).toBe('stayed_flat');
  });

  it('the flat bounds are strict — exactly on a bound is not flat → moved', () => {
    expect(classifyGapStats(stats({ minZ: 0.8, maxZ: 1.0 }))).toBe('moved');
    expect(classifyGapStats(stats({ minZ: 1.0, maxZ: 1.45 }))).toBe('moved');
  });

  it('any excursion outside the window → moved', () => {
    expect(classifyGapStats(stats({ minZ: -0.5, maxZ: 1.0 }))).toBe('moved');
    expect(classifyGapStats(stats({ minZ: 1.0, maxZ: 2.2 }))).toBe('moved');
  });

  it('custom thresholds are respected', () => {
    const t = { minSamples: 5, flatMin: 0.9, flatMax: 1.1 };
    expect(classifyGapStats(stats({ count: 4 }), t)).toBe('unknown');
    expect(classifyGapStats(stats({ minZ: 0.95, maxZ: 1.05 }), t)).toBe('stayed_flat');
    expect(classifyGapStats(stats({ minZ: 0.85 }), t)).toBe('moved');
  });
});
