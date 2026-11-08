/**
 * Pure-helper unit tests for the risky small logic the screen tests only
 * exercise through fixtures: grid column building, recurrence labels,
 * cross-midnight end labels, reminder truncation and the set-toggle.
 */
import type { ActivityDay, Recurrence } from '@/api/types';
import { buildWeeks } from '@/components/activity/contribution-grid';
import { endLabel } from '@/components/activity/timeline-blocks';
import { recurrenceLabel } from '@/components/dailies/daily-row';
import { reminderLabel, toggled } from '@/components/game-utils';

const day = (date: string): ActivityDay => ({
  date,
  score: 0,
  focus_minutes: 0,
  events: {},
  tier: 0,
});

describe('buildWeeks', () => {
  it('returns nothing for an empty window', () => {
    expect(buildWeeks([])).toEqual([]);
  });

  it('pads the first column when the window starts mid-week', () => {
    // 2025-11-05 is a Wednesday (wd=2).
    const weeks = buildWeeks([day('2025-11-05'), day('2025-11-06')]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].slice(0, 2)).toEqual([null, null]);
    expect(weeks[0][2]?.date).toBe('2025-11-05');
    expect(weeks[0][3]?.date).toBe('2025-11-06');
    expect(weeks[0].slice(4)).toEqual([null, null, null]);
  });

  it('starts a new column at every Monday and trails the last', () => {
    // Fri 2025-11-07 → Tue 2025-11-11: Mon the 10th opens column two.
    const weeks = buildWeeks([
      day('2025-11-07'),
      day('2025-11-08'),
      day('2025-11-09'),
      day('2025-11-10'),
      day('2025-11-11'),
    ]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0][4]?.date).toBe('2025-11-07'); // Friday slot
    expect(weeks[0][6]?.date).toBe('2025-11-09'); // Sunday slot
    expect(weeks[1][0]?.date).toBe('2025-11-10'); // Monday slot
    expect(weeks[1][1]?.date).toBe('2025-11-11');
    expect(weeks[1].slice(2)).toEqual([null, null, null, null, null]);
  });
});

describe('recurrenceLabel', () => {
  it.each<[Recurrence | undefined, string]>([
    [undefined, 'Custom'],
    [{ kind: 'daily' }, 'Every day'],
    [{ kind: 'weekdays', days: [] }, 'Custom'],
    [{ kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] }, 'Every day'],
    [{ kind: 'weekdays', days: [0, 4] }, 'Mon · Fri'],
    [{ kind: 'every_n_days', interval: 1 }, 'Every day'],
    [{ kind: 'every_n_days', interval: 3 }, 'Every 3 days'],
    [{ kind: 'times_per_week', count: 2 }, '2× per week'],
  ])('labels %j as %s', (recurrence, expected) => {
    expect(recurrenceLabel(recurrence)).toBe(expected);
  });
});

describe('endLabel', () => {
  const dayStart = Date.parse('2025-11-03T00:00:00Z');
  const dayEnd = dayStart + 86_400_000;

  it('returns "running" for an open block', () => {
    expect(endLabel(null, dayStart, dayEnd)).toBe('running');
  });

  it('returns HH:mm for a same-day end', () => {
    expect(endLabel('2025-11-03T22:10:00Z', dayStart, dayEnd)).toBe('22:10');
  });

  it('appends +Nd for an end past the day boundary', () => {
    // Ends 30h after day start → "+1d".
    expect(endLabel('2025-11-04T06:00:00Z', dayStart, dayEnd)).toBe('06:00 +1d');
    // Two full days later → "+2d".
    expect(endLabel('2025-11-05T00:30:00Z', dayStart, dayEnd)).toBe('00:30 +2d');
  });
});

describe('reminderLabel', () => {
  it('joins up to two times and folds the remainder', () => {
    expect(reminderLabel([])).toBe('');
    expect(reminderLabel(['08:00'])).toBe('08:00');
    expect(reminderLabel(['08:00', '13:00'])).toBe('08:00 · 13:00');
    expect(reminderLabel(['08:00', '13:00', '21:00', '22:00'])).toBe('08:00 · 13:00 +2');
  });
});

describe('toggled', () => {
  it('adds and removes without mutating the input set', () => {
    const base = new Set([1]);
    const added = toggled(base, 2, true);
    expect(added.has(2)).toBe(true);
    expect(base.has(2)).toBe(false);
    const removed = toggled(added, 1, false);
    expect(removed.has(1)).toBe(false);
    expect(removed.has(2)).toBe(true);
  });
});
