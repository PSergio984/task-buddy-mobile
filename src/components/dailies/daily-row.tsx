/**
 * Daily list row — whole-daily checkbox, title/notes, streak, reminders,
 * checklist progress, recurrence label and per-item checkboxes. Mirrors
 * the web dailies-column row semantics (paused dailies and already-done
 * days gate which boxes stay live).
 */
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Daily, DailyCheckInput, Recurrence } from '@/api/types';
import { reminderLabel, WEEKDAY_SHORT } from '@/components/game-utils';
import { Colors, Spacing } from '@/constants/colors';

/** One-line summary of a stored recurrence blob; unknown shapes → 'Custom'. */
export function recurrenceLabel(recurrence: Recurrence | undefined): string {
  switch (recurrence?.kind) {
    case 'daily':
      return 'Every day';
    case 'weekdays': {
      const days = recurrence.days;
      if (days.length === 0) return 'Custom';
      if (days.length >= 7) return 'Every day';
      return days.map((d) => WEEKDAY_SHORT[d] ?? '?').join(' · ');
    }
    case 'every_n_days':
      return recurrence.interval <= 1 ? 'Every day' : `Every ${recurrence.interval} days`;
    case 'times_per_week':
      return `${recurrence.count}× per week`;
    default:
      return 'Custom';
  }
}

interface CheckBoxProps {
  checked: boolean;
  disabled: boolean;
  label: string;
  size?: number;
  onToggle: (next: boolean) => void;
}

/** Pressable checkbox — the visual box sits inside a ≥44px touch target. */
function CheckBox({ checked, disabled, label, size = 22, onToggle }: CheckBoxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onToggle(!checked)}
      style={styles.checkTarget}
    >
      <View
        style={[
          styles.checkBox,
          { width: size, height: size, borderRadius: size * 0.28 },
          checked && styles.checkBoxChecked,
          disabled && styles.disabled,
        ]}
      >
        {checked ? (
          <SymbolView
            name={{ ios: 'checkmark', android: 'check', web: 'check' }}
            size={size - 9}
            tintColor={Colors.background}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

interface DailyRowProps {
  daily: Daily;
  /** Check in flight — the boxes stay disabled so a double-tap can't
   *  double-score. */
  checking: boolean;
  /** A check is parked in the offline queue awaiting sync. */
  queued: boolean;
  onCheck: (input: DailyCheckInput) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function DailyRow({ daily, checking, queued, onCheck, onEdit, onDelete }: DailyRowProps) {
  const done = daily.items.filter((i) => i.done_today).length;
  const checkDisabled = !daily.active || checking;
  return (
    <View style={[styles.card, !daily.active && styles.cardPaused]}>
      <View style={styles.mainRow}>
        <CheckBox
          checked={daily.completed_today}
          disabled={checkDisabled}
          label={`Check ${daily.title}`}
          onToggle={(next) => onCheck({ done: next })}
        />
        <View style={styles.textBlock}>
          <Text style={[styles.title, daily.completed_today && styles.titleDone]} numberOfLines={1}>
            {daily.title}
          </Text>
          {daily.notes !== null ? (
            <Text style={styles.notes} numberOfLines={1}>
              {daily.notes}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.metaRow}>
        {!daily.active ? (
          <View style={styles.badge}>
            <Text style={styles.badgeTextMuted}>Paused</Text>
          </View>
        ) : null}
        {daily.streak > 0 ? (
          <View style={styles.iconBadge}>
            <SymbolView
              name={{
                ios: 'flame',
                android: 'local_fire_department',
                web: 'local_fire_department',
              }}
              size={12}
              tintColor={Colors.accent}
            />
            <Text style={[styles.badgeText, { color: Colors.accent }]}>{daily.streak}</Text>
          </View>
        ) : null}
        {daily.reminder_times.length > 0 ? (
          <View style={styles.iconBadge}>
            <SymbolView
              name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
              size={11}
              tintColor={Colors.textSecondary}
            />
            <Text style={styles.badgeTextMuted}>{reminderLabel(daily.reminder_times)}</Text>
          </View>
        ) : null}
        {daily.items.length > 0 ? (
          <Text style={styles.badgeTextMuted}>
            {done}/{daily.items.length} done
          </Text>
        ) : null}
        <Text style={styles.badgeTextMuted}>{recurrenceLabel(daily.recurrence)}</Text>
        {queued ? <Text style={styles.queuedText}>queued — syncs online</Text> : null}
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${daily.title}`}
          onPress={onEdit}
          style={styles.iconButton}
        >
          <SymbolView
            name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
            size={15}
            tintColor={Colors.textSecondary}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${daily.title}`}
          onPress={onDelete}
          style={styles.iconButton}
        >
          <SymbolView
            name={{ ios: 'trash', android: 'delete', web: 'delete' }}
            size={15}
            tintColor={Colors.textSecondary}
          />
        </Pressable>
      </View>

      {daily.items.length > 0 ? (
        <View style={styles.items}>
          {daily.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <CheckBox
                checked={item.done_today}
                // Once the day is complete a still-open item can't check
                // (server: already_checked) — only un-checking stays live.
                disabled={checkDisabled || (daily.completed_today && !item.done_today)}
                label={`Check ${item.title}`}
                size={18}
                onToggle={(next) => onCheck({ daily_item_id: item.id, done: next })}
              />
              <Text
                style={[styles.itemTitle, item.done_today && styles.itemTitleDone]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
            </View>
          ))}
        </View>
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
  cardPaused: { opacity: 0.6 },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  checkTarget: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  checkBox: {
    borderWidth: 1.5,
    borderColor: Colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  checkBoxChecked: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  disabled: { opacity: 0.4 },
  textBlock: { flex: 1, gap: 2 },
  title: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  titleDone: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  notes: { color: Colors.textSecondary, fontSize: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  badgeTextMuted: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  iconBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  queuedText: { color: Colors.accent, fontSize: 11, fontStyle: 'italic' },
  spacer: { flex: 1 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  items: { gap: 2, marginLeft: Spacing.five },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  itemTitle: { color: Colors.text, fontSize: 13, flex: 1 },
  itemTitleDone: { color: Colors.textMuted, textDecorationLine: 'line-through' },
});
