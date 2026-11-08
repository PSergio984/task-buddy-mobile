/**
 * Timeline screen — the merged UTC day view: session blocks (phases
 * inline), ledger point markers, and the day's diary entries.
 */
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/api/auth';
import { timelineApi } from '@/api/game';
import { addUtcDays, todayUtcDay, utcDayLabel, type UtcDay } from '@/components/activity/dates';
import { MarkerRow, SessionBlockCard } from '@/components/activity/timeline-blocks';
import { DiaryEntryCard } from '@/components/diary/entry-card';
import { Colors, Spacing } from '@/constants/colors';

function DayNavigator({ day, onChange }: { day: UtcDay; onChange: (day: UtcDay) => void }) {
  return (
    <View style={styles.nav}>
      <Pressable
        style={styles.navButton}
        onPress={() => onChange(addUtcDays(day, -1))}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
      >
        <Text style={styles.navButtonText}>‹</Text>
      </Pressable>
      <Text style={styles.navLabel}>{utcDayLabel(day)} · UTC</Text>
      <Pressable
        style={styles.navButton}
        onPress={() => onChange(addUtcDays(day, 1))}
        accessibilityRole="button"
        accessibilityLabel="Next day"
      >
        <Text style={styles.navButtonText}>›</Text>
      </Pressable>
      {day !== todayUtcDay() ? (
        <Pressable
          style={styles.todayButton}
          onPress={() => onChange(todayUtcDay())}
          accessibilityRole="button"
          accessibilityLabel="Jump to today"
        >
          <Text style={styles.todayText}>Today</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function TimelineScreen() {
  const { token } = useAuth();
  const [day, setDay] = useState<UtcDay>(todayUtcDay);
  const timeline = useQuery({
    queryKey: ['timeline', day],
    queryFn: () => timelineApi.day(day),
    enabled: !!token,
  });

  const data = timeline.data;
  const dayStartMs = Date.parse(`${day}T00:00:00Z`);
  const empty =
    data !== undefined &&
    data.sessions.length === 0 &&
    data.markers.length === 0 &&
    data.diary.length === 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Timeline' }} />
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <DayNavigator day={day} onChange={setDay} />

        {timeline.isPending ? (
          <ActivityIndicator color={Colors.accent} />
        ) : timeline.isError ? (
          <Text style={styles.error}>Couldn’t load this day’s timeline.</Text>
        ) : data !== undefined ? (
          <>
            {empty ? (
              <Text style={styles.empty}>
                Nothing scored this day — run a focus session or click a habit.
              </Text>
            ) : null}

            {data.sessions.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sessions</Text>
                {data.sessions.map((block) => (
                  <SessionBlockCard key={block.id} block={block} dayStartMs={dayStartMs} />
                ))}
              </View>
            ) : null}

            {data.markers.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Markers</Text>
                {data.markers.map((marker) => (
                  <MarkerRow key={marker.id} marker={marker} />
                ))}
              </View>
            ) : null}

            {data.diary.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Diary</Text>
                {data.diary.map((entry) => (
                  <DiaryEntryCard key={entry.id} entry={entry} />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four },
  nav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  navButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
  },
  navButtonText: { color: Colors.text, fontSize: 22, fontWeight: '700' },
  navLabel: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  todayButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  todayText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  error: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  empty: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  section: { gap: Spacing.two },
  sectionTitle: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
