/**
 * Focus-session view helpers — trimmed port of the web app's
 * lib/focus-session.ts for the timer + stopwatch modes only
 * (speedrun is out of scope for #70). Same presets, same clock math, same
 * pause/awaiting semantics, so a session reads identically on both clients.
 *
 * The backend session engine stays authoritative: these only *render* the
 * last SessionActionResponse — they never mutate or adjudicate.
 */

import type { GameSession, SessionPhaseIn, SessionPhaseOut } from '@/api/types';

/** Long break replaces the short break after every Nth focus phase. */
const LONG_BREAK_EVERY = 4;

const GRACE_SECONDS = 300; // absence grace after a phase boundary
const STOPWATCH_MILESTONE_SECONDS = 25 * 60;

/** Pomodoro presets — same durations as web FOCUS_PRESETS. */
export const FOCUS_PRESETS = {
  classic: { label: 'Classic', focus: 25, short: 5, long: 15 },
  quick: { label: 'Quick', focus: 15, short: 3, long: 10 },
  deep: { label: 'Extended', focus: 50, short: 10, long: 30 },
} as const;

export type FocusPresetId = keyof typeof FOCUS_PRESETS;

/** Concrete focus/break/long-break minutes — a named preset or custom. */
export interface PhaseDurations {
  focus: number;
  short: number;
  long: number;
}

const clampInt = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** Form-field parse — a non-numeric custom duration falls back to the
 *  preset default rather than rejecting the whole start. */
export const numOr = (text: string, fallback: number) => {
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Expand durations into the flat phase list SessionStartIn.phases expects
 *  (same clamps as web buildPhasePlan: 1–600 min legs, 1–8 cycles). */
export function buildPhasePlan(durations: PhaseDurations, cycles = 4): SessionPhaseIn[] {
  const focus = clampInt(durations.focus, 1, 600);
  const short = clampInt(durations.short, 1, 600);
  const long = clampInt(durations.long, 1, 600);
  const n = clampInt(cycles, 1, 8);
  const phases: SessionPhaseIn[] = [];
  for (let i = 0; i < n; i++) {
    phases.push({ kind: 'focus', minutes: focus });
    const longDue = (i + 1) % LONG_BREAK_EVERY === 0 || i === n - 1;
    phases.push({ kind: 'break', minutes: longDue ? long : short });
  }
  return phases;
}

/* --- Phase/session state helpers (mirror web lib/focus-session.ts) --- */

const LIVE = new Set(['active', 'paused']);

function livePhase(session: GameSession): SessionPhaseOut | null {
  return session.phases.find((p) => LIVE.has(p.status)) ?? null;
}

function nextPendingPhase(session: GameSession): SessionPhaseOut | null {
  return session.phases.find((p) => p.status === 'pending') ?? null;
}

function completedFocusCount(session: GameSession): number {
  return session.phases.filter((p) => p.kind === 'focus' && p.status === 'completed').length;
}

function focusPhaseCount(session: GameSession): number {
  return session.phases.filter((p) => p.kind === 'focus').length;
}

/** ISO → epoch ms; offset-less strings (SQLite datetimes) parse as UTC. */
const isoToMs = (iso: string | null): number | null => {
  if (iso === null) return null;
  const hasOffset = /[zZ]$/.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
  return Date.parse(hasOffset ? iso : `${iso}Z`);
};

/** Wall-clock instant an active timed phase ends (banked pauses included). */
function phaseEndMs(phase: SessionPhaseOut): number | null {
  const start = isoToMs(phase.started_at);
  if (start === null) return null;
  return start + (phase.planned_seconds + (phase.paused_seconds || 0)) * 1000;
}

/** Seconds left on a timed phase; freezes while paused. */
function remainingSeconds(phase: SessionPhaseOut, nowMs: number): number {
  const end = phaseEndMs(phase);
  if (end === null) return phase.planned_seconds;
  const anchor =
    phase.status === 'paused' && phase.pause_started_at !== null
      ? (isoToMs(phase.pause_started_at) ?? nowMs)
      : nowMs;
  return Math.max(0, Math.ceil((end - anchor) / 1000));
}

/** Clocked (unpaused) seconds a stopwatch leg has banked so far. */
function stopwatchElapsedSeconds(phase: SessionPhaseOut, nowMs: number): number {
  const start = isoToMs(phase.started_at);
  if (start === null) return 0;
  let anchor = nowMs;
  if (phase.status === 'paused' && phase.pause_started_at !== null) {
    anchor = isoToMs(phase.pause_started_at) ?? nowMs;
  } else if (phase.ended_at !== null) {
    anchor = isoToMs(phase.ended_at) ?? nowMs;
  }
  return Math.max(0, Math.trunc((anchor - start) / 1000) - (phase.paused_seconds || 0));
}

/** Total paused seconds on a phase, including the still-open pause. */
function pauseUsedSeconds(phase: SessionPhaseOut, nowMs: number): number {
  let used = phase.paused_seconds || 0;
  if (phase.status === 'paused' && phase.pause_started_at !== null) {
    const start = isoToMs(phase.pause_started_at);
    if (start !== null) used += Math.max(0, Math.trunc((nowMs - start) / 1000));
  }
  return used;
}

/** Newest finished phase end (or session start) — the grace-window anchor. */
function lastEndMs(session: GameSession): number {
  const ends = session.phases
    .map((p) => isoToMs(p.ended_at))
    .filter((v): v is number => v !== null);
  return ends.length > 0 ? Math.max(...ends) : (isoToMs(session.started_at) ?? 0);
}

function graceDeadlineMs(session: GameSession): number | null {
  if (livePhase(session) !== null || nextPendingPhase(session) === null) {
    return null;
  }
  return lastEndMs(session) + GRACE_SECONDS * 1000;
}

export type SessionClockStatus = 'awaiting' | 'running' | 'paused' | 'ended' | 'abandoned';

export interface SessionView {
  status: SessionClockStatus;
  live: SessionPhaseOut | null;
  pending: SessionPhaseOut | null;
  /** Seconds the timer should show (remaining for timed, elapsed stopwatch). */
  clockSeconds: number;
  /** Ring fill fraction 0..1. */
  progress: number;
  /** Uppercase sub-label under the clock, e.g. "FOCUS · PHASE 1/4". */
  kindLabel: string;
  focusDone: number;
  focusTotal: number;
  /** Pause budget left on the live phase; null when pausing doesn't apply. */
  pausesLeft: number | null;
  pauseUsedSec: number;
  pauseBudgetSec: number;
  /** Seconds until absence-grace ends the session (awaiting only). */
  graceEndsInSec: number | null;
}

const KIND_LABEL: Record<string, string> = {
  focus: 'Focus',
  break: 'Break',
  stopwatch: 'Stopwatch',
};

export function deriveSessionView(session: GameSession, nowMs: number): SessionView {
  const live = livePhase(session);
  const pending = nextPendingPhase(session);
  const focusDone = completedFocusCount(session);
  const focusTotal = focusPhaseCount(session);
  const base = {
    live,
    pending,
    focusDone,
    focusTotal,
    pauseUsedSec: live ? pauseUsedSeconds(live, nowMs) : 0,
    pauseBudgetSec: session.pause_budget_seconds,
    graceEndsInSec: null as number | null,
    pausesLeft: null as number | null,
  };
  if (session.status !== 'active') {
    return {
      ...base,
      status: session.status === 'abandoned' ? 'abandoned' : 'ended',
      clockSeconds: 0,
      progress: 1,
      kindLabel: session.status === 'abandoned' ? 'Abandoned' : 'Session complete',
    };
  }
  if (live === null) {
    const grace = graceDeadlineMs(session);
    return {
      ...base,
      status: 'awaiting',
      clockSeconds: pending?.planned_seconds ?? 0,
      progress: 0,
      kindLabel:
        pending === null ? 'Wrapping up' : `Up next: ${KIND_LABEL[pending.kind] ?? pending.kind}`,
      graceEndsInSec: grace === null ? null : Math.max(0, Math.ceil((grace - nowMs) / 1000)),
    };
  }
  const isStopwatch = live.kind === 'stopwatch';
  const remaining = isStopwatch ? 0 : remainingSeconds(live, nowMs);
  const elapsed = isStopwatch ? stopwatchElapsedSeconds(live, nowMs) : 0;
  const focusOrdinal =
    live.kind === 'focus'
      ? session.phases.filter((p) => p.kind === 'focus').findIndex((p) => p.seq === live.seq) + 1
      : focusDone;
  return {
    ...base,
    status: live.status === 'paused' ? 'paused' : 'running',
    clockSeconds: isStopwatch ? elapsed : remaining,
    progress: isStopwatch
      ? (elapsed % STOPWATCH_MILESTONE_SECONDS) / STOPWATCH_MILESTONE_SECONDS
      : live.planned_seconds > 0
        ? Math.min(1, Math.max(0, 1 - remaining / live.planned_seconds))
        : 0,
    kindLabel:
      live.kind === 'focus'
        ? `Focus · phase ${focusOrdinal}/${focusTotal}`
        : (KIND_LABEL[live.kind] ?? live.kind),
    pausesLeft:
      live.kind === 'focus' ? Math.max(0, session.pause_budget_count - live.pause_count) : null,
  };
}

/** `m:ss` or `h:mm:ss` — the timer's center readout. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
