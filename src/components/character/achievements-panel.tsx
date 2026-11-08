/**
 * Achievements panel — badge list with earned/unearned styling.
 * Port of web character/achievements-panel.tsx; presentational — the
 * route owns the query.
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import type { Achievement } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

const EARNED_ICON: SymbolViewProps['name'] = {
  ios: 'trophy.fill',
  android: 'trophy',
  web: 'trophy',
};
const LOCKED_ICON: SymbolViewProps['name'] = { ios: 'lock.fill', android: 'lock', web: 'lock' };

function earnedLabel(earnedAt: string): string {
  const date = new Date(earnedAt);
  return Number.isNaN(date.getTime())
    ? 'Earned'
    : `Earned ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

interface AchievementsPanelProps {
  achievements: Achievement[];
}

export function AchievementsPanel({ achievements }: AchievementsPanelProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Achievements</Text>
      <View style={styles.list}>
        {achievements.map((a) => {
          const earnedAt = a.earned_at;
          const earned = earnedAt !== null;
          return (
            <View key={a.key} style={[styles.row, earned ? styles.rowEarned : styles.rowLocked]}>
              <View style={[styles.iconBadge, earned && styles.iconBadgeEarned]}>
                <SymbolView
                  name={earned ? EARNED_ICON : LOCKED_ICON}
                  tintColor={earned ? '#FBBF24' : Colors.textMuted}
                  size={18}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {a.name}
                </Text>
                {a.description !== null ? (
                  <Text style={styles.description} numberOfLines={1}>
                    {a.description}
                  </Text>
                ) : null}
              </View>
              <View style={styles.reward}>
                <Text style={styles.gold}>+{a.gold_reward}g</Text>
                <Text style={styles.earnedAt}>{earned ? earnedLabel(earnedAt) : 'Locked'}</Text>
              </View>
            </View>
          );
        })}
        {achievements.length === 0 ? (
          <Text style={styles.empty}>No achievements registered yet.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  cardTitle: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  list: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 10,
    borderWidth: 1,
    padding: Spacing.three,
  },
  rowEarned: { borderColor: 'rgba(251,191,36,0.2)', backgroundColor: 'rgba(251,191,36,0.05)' },
  rowLocked: { borderColor: Colors.border, backgroundColor: Colors.background, opacity: 0.6 },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadgeEarned: { borderColor: 'rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.1)' },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  name: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  description: { color: Colors.textSecondary, fontSize: 12 },
  reward: { alignItems: 'flex-end', gap: 2 },
  gold: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  earnedAt: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  empty: { color: Colors.textSecondary, fontSize: 14 },
});
