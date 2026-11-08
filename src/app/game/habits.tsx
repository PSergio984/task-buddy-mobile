/**
 * Habits screen (#71) — list, ± click scoring and CRUD. The REST click is
 * the online fast-path (fresh habit + profile back); only a status-0
 * network failure falls back to the offline event queue (`habit_click`) —
 * deterministic errors surface honestly instead. One client_event_id per
 * tap so server-side dedupe can engage on retries.
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
import { habitsApi } from '@/api/game';
import type { Habit, HabitClickDirection, HabitClickResponse, HabitInput } from '@/api/types';
import { toggled } from '@/components/game-utils';
import { HabitEditor } from '@/components/habits/habit-editor';
import { HabitRow } from '@/components/habits/habit-row';
import { Colors, Spacing } from '@/constants/colors';
import { createEventQueue } from '@/game/event-queue';

export default function HabitsScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [queue] = useState(() => createEventQueue());

  const [editor, setEditor] = useState<{ habit?: Habit } | null>(null);
  const [clickingIds, setClickingIds] = useState<ReadonlySet<number>>(new Set());
  /** Rows with a click parked in the offline queue — shown as pending-sync. */
  const [queuedIds, setQueuedIds] = useState<ReadonlySet<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  /** Queued clicks rejected past MAX_FLUSH_ATTEMPTS — an honest loss. */
  const [deadLetters, setDeadLetters] = useState(0);

  const {
    data: habits,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ['habits'],
    queryFn: () => habitsApi.list(),
    enabled: !!token,
  });

  /** Queued badges derive from the queue's persisted contents — they
   *  rehydrate on remount and survive a partial flush. */
  const refreshQueued = () =>
    setQueuedIds(
      new Set(
        queue
          .pending()
          .filter((e) => e.type === 'habit_click')
          .map((e) => Number(e.payload.habit_id))
          .filter(Number.isFinite),
      ),
    );

  /** The click response carries fresh habit+profile — fold it; the
   *  ledger-derived views (timeline, activity, achievements) still refetch. */
  const foldScore = (res: HabitClickResponse) => {
    queryClient.setQueryData<Habit[]>(['habits'], (list) =>
      list?.map((h) => (h.id === res.habit.id ? res.habit : h)),
    );
    queryClient.setQueryData(['game-profile'], res.profile);
    for (const key of ['timeline', 'activity-grid', 'activity-stats', 'achievements']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
  /** Offline replays carry no fresh rows — refetch everything scored. The
   *  queue is one shared FIFO, so a flush here may also deliver
   *  daily_check events — 'dailies' must invalidate too. */
  const invalidateAfterScore = () => {
    for (const key of [
      'habits',
      'dailies',
      'game-profile',
      'timeline',
      'activity-grid',
      'activity-stats',
      'achievements',
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  // Deliver clicks queued by an earlier session (or an earlier visit here)
  // — and keep badges honest when a flush this screen didn't start (the
  // root foreground flush, a dailies-mount retry) delivers shared events.
  useEffect(() => {
    const unsub = queue.subscribe((sent) => {
      setDeadLetters(queue.deadLetterCount());
      refreshQueued();
      if (sent > 0) invalidateAfterScore();
    });
    void queue
      .hydrate()
      .then(() => queue.flush())
      .then((r) => {
        setDeadLetters(queue.deadLetterCount());
        refreshQueued();
        if (r.sent > 0) invalidateAfterScore();
      })
      .catch(() => {});
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queue is a stable singleton
  }, [queue]);

  const createHabit = useMutation({
    mutationFn: (input: HabitInput) => habitsApi.create(input),
    onSuccess: () => {
      setEditor(null);
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
    },
  });
  const updateHabit = useMutation({
    mutationFn: ({ id, input }: { id: number; input: HabitInput }) => habitsApi.update(id, input),
    onSuccess: () => {
      setEditor(null);
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
    },
  });
  const deleteHabit = useMutation({
    mutationFn: (id: number) => habitsApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });

  const doClick = async (habit: Habit, direction: HabitClickDirection) => {
    if (clickingIds.has(habit.id)) return;
    setActionError(null);
    setClickingIds((s) => toggled(s, habit.id, true));
    // One id both ways: if the POST lands but its response dies in transit
    // (the real status-0 case), the queued replay carries the SAME dedupe
    // key — the server returns 'duplicate' instead of double-scoring.
    const eid = `mobile:${Crypto.randomUUID()}`;
    try {
      const res = await habitsApi.click(habit.id, direction, eid);
      foldScore(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Network unreachable — park the gesture on the offline queue and
        // try to flush; the row shows pending-sync until delivery lands.
        try {
          await queue.enqueue('habit_click', { habit_id: habit.id, direction }, eid);
        } catch {
          setActionError('Could not queue the click — it was not recorded.');
          return;
        }
        // The click is durably parked — release the row now and let the
        // flush retry in the background (~7s of backoff offline).
        setClickingIds((s) => toggled(s, habit.id, false));
        refreshQueued();
        void queue
          .flush()
          .then((res) => {
            setDeadLetters(queue.deadLetterCount());
            refreshQueued();
            if (res.sent > 0) invalidateAfterScore();
            if (res.failed) setActionError('Click queued — it will sync when you are back online.');
          })
          .catch(() => {
            // A persist-fault can follow delivered batches — resync anyway.
            setDeadLetters(queue.deadLetterCount());
            refreshQueued();
            invalidateAfterScore();
            setActionError('Click queued — it will sync when you are back online.');
          });
      } else {
        setActionError(e instanceof Error ? e.message : 'Could not record the click.');
      }
    } finally {
      setClickingIds((s) => toggled(s, habit.id, false));
    }
  };

  const openEditor = (habit?: Habit) => {
    createHabit.reset();
    updateHabit.reset();
    deleteHabit.reset();
    setEditor({ habit });
  };

  const confirmDelete = (habit: Habit) => {
    Alert.alert('Delete habit?', `"${habit.title}" and its counter history will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteHabit.mutate(habit.id) },
    ]);
  };

  const mutationError = createHabit.error ?? updateHabit.error ?? deleteHabit.error;

  const listHeader = (
    <View>
      <Pressable
        style={styles.newButton}
        onPress={() => openEditor()}
        accessibilityRole="button"
        accessibilityLabel="New habit"
      >
        <SymbolView
          name={{ ios: 'plus', android: 'add', web: 'add' }}
          size={14}
          tintColor={Colors.accent}
        />
        <Text style={styles.newButtonText}>New habit</Text>
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
        <Stack.Screen options={{ title: 'Habits' }} />
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Habits' }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={habits ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <HabitRow
            habit={item}
            clicking={clickingIds.has(item.id)}
            queued={queuedIds.has(item.id)}
            onClick={(direction) => void doClick(item, direction)}
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
                : 'No habits yet — tap New habit to track a good or bad pattern.'}
            </Text>
          </View>
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
        <HabitEditor
          initial={editor.habit}
          busy={createHabit.isPending || updateHabit.isPending}
          error={mutationError?.message ?? null}
          onSubmit={(input) =>
            editor.habit
              ? updateHabit.mutate({ id: editor.habit.id, input })
              : createHabit.mutate(input)
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
