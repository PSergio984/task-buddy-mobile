/**
 * One diary entry row — kind badge, UTC day + creation time, stand-up
 * fields or freeform text. Optional edit/delete actions; delete is a
 * two-step inline confirm so a fat-finger can't drop a row.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DiaryEntry } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

import { utcDayLabel, utcTimeLabel } from '@/components/activity/dates';

const STANDUP_FIELDS: readonly { key: 'good' | 'bad' | 'next'; label: string }[] = [
  { key: 'good', label: 'Went well' },
  { key: 'bad', label: "Didn't go well" },
  { key: 'next', label: 'Up next' },
];

interface DiaryEntryCardProps {
  entry: DiaryEntry;
  /** Absent → read-only (the merged timeline day view). */
  onEdit?: () => void;
  onDelete?: () => void;
}

export function DiaryEntryCard({ entry, onEdit, onDelete }: DiaryEntryCardProps) {
  const [confirming, setConfirming] = useState(false);
  const showActions = onEdit !== undefined || onDelete !== undefined;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.badge, entry.kind === 'standup' && styles.badgeStandup]}>
          <Text style={[styles.badgeText, entry.kind === 'standup' && styles.badgeStandupText]}>
            {entry.kind === 'standup' ? 'Stand-up' : 'Entry'}
          </Text>
        </View>
        <Text style={styles.date}>
          {utcDayLabel(entry.entry_date)} · {utcTimeLabel(entry.created_at)} UTC
        </Text>
      </View>

      {entry.kind === 'standup' ? (
        <View style={styles.standup}>
          {STANDUP_FIELDS.map(({ key, label }) => (
            <View key={key} style={styles.standupField}>
              <Text style={styles.fieldLabel}>{label}</Text>
              <Text style={styles.fieldText}>{entry[key] ?? '—'}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.body}>{entry.freeform}</Text>
      )}

      {showActions ? (
        confirming ? (
          <View style={styles.actions}>
            <Text style={styles.confirmText}>Delete this entry?</Text>
            <Pressable
              style={styles.deleteButton}
              onPress={() => {
                setConfirming(false);
                onDelete?.();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Confirm delete ${entry.kind} entry`}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
            <Pressable
              style={styles.actionButton}
              onPress={() => setConfirming(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel delete"
            >
              <Text style={styles.actionText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.actions}>
            {onEdit !== undefined ? (
              <Pressable
                style={styles.actionButton}
                onPress={onEdit}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${entry.kind} entry`}
              >
                <Text style={styles.actionText}>Edit</Text>
              </Pressable>
            ) : null}
            {onDelete !== undefined ? (
              <Pressable
                style={styles.actionButton}
                onPress={() => setConfirming(true)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${entry.kind} entry`}
              >
                <Text style={styles.deleteActionText}>Delete</Text>
              </Pressable>
            ) : null}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeStandup: { borderColor: Colors.accent },
  badgeText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  badgeStandupText: { color: Colors.accent },
  date: { color: Colors.textMuted, fontSize: 11 },
  standup: { gap: Spacing.two },
  standupField: { gap: 2 },
  fieldLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  fieldText: { color: Colors.text, fontSize: 14 },
  body: { color: Colors.text, fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actionButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  actionText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  deleteActionText: { color: Colors.danger, fontSize: 13, fontWeight: '700' },
  confirmText: { flex: 1, color: Colors.danger, fontSize: 13 },
  deleteButton: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: Colors.danger,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
  },
  deleteText: { color: Colors.background, fontSize: 13, fontWeight: '700' },
});
