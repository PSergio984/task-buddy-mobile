/**
 * UTC-day helper tests — the suite runs on non-UTC machines, so
 * utcTimeLabel must pin offset-less backend timestamps to UTC or these
 * assertions drift with the host timezone.
 */
import { addUtcDays, utcTimeLabel } from '@/components/activity/dates';

describe('utcTimeLabel', () => {
  it('reads offset-less timestamps as UTC, not local', () => {
    expect(utcTimeLabel('2026-01-05T14:32:00')).toBe('14:32');
    expect(utcTimeLabel('2026-01-05T23:59:59.999')).toBe('23:59');
  });

  it('preserves explicit offsets (Z and ±hh:mm)', () => {
    expect(utcTimeLabel('2026-01-05T14:32:00Z')).toBe('14:32');
    expect(utcTimeLabel('2026-01-05T16:32:00+02:00')).toBe('14:32');
    expect(utcTimeLabel('2026-01-05T09:32:00-05:00')).toBe('14:32');
  });

  it('degrades unparseable input to --:--', () => {
    expect(utcTimeLabel('not a date')).toBe('--:--');
  });
});

describe('addUtcDays', () => {
  it('steps across month and year boundaries', () => {
    expect(addUtcDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addUtcDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});
