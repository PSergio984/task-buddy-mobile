/**
 * usePhoneDownHistory — folds the newest page of the game-event ledger into
 * per-session phone-down rows for the "Recent" list.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { gameApi } from '@/api/game';
import type { GameEventRead } from '@/api/types';
import type { PhoneDownHistoryRow } from '@/components/focus/history-list';

/**
 * Newest page of the ledger feed, newest-first (`desc`) — a "recent
 * sessions" list must not page from id 0 or heavy users would see their
 * EARLIEST sessions under "Recent".
 */
const HISTORY_PAGE_SIZE = 500;

export function usePhoneDownHistory(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['game-events'],
    queryFn: async (): Promise<GameEventRead[]> =>
      (await gameApi.getEvents(null, HISTORY_PAGE_SIZE, true)).events,
    enabled,
  });
  return useMemo(() => {
    type Row = PhoneDownHistoryRow & { at: string };
    const bySession = new Map<number, Row>();
    // focus_phase_completed rows carry the server-adjudicated
    // streak/multiplier in their resolved phone_down block — the feed is
    // newest-first, so the first hit per session is the final verdict.
    const streakBySession = new Map<number, { streak: number; mult: number }>();
    const rank: Record<string, number> = { verified: 0, unverified: 1, violated: 2 };
    const tierOf = (v: unknown) =>
      v === 'verified' || v === 'unverified' || v === 'violated' ? v : null;
    for (const e of data ?? []) {
      if (e.type === 'focus_phase_completed') {
        const sessionId = Number(e.payload.session_id);
        const block = e.payload.phone_down as
          { streak_count?: unknown; xp_multiplier?: unknown } | undefined;
        if (
          Number.isFinite(sessionId) &&
          !streakBySession.has(sessionId) &&
          typeof block?.streak_count === 'number' &&
          typeof block?.xp_multiplier === 'number'
        ) {
          streakBySession.set(sessionId, {
            streak: block.streak_count,
            mult: block.xp_multiplier,
          });
        }
        continue;
      }
      if (e.type !== 'phone_down_span' && e.type !== 'phone_down_violation') continue;
      const sessionId = Number(e.payload.session_id);
      if (!Number.isFinite(sessionId)) continue;
      const row = bySession.get(sessionId) ?? {
        sessionId,
        worst: 'verified' as const,
        spans: 0,
        violations: 0,
        at: e.server_ts,
      };
      if (e.type === 'phone_down_span') {
        row.spans += 1;
        // The server-adjudicated tier rides in the stored row's _outcome;
        // the claim is only a fallback for rows that didn't apply.
        const outcome = e.payload._outcome as { tier?: unknown } | undefined;
        const tier = tierOf(outcome?.tier) ?? tierOf(e.payload.claimed_tier);
        if (tier !== null && rank[tier] > rank[row.worst]) row.worst = tier;
      } else {
        row.violations += 1;
        row.worst = 'violated';
      }
      if (e.server_ts > row.at) row.at = e.server_ts;
      bySession.set(sessionId, row);
    }
    return [...bySession.entries()]
      .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
      .slice(0, 8)
      .map(([sessionId, row]) => {
        const streak = streakBySession.get(sessionId);
        // `at` is sort bookkeeping, not part of the row shape callers get.
        const { at: _at, ...rest } = row;
        return {
          ...rest,
          sessionId,
          streakCount: streak?.streak,
          xpMultiplier: streak?.mult,
        };
      });
  }, [data]);
}
