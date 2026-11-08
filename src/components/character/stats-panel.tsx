/**
 * Stats panel — attributes (allocate + auto-assign) and the class card.
 * Port of web character/stats-panel.tsx; presentational — the route owns
 * the mutations. Respec confirmation lives in the route (Alert).
 */
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { GameClass, GameProfile, StatKey } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

import {
  allocatedPoints,
  CLASS_MIN_LEVEL,
  classChoiceOpen,
  GAME_CLASSES,
  RESPEC_GOLD_COST,
  STAT_COLUMN,
  STAT_META,
  STAT_POINT_CAP,
} from './character-utils';

interface StatsPanelProps {
  profile: GameProfile;
  /** Any character write in flight — buttons stay disabled meanwhile. */
  busy: boolean;
  onAllocate: (stat: StatKey) => void;
  onAutoAllocateChange: (enabled: boolean) => void;
  onSelectClass: (gameClass: GameClass) => void;
  onRespec: () => void;
}

export function StatsPanel({
  profile,
  busy,
  onAllocate,
  onAutoAllocateChange,
  onSelectClass,
  onRespec,
}: StatsPanelProps) {
  const unspent = profile.unspent_stat_points;
  const respecBlocked = profile.gold < RESPEC_GOLD_COST;
  // allocate_points rejects once the allocated pool hits the cap.
  const capReached = allocatedPoints(profile) >= STAT_POINT_CAP;
  const allocateDisabled = busy || unspent <= 0 || capReached;

  return (
    <View style={styles.panels}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Attributes</Text>
          <Text style={[styles.unspent, unspent > 0 && styles.unspentActive]}>
            {unspent} point{unspent === 1 ? '' : 's'} unspent
          </Text>
        </View>

        <View style={styles.statList}>
          {STAT_META.map(({ key, label }) => (
            <View key={key} style={styles.statRow}>
              <View style={styles.statText}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statKey}>{key}</Text>
              </View>
              <Text style={styles.statValue}>{profile[STAT_COLUMN[key]]}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${label} point`}
                accessibilityState={{ disabled: allocateDisabled }}
                style={[styles.addButton, allocateDisabled && styles.disabled]}
                disabled={allocateDisabled}
                onPress={() => onAllocate(key)}
              >
                <Text style={styles.addButtonText}>+</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={styles.autoRow}>
          <Text style={styles.autoLabel}>Auto-assign level-up points</Text>
          <Switch
            accessibilityLabel="Auto-assign level-up points"
            value={profile.auto_allocate}
            disabled={busy}
            onValueChange={onAutoAllocateChange}
            trackColor={{ true: Colors.accent, false: Colors.backgroundSelected }}
            thumbColor={Colors.text}
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Class</Text>
          {profile.game_class !== null ? (
            <Text style={styles.levelTag}>Lv {profile.level}</Text>
          ) : null}
        </View>

        {profile.game_class !== null ? (
          <View style={styles.classBody}>
            <View style={styles.classCurrent}>
              <Text style={styles.className}>{profile.game_class}</Text>
              <Text style={styles.classSub}>Current class</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Respec for ${RESPEC_GOLD_COST} gold`}
              accessibilityHint={respecBlocked ? 'Not enough gold' : 'Refunds allocated points'}
              accessibilityState={{ disabled: busy || respecBlocked }}
              style={[styles.outlineButton, (busy || respecBlocked) && styles.disabled]}
              disabled={busy || respecBlocked}
              onPress={onRespec}
            >
              <Text style={styles.outlineButtonText}>Respec · {RESPEC_GOLD_COST}g</Text>
            </Pressable>
          </View>
        ) : classChoiceOpen(profile) ? (
          <View style={styles.classBody}>
            <Text style={styles.classHint}>
              Pick a class to unlock its gear ladders and affinity stats.
            </Text>
            <View style={styles.classGrid}>
              {GAME_CLASSES.map((c) => (
                <Pressable
                  key={c.value}
                  accessibilityRole="button"
                  accessibilityLabel={`Pick ${c.label} class`}
                  accessibilityState={{ disabled: busy }}
                  style={[styles.classCard, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => onSelectClass(c.value)}
                >
                  <Text style={styles.classCardName}>{c.label}</Text>
                  <Text style={styles.classCardAffinity}>{c.affinity}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <Text
            style={styles.classHint}
          >{`Classes unlock at level ${CLASS_MIN_LEVEL} — you're level ${profile.level}.`}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panels: { gap: Spacing.four },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  unspent: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  unspentActive: { color: '#FBBF24' },
  statList: { gap: Spacing.two },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: Spacing.three,
  },
  statText: { flex: 1, gap: 2 },
  statLabel: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  statKey: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900',
    minWidth: 32,
    textAlign: 'right',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
    backgroundColor: 'rgba(74,222,128,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: Colors.success, fontSize: 20, fontWeight: '700' },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  autoLabel: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  levelTag: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  classBody: { gap: Spacing.three },
  classCurrent: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(194,163,136,0.3)',
    backgroundColor: 'rgba(194,163,136,0.08)',
    padding: Spacing.four,
    gap: 2,
  },
  className: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  classSub: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  classHint: { color: Colors.textSecondary, fontSize: 13 },
  classGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  classCard: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    padding: Spacing.four,
    minHeight: 44,
    gap: 2,
  },
  classCardName: { color: Colors.text, fontSize: 14, fontWeight: '900' },
  classCardAffinity: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  outlineButton: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
    justifyContent: 'center',
  },
  outlineButtonText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
});
