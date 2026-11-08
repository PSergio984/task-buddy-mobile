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
import type { Habit, HabitClickDirection, HabitInput } from '@/api/types';
import { HabitEditor } from '@/components/habits/habit-editor';
import { HabitRow } from '@/components/habits/habit-row';
import { Colors, Spacing } from '@/constants/colors';
import { createEventQueue } from '@/game/event-queue';

function toggled(set: ReadonlySet<number>, id: number, on: boolean): ReadonlySet<number> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export default function HabitsScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [queue] = useState(() => createEventQueue());

  const [editor, setEditor] = useState<{ habit?: Habit } | null>(null);
  const [clickingIds, setClickingIds] = useState<ReadonlySet<number>>(new Set());
  /** Rows with a click parked in the offline queue — shown as pending-sync. */
  const [queuedIds, setQueuedIds] = useState<ReadonlySet<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

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

  const invalidateAfterScore = () => {
    void queryClient.invalidateQueries({ queryKey: ['habits'] });
    void queryClient.invalidateQueries({ queryKey: ['game-profile'] });
    // A click lands a habit_click ledger row — the timeline feed needs it too.
    void queryClient.invalidateQueries({ queryKey: ['game-events'] });
  };

  // Deliver clicks queued by an earlier session (or an earlier visit here).
  useEffect(() => {
    void queue
      .hydrate()
      .then(() => queue.flush())
      .then((r) => {
        if (r.sent > 0) {
          setQueuedIds(new Set());
          invalidateAfterScore();
        }
      })
      .catch(() => {});
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
    try {
      await habitsApi.click(habit.id, direction, Crypto.randomUUID());
      setQueuedIds((s) => toggled(s, habit.id, false));
      invalidateAfterScore();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Network unreachable — park the gesture on the offline queue and
        // try to flush; the row shows pending-sync until delivery lands.
        try {
          await queue.enqueue('habit_click', { habit_id: habit.id, direction });
          setQueuedIds((s) => toggled(s, habit.id, true));
          const res = await queue.flush();
          if (!res.failed) {
            setQueuedIds((s) => toggled(s, habit.id, false));
            invalidateAfterScore();
          }
        } catch {
          setActionError('Could not queue the click — it was not recorded.');
        }
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
