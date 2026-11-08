/**
 * UTC calendar-day helpers — the backend buckets activity, timeline and
 * diary data by the UTC day, so screens navigate "YYYY-MM-DD" strings on
 * that axis rather than local dates (mirrors the web lib/diary.ts).
 */

/** A UTC calendar day, "YYYY-MM-DD". */
export type UtcDay = string;

const DAY_MS = 86_400_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function todayUtcDay(): UtcDay {
  return new Date().toISOString().slice(0, 10);
}

export function addUtcDays(day: UtcDay, n: number): UtcDay {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Short label for the day navigator, e.g. "Sat, Nov 1". */
export function utcDayLabel(day: UtcDay): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "14:32" — HH:mm on the UTC axis (the same axis the backend buckets on). */
export function utcTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}
