/**
 * Activity rollup stats — streaks, hours and best-day chips plus the
 * per-activity-label speedrun personal bests (#69).
 */
import { StyleSheet, Text, View } from 'react-native';

import type { ActivityStats, SpeedrunPB } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';
import { formatClock } from '@/game/session-view';

import { utcDayLabel } from './dates';

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipValue}>{value}</Text>
    </View>
  );
}

function SpeedrunRow({ pb }: { pb: SpeedrunPB }) {
  const last = (pb.recent_attempts ?? [])[0];
  return (
    <View style={styles.pbRow}>
      <View style={styles.pbText}>
        <Text style={styles.pbLabel} numberOfLines={1}>
          {pb.activity_label}
        </Text>
        <Text style={styles.pbMeta}>
          {pb.attempts} {pb.attempts === 1 ? 'attempt' : 'attempts'} · set{' '}
          {utcDayLabel(pb.set_at.slice(0, 10))}
          {last !== undefined ? ` · last ${formatClock(last.seconds)}` : ''}
        </Text>
      </View>
      <Text style={styles.pbTime}>{formatClock(pb.best_seconds)}</Text>
    </View>
  );
}

export function ActivityStatsPanel({ stats }: { stats: ActivityStats }) {
  // `?? []` tolerates a pre-#69 backend still answering speedrun_pbs: null.
  const pbs = stats.speedrun_pbs ?? [];
  return (
    <View style={styles.root}>
      <View style={styles.chips}>
        <StatChip label="Avg / day" value={`${stats.avg_hours_per_day.toFixed(1)}h`} />
        <StatChip label="Total focus" value={`${stats.total_hours.toFixed(1)}h`} />
        <StatChip label="Streak" value={`${stats.current_streak}d`} />
        <StatChip label="Longest" value={`${stats.longest_streak}d`} />
        <StatChip
          label="Best day"
          value={
            stats.best_day !== null
              ? `${utcDayLabel(stats.best_day.date)} · ${Math.round(stats.best_day.score)}`
              : '—'
          }
        />
        <StatChip label="This week" value={`${Math.round(stats.weekly_total)} pts`} />
      </View>
      {pbs.length > 0 ? (
        <View style={styles.pbSection}>
          <Text style={styles.pbHeading}>Personal bests</Text>
          {pbs.map((pb) => (
            <SpeedrunRow key={pb.activity_label} pb={pb} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.four },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexGrow: 1,
    minWidth: '30%',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  chipLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chipValue: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  pbSection: { gap: Spacing.two },
  pbHeading: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  pbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pbText: { flex: 1, gap: 2 },
  pbLabel: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  pbMeta: { color: Colors.textSecondary, fontSize: 11 },
  pbTime: { color: Colors.accent, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
