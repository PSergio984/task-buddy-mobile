import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/api/auth';
import { ApiError, planApi, tasksApi } from '@/api/client';
import type { PlanPeriod } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

const PERIOD_LABELS: Record<PlanPeriod, string> = {
  tonight: 'Tonight',
  tomorrow: 'Tomorrow',
  later: 'Later',
};

export default function PlanScreen() {
  const router = useRouter();
  const [minutesInput, setMinutesInput] = useState('');

  // Tasks are cached by the Tasks tab — used only to resolve task_id → title.
  const { token } = useAuth();
  const { data: tasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
    enabled: !!token,
  });
  const titles = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t.title])), [tasks]);

  const plan = useMutation({
    mutationFn: (availableMinutes?: number) =>
      planApi.generate(
        availableMinutes === undefined ? {} : { available_minutes: availableMinutes },
      ),
  });

  function onPlan() {
    const minutes = parseInt(minutesInput, 10);
    plan.mutate(Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 1440) : undefined); // backend caps available_minutes at 1440 (le=1440)
  }

  const result = plan.data;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.formRow}>
        <TextInput
          style={styles.input}
          placeholder="Available minutes (optional)"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          value={minutesInput}
          onChangeText={setMinutesInput}
        />
        <Pressable
          style={[styles.planButton, plan.isPending && styles.disabled]}
          disabled={plan.isPending}
          onPress={onPlan}
        >
          {plan.isPending ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.planButtonText}>Plan</Text>
          )}
        </Pressable>
      </View>

      {plan.error ? (
        <Text style={styles.error}>
          {plan.error instanceof ApiError ? plan.error.message : 'Could not build a plan.'}
        </Text>
      ) : null}

      {result ? (
        <View style={styles.results}>
          {result.reason ? <Text style={styles.reason}>{result.reason}</Text> : null}
          {result.buckets.map((bucket) => (
            <View key={bucket.period} style={styles.bucket}>
              <Text style={styles.bucketTitle}>{PERIOD_LABELS[bucket.period]}</Text>
              {bucket.tasks.length === 0 ? (
                <Text style={styles.emptyBucket}>Nothing scheduled.</Text>
              ) : (
                bucket.tasks.map((row) => (
                  <Pressable
                    key={row.task_id}
                    style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}
                    onPress={() => router.push(`/task/${row.task_id}`)}
                  >
                    <View style={styles.taskText}>
                      <Text style={styles.taskTitle}>
                        {titles.get(row.task_id) ?? `Task #${row.task_id}`}
                      </Text>
                      <Text style={styles.taskReason}>{row.reason}</Text>
                    </View>
                    {row.effort_minutes != null ? (
                      <Text style={styles.effort}>{row.effort_minutes}m</Text>
                    ) : null}
                  </Pressable>
                ))
              )}
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
  formRow: { flexDirection: 'row', gap: Spacing.two },
  input: {
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
  planButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
    minWidth: 80,
  },
  planButtonText: { color: Colors.background, fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  error: { color: Colors.danger, fontSize: 14 },
  results: { gap: Spacing.four },
  reason: { color: Colors.textSecondary, fontSize: 14, fontStyle: 'italic' },
  bucket: { gap: Spacing.two },
  bucketTitle: { color: Colors.accent, fontSize: 18, fontWeight: '700' },
  emptyBucket: { color: Colors.textMuted, fontSize: 14 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  taskRowPressed: { backgroundColor: Colors.backgroundSelected },
  taskText: { flex: 1, gap: 2 },
  taskTitle: { color: Colors.text, fontSize: 16, fontWeight: '500' },
  taskReason: { color: Colors.textSecondary, fontSize: 13 },
  effort: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
});
