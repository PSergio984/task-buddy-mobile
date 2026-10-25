import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/api/auth';
import { tasksApi } from '@/api/client';
import type { Task, TaskPriority } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  HIGH: Colors.danger,
  MEDIUM: Colors.accent,
  LOW: Colors.textSecondary,
};

interface TaskRowProps {
  task: Task;
  onPress: (id: number) => void;
}

function TaskRow({ task, onPress }: TaskRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(task.id)}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, task.completed && styles.rowTitleDone]} numberOfLines={1}>
          {task.title}
        </Text>
        {task.due_date ? (
          <Text style={styles.rowMeta}>Due {new Date(task.due_date).toLocaleDateString()}</Text>
        ) : null}
      </View>
      <View style={[styles.badge, { borderColor: PRIORITY_COLORS[task.priority] }]}>
        <Text style={[styles.badgeText, { color: PRIORITY_COLORS[task.priority] }]}>
          {task.priority}
        </Text>
      </View>
    </Pressable>
  );
}

export default function TasksScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const { token } = useAuth();

  const { data: tasks, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
    enabled: !!token, // don't fire unauthenticated before the gate redirects
  });

  const createTask = useMutation({
    mutationFn: (title: string) => tasksApi.create({ title }),
    onSuccess: () => {
      setNewTitle('');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const openTask = useCallback((id: number) => router.push(`/task/${id}`), [router]);
  const renderTask = useCallback(
    ({ item }: { item: Task }) => <TaskRow task={item} onPress={openTask} />,
    [openTask],
  );

  const listHeader = (
    <View>
      <View style={styles.createRow}>
        <TextInput
          style={styles.createInput}
          placeholder="New task…"
          placeholderTextColor={Colors.textMuted}
          value={newTitle}
          onChangeText={setNewTitle}
          onSubmitEditing={() => {
            if (newTitle.trim() && !createTask.isPending) createTask.mutate(newTitle.trim());
          }}
          returnKeyType="done"
        />
        <Pressable
          style={[styles.addButton, (!newTitle.trim() || createTask.isPending) && styles.disabled]}
          disabled={!newTitle.trim() || createTask.isPending}
          onPress={() => createTask.mutate(newTitle.trim())}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      {createTask.error ? (
        <Text style={styles.createError}>{createTask.error.message}</Text>
      ) : null}
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={tasks ?? []}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderTask}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {error instanceof Error ? error.message : 'No tasks yet. Add one above.'}
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
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: Colors.background },
  listContent: { padding: Spacing.four, gap: Spacing.two, flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.five },
  emptyText: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center' },
  createError: { color: Colors.danger, fontSize: 13, marginBottom: Spacing.two },
  createRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  createInput: {
    flex: 1,
    backgroundColor: Colors.backgroundElement,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  addButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  addButtonText: { color: Colors.background, fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  rowPressed: { backgroundColor: Colors.backgroundSelected },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: Colors.text, fontSize: 16, fontWeight: '500' },
  rowTitleDone: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  rowMeta: { color: Colors.textSecondary, fontSize: 12 },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
