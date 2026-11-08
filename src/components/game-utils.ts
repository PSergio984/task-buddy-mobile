/** Small shared helpers for the game screens — previously copied between
 *  the habits and dailies surfaces. */

/** Mon=0 weekday order — the backend `weekdays` recurrence convention. */
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Copy-on-toggle for ReadonlySet state (clicking/queued id sets). */
export function toggled(set: ReadonlySet<number>, id: number, on: boolean): ReadonlySet<number> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/** Up to two reminder times shown, then a "+n" remainder. */
export function reminderLabel(times: string[]): string {
  if (times.length <= 2) return times.join(' · ');
  return `${times.slice(0, 2).join(' · ')} +${times.length - 2}`;
}
