/**
 * Activity screen — contribution grid + rollup stats
 * (game_tracking endpoints, UTC-day buckets).
 */
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';

import { useAuth } from '@/api/auth';
import { activityApi } from '@/api/game';
import { ContributionGrid } from '@/components/activity/contribution-grid';
import { ActivityStatsPanel } from '@/components/activity/stats-cards';
import { Colors, Spacing } from '@/constants/colors';

export default function ActivityScreen() {
  const { token } = useAuth();
  const grid = useQuery({
    queryKey: ['activity-grid'],
    queryFn: () => activityApi.grid(),
    enabled: !!token,
  });
  const stats = useQuery({
    queryKey: ['activity-stats'],
    queryFn: () => activityApi.stats(),
    enabled: !!token,
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Activity' }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        {stats.data !== undefined ? (
          <ActivityStatsPanel stats={stats.data} />
        ) : stats.isError ? (
          <Text style={styles.error}>Couldn’t load your activity stats.</Text>
        ) : (
          <ActivityIndicator color={Colors.accent} />
        )}

        {grid.data !== undefined ? (
          <ContributionGrid grid={grid.data} />
        ) : grid.isError ? (
          <Text style={styles.error}>Couldn’t load the activity grid.</Text>
        ) : (
          <ActivityIndicator color={Colors.accent} />
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four },
  error: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
});
