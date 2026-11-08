/**
 * GitHub-style contribution grid — one column per week (Monday start),
 * seven weekday rows. Cell intensity comes from the server-computed
 * `day.tier` bucket; tapping a cell opens that day's detail underneath.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ActivityDay, ActivityGrid } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

import { utcDayLabel } from './dates';

/** Intensity ramp indexed by tier (tier beyond the ramp clamps to the top). */
const TIER_COLORS = [
  Colors.backgroundSelected,
  '#3F414A',
  '#68605E',
  '#917E71',
  Colors.accent,
] as const;

function tierColor(tier: number): string {
  return TIER_COLORS[Math.min(Math.max(tier, 0), TIER_COLORS.length - 1)];
}

/** Mon=0..Sun=6 — the same weekday convention the web grid uses. */
function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Contribution-grid columns: one column per week, seven slots each. The
 * server emits every day in the window, so only the first column can lead
 * with blanks and the last can trail them.
 */
export function buildWeeks(days: ActivityDay[]): (ActivityDay | null)[][] {
  const weeks: (ActivityDay | null)[][] = [];
  for (const day of days) {
    const wd = weekdayIndex(day.date);
    if (weeks.length === 0 || wd === 0) weeks.push(new Array<ActivityDay | null>(7).fill(null));
    weeks[weeks.length - 1][wd] = day;
  }
  return weeks;
}

function DayDetail({ day }: { day: ActivityDay }) {
  const events = Object.entries(day.events);
  return (
    <View style={styles.detail} testID="activity-day-detail">
      <Text style={styles.detailTitle}>
        {utcDayLabel(day.date)} — {Math.round(day.score)} pts
      </Text>
      <Text style={styles.detailLine}>{Math.round(day.focus_minutes)}m focus</Text>
      {events.length === 0 ? (
        <Text style={styles.detailLine}>No scored events</Text>
      ) : (
        events.map(([type, count]) => (
          <Text key={type} style={styles.detailLine}>
            {type.replace(/_/g, ' ')} ×{count}
          </Text>
        ))
      )}
    </View>
  );
}

export function ContributionGrid({ grid }: { grid: ActivityGrid }) {
  const weeks = buildWeeks(grid.days);
  const [selected, setSelected] = useState<ActivityDay | null>(null);

  return (
    <View>
      <Text style={styles.range}>
        {utcDayLabel(grid.start)} – {utcDayLabel(grid.end)} · UTC
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.weeks}>
          {weeks.map((week, wi) => (
            <View key={wi} style={styles.week}>
              {week.map((day, di) =>
                day === null ? (
                  <View key={`blank-${wi}-${di}`} style={styles.cell} />
                ) : (
                  <Pressable
                    key={day.date}
                    style={[
                      styles.cell,
                      { backgroundColor: tierColor(day.tier) },
                      selected?.date === day.date && styles.cellSelected,
                    ]}
                    // Small cells stay grid-shaped; the slop keeps each one
                    // a ~44px touch target.
                    hitSlop={15}
                    accessibilityRole="button"
                    accessibilityLabel={`${utcDayLabel(day.date)}: ${Math.round(
                      day.score,
                    )} pts, ${Math.round(day.focus_minutes)}m focus`}
                    onPress={() => setSelected(day)}
                  />
                ),
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.legend}>
        <Text style={styles.legendText}>Less</Text>
        {TIER_COLORS.map((c) => (
          <View key={c} style={[styles.legendSwatch, { backgroundColor: c }]} />
        ))}
        <Text style={styles.legendText}>More</Text>
      </View>
      {selected !== null ? <DayDetail day={selected} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  range: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.three,
  },
  weeks: { flexDirection: 'row', gap: 3 },
  week: { gap: 3 },
  cell: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cellSelected: { borderColor: Colors.text, borderWidth: 2 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: Spacing.three,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  legendText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  detail: {
    marginTop: Spacing.three,
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.three,
    gap: 2,
  },
  detailTitle: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  detailLine: { color: Colors.textSecondary, fontSize: 12 },
});
