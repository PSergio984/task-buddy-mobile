import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/api/auth';
import { tasksApi } from '@/api/client';
import { Colors, Spacing } from '@/constants/colors';

function formatDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString() : null;
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const taskId = Number(id);
  const { token } = useAuth();

  const {
    data: task,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['tasks', taskId],
    queryFn: () => tasksApi.get(taskId),
    enabled: Number.isFinite(taskId) && !!token,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {error instanceof Error ? error.message : 'Task not found.'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={[styles.title, task.completed && styles.titleDone]}>{task.title}</Text>

      <View style={styles.badgeRow}>
        <Text style={styles.badge}>{task.priority}</Text>
        <Text style={[styles.badge, task.completed ? styles.badgeDone : styles.badgeOpen]}>
          {task.completed ? 'Done' : 'Open'}
        </Text>
        {task.deadline_type ? <Text style={styles.badge}>{task.deadline_type}</Text> : null}
      </View>

      {task.description ? <Text style={styles.description}>{task.description}</Text> : null}

      <View style={styles.card}>
        <MetaRow label="Due" value={formatDate(task.due_date)} />
        <MetaRow label="Proposed deadline" value={formatDate(task.proposed_deadline)} />
        <MetaRow label="Created" value={formatDate(task.created_at)} />
        <MetaRow label="Updated" value={formatDate(task.updated_at)} />
      </View>

      {task.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {task.tags.map((tag) => (
            <Text key={tag.id} style={styles.tag}>
              {tag.name}
            </Text>
          ))}
        </View>
      ) : null}

      {task.subtasks.length > 0 ? (
        <View style={styles.subtasks}>
          <Text style={styles.sectionTitle}>Subtasks</Text>
          {task.subtasks.map((sub) => (
            <View key={sub.id} style={styles.subtaskRow}>
              <Text style={[styles.subtaskTitle, sub.completed && styles.titleDone]}>
                {sub.title}
              </Text>
              <Text style={styles.subtaskState}>{sub.completed ? 'Done' : ''}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four },
  center: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.five,
  },
  errorText: { color: Colors.danger, fontSize: 15, textAlign: 'center' },
  title: { color: Colors.text, fontSize: 24, fontWeight: '700' },
  titleDone: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  badgeRow: { flexDirection: 'row', gap: Spacing.two },
  badge: {
    color: Colors.accent,
    borderColor: Colors.accent,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  badgeOpen: { color: Colors.accent, borderColor: Colors.accent },
  badgeDone: { color: Colors.success, borderColor: Colors.success },
  description: { color: Colors.textSecondary, fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 12,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.four },
  metaLabel: { color: Colors.textSecondary, fontSize: 14 },
  metaValue: { color: Colors.text, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tag: {
    color: Colors.text,
    backgroundColor: Colors.backgroundSelected,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 12,
    overflow: 'hidden',
  },
  subtasks: { gap: Spacing.two },
  sectionTitle: { color: Colors.accent, fontSize: 18, fontWeight: '700' },
  subtaskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.four,
  },
  subtaskTitle: { color: Colors.text, fontSize: 15, flex: 1 },
  subtaskState: { color: Colors.success, fontSize: 12 },
});
