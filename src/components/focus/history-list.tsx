/**
 * "Recent phone-down sessions" — the ledger feed grouped per session, plus
 * the dead-letter notice so dropped evidence is never silent.
 */
import { StyleSheet, Text, View } from 'react-native';

import type { PhoneDownTier } from '@/api/types';
import { TierChip } from './evidence';
import { Colors, Spacing } from '@/constants/colors';

export interface PhoneDownHistoryRow {
  sessionId: number;
  worst: PhoneDownTier;
  spans: number;
  violations: number;
  /** Verified streak + XP multiplier adjudicated at score time (#70). */
  streakCount?: number;
  xpMultiplier?: number;
}

interface PhoneDownHistoryListProps {
  rows: PhoneDownHistoryRow[];
  /** Evidence events dead-lettered after repeated deterministic rejects. */
  deadLetters: number;
}

export function PhoneDownHistoryList({ rows, deadLetters }: PhoneDownHistoryListProps) {
  if (rows.length === 0 && deadLetters === 0) return null;
  return (
    <View style={styles.history}>
      <Text style={styles.sectionTitle}>Recent phone-down sessions</Text>
      {deadLetters > 0 ? (
        <Text style={styles.deadLetter}>
          {deadLetters} evidence event{deadLetters === 1 ? '' : 's'} rejected by the server and
          dropped — the affected sessions may be under-reported.
        </Text>
      ) : null}
      {rows.map((h) => (
        <View key={h.sessionId} style={styles.historyRow}>
          <Text style={styles.historyText}>
            Session {h.sessionId} · {h.spans} span{h.spans === 1 ? '' : 's'}
            {h.violations > 0 ? ` · ${h.violations} violation(s)` : ''}
            {h.streakCount !== undefined
              ? ` · streak ${h.streakCount} · XP ×${(h.xpMultiplier ?? 1).toFixed(2)}`
              : ''}
          </Text>
          <TierChip tier={h.worst} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  history: { gap: Spacing.two },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  deadLetter: { color: Colors.danger, fontSize: 12 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  historyText: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
});
