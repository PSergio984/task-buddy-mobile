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
  GameEventsFeedResponse,
  GameEventIn,
  GameSyncResponse,
  SessionActionResponse,
  SessionStartRequest,
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
