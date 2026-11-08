/**
 * Dailies screen (#71) — list, whole-daily and per-item checking, and CRUD.
 * The REST check is the online fast-path; only a status-0 network failure
 * falls back to the offline event queue (`daily_check`) — deterministic
 * errors surface honestly instead. One client_event_id per gesture so
 * server-side dedupe can engage on retries.
 *
 * done_today / completed_today are per-UTC-day server state — the screen
 * re-invalidates at the UTC rollover so an open page can't un-mark
 * yesterday's checks (web: useUtcDayRollover).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/api/auth';
import { ApiError } from '@/api/client';
import { dailiesApi } from '@/api/game';
import type { Daily, DailyCheckInput, DailyCheckResponse, DailyInput } from '@/api/types';
import { DailyEditor } from '@/components/dailies/daily-editor';
import { DailyRow } from '@/components/dailies/daily-row';
import { toggled } from '@/components/game-utils';
import { Colors, Spacing } from '@/constants/colors';
import { createEventQueue } from '@/game/event-queue';

export default function DailiesScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [queue] = useState(() => createEventQueue());

  const [editor, setEditor] = useState<{ daily?: Daily } | null>(null);
  const [checkingIds, setCheckingIds] = useState<ReadonlySet<number>>(new Set());
  /** Rows with a check parked in the offline queue — shown as pending-sync. */
  const [queuedIds, setQueuedIds] = useState<ReadonlySet<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  /** Queued checks rejected past MAX_FLUSH_ATTEMPTS — an honest loss. */
  const [deadLetters, setDeadLetters] = useState(0);

  const {
    data: dailies,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ['dailies'],
    queryFn: () => dailiesApi.list(),
    enabled: !!token,
  });

  /** Queued badges derive from the queue's persisted contents — they
   *  rehydrate on remount and survive a partial flush. */
  const refreshQueued = () =>
    setQueuedIds(
      new Set(
        queue
          .pending()
          .filter((e) => e.type === 'daily_check')
          .map((e) => Number(e.payload.daily_id))
          .filter(Number.isFinite),
      ),
    );

  /** The check response carries fresh daily+profile — fold it; the
   *  ledger-derived views (timeline, activity, achievements) still refetch. */
  const foldScore = (res: DailyCheckResponse) => {
    queryClient.setQueryData<Daily[]>(['dailies'], (list) =>
      list?.map((d) => (d.id === res.daily.id ? res.daily : d)),
    );
    queryClient.setQueryData(['game-profile'], res.profile);
    for (const key of ['timeline', 'activity-grid', 'activity-stats', 'achievements']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
  /** Offline replays carry no fresh rows — refetch everything scored. The
   *  queue is one shared FIFO, so a flush here may also deliver
   *  habit_click events — 'habits' must invalidate too. */
  const invalidateAfterScore = () => {
    for (const key of [
      'dailies',
      'habits',
      'game-profile',
      'timeline',
      'activity-grid',
      'activity-stats',
      'achievements',
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  // Deliver checks queued by an earlier session (or an earlier visit here).
  useEffect(() => {
    void queue
      .hydrate()
      .then(() => queue.flush())
      .then((r) => {
        setDeadLetters(queue.deadLetterCount());
        refreshQueued();
        if (r.sent > 0) invalidateAfterScore();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queue is a stable singleton
  }, [queue]);

  // UTC-day rollover — see the file header.
  useEffect(() => {
    let day = new Date().getUTCDate();
    const id = setInterval(() => {
      const now = new Date().getUTCDate();
      if (now !== day) {
        day = now;
        void queryClient.invalidateQueries({ queryKey: ['dailies'] });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [queryClient]);

  const createDaily = useMutation({
    mutationFn: (input: DailyInput) => dailiesApi.create(input),
    onSuccess: () => {
      setEditor(null);
      void queryClient.invalidateQueries({ queryKey: ['dailies'] });
    },
  });
  const updateDaily = useMutation({
    mutationFn: ({ id, input }: { id: number; input: DailyInput }) => dailiesApi.update(id, input),
    onSuccess: () => {
      setEditor(null);
      void queryClient.invalidateQueries({ queryKey: ['dailies'] });
    },
  });
  const deleteDaily = useMutation({
    mutationFn: (id: number) => dailiesApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['dailies'] }),
  });

  const doCheck = async (daily: Daily, input: DailyCheckInput) => {
    if (checkingIds.has(daily.id)) return;
    setActionError(null);
    setCheckingIds((s) => toggled(s, daily.id, true));
    // One id both ways — see the header in habits.tsx (same dedupe key on
    // the REST call and its queued replay).
    const eid = `mobile:${Crypto.randomUUID()}`;
    try {
      const res = await dailiesApi.check(daily.id, input, eid);
      foldScore(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Network unreachable — park the gesture on the offline queue and
        // try to flush; the row shows pending-sync until delivery lands.
        try {
          await queue.enqueue(
            'daily_check',
            {
              daily_id: daily.id,
              daily_item_id: input.daily_item_id ?? null,
              done: input.done ?? true,
            },
            eid,
          );
          refreshQueued();
          try {
            const res = await queue.flush();
            setDeadLetters(queue.deadLetterCount());
            refreshQueued();
            if (res.sent > 0) invalidateAfterScore();
          } catch {
            // Enqueue already persisted — a flush fault can't lose it.
            setActionError('Check queued — it will sync when you are back online.');
          }
        } catch {
          setActionError('Could not queue the check — it was not recorded.');
        }
      } else {
        setActionError(e instanceof Error ? e.message : 'Could not record the check.');
      }
    } finally {
      setCheckingIds((s) => toggled(s, daily.id, false));
    }
  };

  const openEditor = (daily?: Daily) => {
    createDaily.reset();
    updateDaily.reset();
    setEditor({ daily });
  };

  const confirmDelete = (daily: Daily) => {
    Alert.alert(
      'Delete daily?',
      `"${daily.title}" and its checklist will be removed — its streak is lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteDaily.mutate(daily.id) },
      ],
    );
  };

  const mutationError = createDaily.error ?? updateDaily.error ?? deleteDaily.error;

  const listHeader = (
    <View>
      <Pressable
        style={styles.newButton}
        onPress={() => openEditor()}
        accessibilityRole="button"
        accessibilityLabel="New daily"
      >
        <SymbolView
          name={{ ios: 'plus', android: 'add', web: 'add' }}
          size={14}
          tintColor={Colors.accent}
        />
        <Text style={styles.newButtonText}>New daily</Text>
      </Pressable>
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      {deadLetters > 0 ? (
        <Text style={styles.errorText}>
          {deadLetters} queued {deadLetters === 1 ? 'action was' : 'actions were'} rejected and
          dropped.
        </Text>
      ) : null}
      {mutationError ? <Text style={styles.errorText}>{mutationError.message}</Text> : null}
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Dailies' }} />
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Dailies' }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={dailies ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <DailyRow
            daily={item}
            checking={checkingIds.has(item.id)}
            queued={queuedIds.has(item.id)}
            onCheck={(input) => void doCheck(item, input)}
            onEdit={() => openEditor(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>
              {error instanceof Error
                ? error.message
                : 'No dailies yet — tap New daily to build a recurring routine.'}
            </Text>
          </View>
        }
        ListFooterComponent={
          dailies !== undefined && dailies.length > 0 ? (
            <Text style={styles.footerNote}>
              Unchecked scheduled days cost HP after the ~3am UTC grace — one miss per rolling 7
              scheduled days keeps the streak; the HP loss still applies.
            </Text>
          ) : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
      />
      {editor !== null ? (
        <DailyEditor
          initial={editor.daily}
          busy={createDaily.isPending || updateDaily.isPending}
          error={mutationError?.message ?? null}
          onSubmit={(input) =>
            editor.daily
              ? updateDaily.mutate({ id: editor.daily.id, input })
              : createDaily.mutate(input)
          }
          onClose={() => setEditor(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  list: { flex: 1, backgroundColor: Colors.background },
  listContent: { padding: Spacing.four, gap: Spacing.two, flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.five },
  emptyText: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center' },
  errorText: { color: Colors.danger, fontSize: 13, marginBottom: Spacing.two },
  footerNote: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: Spacing.three,
    textAlign: 'center',
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: Spacing.three,
    minHeight: 48,
    marginBottom: Spacing.two,
  },
  newButtonText: { color: Colors.accent, fontSize: 15, fontWeight: '700' },
});
