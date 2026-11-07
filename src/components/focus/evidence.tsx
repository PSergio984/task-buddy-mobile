/**
 * Phone-down evidence rows — the tier chip plus the span/violation rows
 * shared by the end-of-session card and the history list.
 */
import { StyleSheet, Text, View } from 'react-native';

import type { PhoneDownEvidence, PhoneDownTier } from '@/api/types';
import type { PhoneDownViolation } from '@/game/phone-down';
import type { ResolvedSpan } from '@/game/phone-down-session';
import { Colors, Spacing } from '@/constants/colors';

const TIER_COLORS: Record<PhoneDownTier, string> = {
  verified: Colors.success,
  unverified: Colors.textSecondary,
  violated: Colors.danger,
};

const EVIDENCE_LABEL: Record<PhoneDownEvidence, string> = {
  live: 'live',
  retro: 'retro',
  none: 'unproven',
};

export function TierChip({ tier }: { tier: PhoneDownTier }) {
  return (
    <View style={[styles.chip, { borderColor: TIER_COLORS[tier] }]}>
      <Text style={[styles.chipText, { color: TIER_COLORS[tier] }]}>{tier}</Text>
    </View>
  );
}

const fmtTs = (epochMs: number) =>
  new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function SpanRow({ span }: { span: ResolvedSpan }) {
  return (
    <View style={styles.spanRow}>
      <Text style={styles.spanText}>
        {fmtTs(span.start_ts)} → {fmtTs(span.end_ts)} · {EVIDENCE_LABEL[span.evidence]}
      </Text>
      <TierChip tier={span.tier} />
    </View>
  );
}

export function ViolationRow({ violation }: { violation: PhoneDownViolation }) {
  return (
    <View style={styles.spanRow}>
      <Text style={[styles.spanText, { color: Colors.danger }]}>
        {fmtTs(violation.at_ts)} · {violation.kind.replaceAll('_', ' ')}
      </Text>
      <TierChip tier="violated" />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: 6,
  },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  spanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  spanText: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
});
