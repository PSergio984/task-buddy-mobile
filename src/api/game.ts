/**
 * Typed wrappers for the gamified focus layer endpoints
 * (app/api/routers/game.py + game_sessions.py on the backend).
 *
 * Sessions are SERVER-authoritative: start/pause/resume/advance/stop are
 * REST calls that need connectivity. Phone-down evidence is the exception —
 * it rides the offline event queue through POST /api/v1/game/events.
 */
import { apiFetch } from './client';
import type {
  Achievement,
  ActivityGrid,
  ActivityStats,
  Daily,
  DailyCheckInput,
  DailyCheckResponse,
  DailyInput,
  DailyPatch,
  DiaryEntry,
  DiaryEntryInput,
  DiaryEntryPatch,
  DiaryListResponse,
  GameClass,
  GameEventsFeedResponse,
  GameEventIn,
  GameProfile,
  GameSyncResponse,
  GearItem,
  GearListResponse,
  Habit,
  HabitClickDirection,
  HabitClickResponse,
  HabitInput,
  HabitPatch,
  RetentionPreference,
  SessionActionResponse,
  SessionStartRequest,
  StatKey,
  TimelineDayResponse,
} from './types';

export const gameApi = {
  /** Batch-ingest queued client events; idempotent per client_event_id. */
  postEvents: (events: GameEventIn[]) =>
    apiFetch<GameSyncResponse>('/api/v1/game/events', {
      method: 'POST',
      json: { events },
    }),

  /** Ledger catchup feed: rows with id > `since` oldest-first (0 = from the
   *  start). `desc` returns the newest rows first instead — `since` then
   *  means "older than this id" for paging deeper (null = newest page). */
  getEvents: (since: number | null = 0, limit = 200, desc = false) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (since !== null) params.set('since', String(since));
    if (desc) params.set('desc', '1');
    return apiFetch<GameEventsFeedResponse>(`/api/v1/game/events?${params}`);
  },

  getProfile: () => apiFetch<GameProfile>('/api/v1/game/profile'),

  updateRetention: (retention: RetentionPreference) =>
    apiFetch<GameProfile>('/api/v1/game/profile/retention', {
      method: 'PATCH',
      json: { retention },
    }),

  updateAvatarConfig: (avatarConfig: Record<string, unknown>) =>
    apiFetch<GameProfile>('/api/v1/game/profile/avatar', {
      method: 'PATCH',
      json: { avatar_config: avatarConfig },
    }),
};

/**
 * Habit CRUD + the online fast-path click. Scoring CAN also ride the
 * offline event queue (`habit_click` {habit_id, direction}) — screens
 * prefer this REST call when online (returns fresh habit + profile) and
 * fall back to the queue when the request can't reach the server.
 * `client_event_id` is caller-minted per gesture so retries dedupe.
 */
export const habitsApi = {
  list: () => apiFetch<Habit[]>('/api/v1/game/habits'),
  create: (input: HabitInput) =>
    apiFetch<Habit>('/api/v1/game/habits', { method: 'POST', json: input }),
  update: (id: number, patch: HabitPatch) =>
    apiFetch<Habit>(`/api/v1/game/habits/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: number) => apiFetch<void>(`/api/v1/game/habits/${id}`, { method: 'DELETE' }),
  click: (id: number, direction: HabitClickDirection, clientEventId: string) =>
    apiFetch<HabitClickResponse>(`/api/v1/game/habits/${id}/click`, {
      method: 'POST',
      json: { direction, client_event_id: clientEventId },
    }),
};

/** Daily CRUD + the online fast-path check — same online/queue split as
 *  habits (`daily_check` {daily_id, daily_item_id?, done?} on the queue). */
export const dailiesApi = {
  list: () => apiFetch<Daily[]>('/api/v1/game/dailies'),
  create: (input: DailyInput) =>
    apiFetch<Daily>('/api/v1/game/dailies', { method: 'POST', json: input }),
  update: (id: number, patch: DailyPatch) =>
    apiFetch<Daily>(`/api/v1/game/dailies/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: number) => apiFetch<void>(`/api/v1/game/dailies/${id}`, { method: 'DELETE' }),
  check: (id: number, input: DailyCheckInput, clientEventId: string) =>
    apiFetch<DailyCheckResponse>(`/api/v1/game/dailies/${id}/check`, {
      method: 'POST',
      json: { ...input, client_event_id: clientEventId },
    }),
};

/** Character sheet — allocation, class select, respec, auto-allocate. */
export const characterApi = {
  update: (autoAllocate: boolean) =>
    apiFetch<GameProfile>('/api/v1/game/character', {
      method: 'PATCH',
      json: { auto_allocate: autoAllocate },
    }),
  allocate: (points: Partial<Record<StatKey, number>>) =>
    apiFetch<GameProfile>('/api/v1/game/character/allocate', {
      method: 'POST',
      json: { points },
    }),
  selectClass: (gameClass: GameClass) =>
    apiFetch<GameProfile>('/api/v1/game/character/class', {
      method: 'POST',
      json: { game_class: gameClass },
    }),
  respec: () =>
    apiFetch<GameProfile>('/api/v1/game/character/respec', { method: 'POST', json: {} }),
};

export const gearApi = {
  list: () => apiFetch<GearItem[]>('/api/v1/game/gear'),
  buy: (key: string) =>
    apiFetch<GearListResponse>('/api/v1/game/gear/buy', { method: 'POST', json: { key } }),
  equip: (key: string, equipped: boolean) =>
    apiFetch<GearListResponse>('/api/v1/game/gear/equip', {
      method: 'POST',
      json: { key, equipped },
    }),
  toggleCostume: (key: string, costume: boolean) =>
    apiFetch<GearListResponse>('/api/v1/game/gear/costume', {
      method: 'POST',
      json: { key, costume },
    }),
};

export const achievementsApi = {
  list: () => apiFetch<Achievement[]>('/api/v1/game/achievements'),
};

/** Contribution grid + rollup stats (game_tracking endpoints). */
export const activityApi = {
  grid: () => apiFetch<ActivityGrid>('/api/v1/game/activity'),
  stats: () => apiFetch<ActivityStats>('/api/v1/game/activity/stats'),
};

export const diaryApi = {
  list: (date?: string) => {
    const qs = date ? `?${new URLSearchParams({ date })}` : '';
    return apiFetch<DiaryListResponse>(`/api/v1/game/diary${qs}`);
  },
  create: (input: DiaryEntryInput) =>
    apiFetch<DiaryEntry>('/api/v1/game/diary', { method: 'POST', json: input }),
  update: (id: number, patch: DiaryEntryPatch) =>
    apiFetch<DiaryEntry>(`/api/v1/game/diary/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: number) => apiFetch<void>(`/api/v1/game/diary/${id}`, { method: 'DELETE' }),
};

export const timelineApi = {
  day: (date: string) =>
    apiFetch<TimelineDayResponse>(`/api/v1/game/timeline?${new URLSearchParams({ date })}`),
};

export const sessionsApi = {
  start: (body: SessionStartRequest) =>
    apiFetch<SessionActionResponse>('/api/v1/game/sessions', {
      method: 'POST',
      json: body,
    }),
  getActive: () => apiFetch<SessionActionResponse | null>('/api/v1/game/sessions/active'),
  pause: (sessionId: number) =>
    apiFetch<SessionActionResponse>(`/api/v1/game/sessions/${sessionId}/pause`, {
      method: 'POST',
      json: {},
    }),
  resume: (sessionId: number) =>
    apiFetch<SessionActionResponse>(`/api/v1/game/sessions/${sessionId}/resume`, {
      method: 'POST',
      json: {},
    }),
  /** Advance to the next phase (skip break / start pending phase). */
  advance: (sessionId: number) =>
    apiFetch<SessionActionResponse>(`/api/v1/game/sessions/${sessionId}/advance`, {
      method: 'POST',
      json: {},
    }),
  stop: (sessionId: number) =>
    apiFetch<SessionActionResponse>(`/api/v1/game/sessions/${sessionId}/stop`, {
      method: 'POST',
      json: {},
    }),
};
