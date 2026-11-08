/**
 * Habit list row — ± click buttons (gated by habit.direction), title/notes,
 * drift badge, bind_focus + reminder markers and the signed counter.
 * Mirrors the web habits-column row semantics on a mobile layout.
 */
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Habit, HabitClickDirection } from '@/api/types';
import { reminderLabel } from '@/components/game-utils';
import { Colors, Spacing } from '@/constants/colors';

type HabitDrift = 'fresh' | 'steady' | 'farmed';

/** Drift thresholds mirror the backend's drift math: value > 0 already pays
 *  below neutral (farmed), value < 0 pays above (fresh). */
function habitDrift(value: number): HabitDrift {
  if (value >= 1) return 'farmed';
  if (value <= -1) return 'fresh';
  return 'steady';
}

const DRIFT_COLORS: Record<HabitDrift, string> = {
  fresh: Colors.success,
  steady: Colors.textSecondary,
  farmed: Colors.accent,
};

/** Signed net-counter text: +12 / 0 / −3. */
function counterLabel(counter: number): string {
  if (counter > 0) return `+${counter}`;
  if (counter < 0) return `−${Math.abs(counter)}`;
  return '0';
}

function directionAllows(habit: Habit, direction: HabitClickDirection): boolean {
  return habit.direction === 'both' || habit.direction === direction;
}

interface ClickButtonProps {
  habit: Habit;
  direction: HabitClickDirection;
  disabled: boolean;
  onPress: () => void;
}

function ClickButton({ habit, direction, disabled, onPress }: ClickButtonProps) {
  const positive = direction === 'positive';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${positive ? '+' : '−'}click ${habit.title}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.clickButton,
        positive ? styles.clickButtonPos : styles.clickButtonNeg,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.clickSign, positive ? styles.clickPos : styles.clickNeg]}>
        {positive ? '+' : '−'}
      </Text>
    </Pressable>
  );
}

interface HabitRowProps {
  habit: Habit;
  /** Click in flight — the ± buttons stay disabled so a double-tap can't
   *  double-score (each tap mints its own client_event_id server-side). */
  clicking: boolean;
  /** A click is parked in the offline queue awaiting sync. */
  queued: boolean;
  onClick: (direction: HabitClickDirection) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function HabitRow({ habit, clicking, queued, onClick, onEdit, onDelete }: HabitRowProps) {
  const drift = habitDrift(habit.value);
  return (
    <View style={styles.card}>
      <View style={styles.mainRow}>
        <View style={styles.clickGroup}>
          {directionAllows(habit, 'positive') ? (
            <ClickButton
              habit={habit}
              direction="positive"
              disabled={clicking}
              onPress={() => onClick('positive')}
            />
          ) : null}
          {directionAllows(habit, 'negative') ? (
            <ClickButton
              habit={habit}
              direction="negative"
              disabled={clicking}
              onPress={() => onClick('negative')}
            />
          ) : null}
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {habit.title}
          </Text>
          {habit.notes !== null ? (
            <Text style={styles.notes} numberOfLines={1}>
              {habit.notes}
            </Text>
          ) : null}
        </View>
        <Text
          style={[
            styles.counter,
            habit.counter > 0
              ? styles.counterPos
              : habit.counter < 0
                ? styles.counterNeg
                : styles.counterZero,
          ]}
        >
          {counterLabel(habit.counter)}
        </Text>
      </View>

      <View style={styles.metaRow}>
        <View style={[styles.badge, { borderColor: DRIFT_COLORS[drift] }]}>
          <Text style={[styles.badgeText, { color: DRIFT_COLORS[drift] }]}>{drift}</Text>
        </View>
        {habit.bind_focus && habit.direction !== 'negative' ? (
          <View style={styles.iconBadge}>
            <SymbolView
              name={{ ios: 'timer', android: 'timer', web: 'timer' }}
              size={11}
              tintColor={Colors.accent}
            />
            <Text style={[styles.badgeText, { color: Colors.accent }]}>auto</Text>
          </View>
        ) : null}
        {habit.reminder_times.length > 0 ? (
          <View style={styles.iconBadge}>
            <SymbolView
              name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
              size={11}
              tintColor={Colors.textSecondary}
            />
            <Text style={styles.badgeTextMuted}>{reminderLabel(habit.reminder_times)}</Text>
          </View>
        ) : null}
        {queued ? <Text style={styles.queuedText}>queued — syncs online</Text> : null}
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${habit.title}`}
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
          accessibilityLabel={`Delete ${habit.title}`}
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
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  clickGroup: { flexDirection: 'row', gap: Spacing.two },
  clickButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clickButtonPos: { borderColor: Colors.success, backgroundColor: Colors.background },
  clickButtonNeg: { borderColor: Colors.danger, backgroundColor: Colors.background },
  clickSign: { fontSize: 20, fontWeight: '700', marginTop: -2 },
  clickPos: { color: Colors.success },
  clickNeg: { color: Colors.danger },
  disabled: { opacity: 0.4 },
  textBlock: { flex: 1, gap: 2 },
  title: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  notes: { color: Colors.textSecondary, fontSize: 12 },
  counter: { minWidth: 32, textAlign: 'right', fontSize: 14, fontWeight: '700' },
  counterPos: { color: Colors.success },
  counterNeg: { color: Colors.danger },
  counterZero: { color: Colors.textMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  badgeTextMuted: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
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
});
