/**
 * Daily create/edit modal — title, notes, difficulty, recurrence (daily /
 * every-n-days / weekdays / times-per-week), a one-item-per-line checklist
 * editor, reminder times and the active toggle (edit only). Mounted only
 * while open, so useState initializers are the whole reset story.
 *
 * Two backend full-replace fields drive the submit shape: `items` is sent
 * ONLY when the checklist changed (a replace cascade-deletes today's item
 * check marks), and `active` is sent only on edit (engine-owned on create).
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Daily, DailyInput, Recurrence, SessionDifficulty } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

/** Mirrors the backend's DailyIn bounds (title/items title ≤200, items ≤30). */
const TITLE_MAX = 200;
const ITEMS_MAX = 30;

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DIFFICULTY_OPTIONS: { value: SessionDifficulty; label: string }[] = [
  { value: 'trivial', label: 'Trivial' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const RECURRENCE_OPTIONS: { value: Recurrence['kind']; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'every_n_days', label: 'Every N days' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'times_per_week', label: 'Times/week' },
];

const digits = (t: string) => t.replace(/\D/g, '');

/** Checklist text → item inputs: one item per non-blank line, in order. */
function parseItemLines(text: string): { title: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((title) => ({ title }));
}

function ChipGroup<T extends string | number>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === o.value }}
          style={[styles.chip, selected === o.value && styles.chipSelected]}
          onPress={() => onSelect(o.value)}
        >
          <Text style={[styles.chipText, selected === o.value && styles.chipTextSelected]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

interface DailyEditorProps {
  /** undefined → create form; a daily → edit form prefilled from it. */
  initial?: Daily;
  busy: boolean;
  error: string | null;
  onSubmit: (input: DailyInput) => void;
  onClose: () => void;
}

export function DailyEditor({ initial, busy, error, onSubmit, onClose }: DailyEditorProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [difficulty, setDifficulty] = useState<SessionDifficulty>(initial?.difficulty ?? 'easy');
  const [kind, setKind] = useState<Recurrence['kind']>(initial?.recurrence?.kind ?? 'daily');
  const [days, setDays] = useState<number[]>(
    initial?.recurrence?.kind === 'weekdays' ? initial.recurrence.days : [0, 1, 2, 3, 4],
  );
  const [intervalText, setIntervalText] = useState(
    String(initial?.recurrence?.kind === 'every_n_days' ? initial.recurrence.interval : 2),
  );
  const [countText, setCountText] = useState(
    String(initial?.recurrence?.kind === 'times_per_week' ? initial.recurrence.count : 3),
  );
  const [itemsText, setItemsText] = useState((initial?.items ?? []).map((i) => i.title).join('\n'));
  const [reminders, setReminders] = useState((initial?.reminder_times ?? []).join(', '));
  const [active, setActive] = useState(initial?.active ?? true);

  const items = parseItemLines(itemsText);
  const itemsValid = items.length <= ITEMS_MAX && items.every((i) => i.title.length <= TITLE_MAX);
  const recurrenceValid = kind !== 'weekdays' || days.length > 0;
  const canSubmit = title.trim() !== '' && itemsValid && recurrenceValid && !busy;

  // Compare parsed titles, not raw text — a whitespace-only edit must not
  // trigger the full-replace either (see header note).
  const itemsChanged =
    initial === undefined ||
    items.map((i) => i.title).join('\n') !== initial.items.map((i) => i.title).join('\n');

  const toggleDay = (day: number) =>
    setDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    );

  const clampInt = (text: string, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, parseInt(text, 10) || lo));

  const recurrence: Recurrence =
    kind === 'weekdays'
      ? { kind, days: [...days].sort((a, b) => a - b) }
      : kind === 'every_n_days'
        ? {
            kind,
            interval: clampInt(intervalText, 1, 365),
            // The backend re-anchors an anchorless update to the PATCH day —
            // send the stored anchor back so an edit can't silently shift
            // the schedule phase.
            anchor:
              initial?.recurrence?.kind === 'every_n_days' ? initial.recurrence.anchor : undefined,
          }
        : kind === 'times_per_week'
          ? { kind, count: clampInt(countText, 1, 7) }
          : { kind: 'daily' };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      difficulty,
      recurrence,
      ...(itemsChanged ? { items } : {}),
      reminder_times: reminders
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
      ...(initial !== undefined ? { active } : {}),
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>{initial ? 'Edit daily' : 'New daily'}</Text>

            <Text style={styles.label}>Daily</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Daily title"
              value={title}
              maxLength={TITLE_MAX}
              placeholder="e.g. Morning workout"
              placeholderTextColor={Colors.textMuted}
              onChangeText={setTitle}
            />

            <Text style={styles.label}>Repeats</Text>
            <ChipGroup options={RECURRENCE_OPTIONS} selected={kind} onSelect={setKind} />
            {kind === 'weekdays' ? (
              <>
                <View style={styles.dayChips}>
                  {WEEKDAY_SHORT.map((name, day) => (
                    <Pressable
                      key={name}
                      accessibilityRole="button"
                      accessibilityState={{ selected: days.includes(day) }}
                      style={[styles.chip, days.includes(day) && styles.chipSelected]}
                      onPress={() => toggleDay(day)}
                    >
                      <Text
                        style={[styles.chipText, days.includes(day) && styles.chipTextSelected]}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {days.length === 0 ? (
                  <Text style={styles.hintError}>Pick at least one day.</Text>
                ) : null}
              </>
            ) : null}
            {kind === 'every_n_days' ? (
              <TextInput
                style={styles.input}
                accessibilityLabel="Every N days"
                value={intervalText}
                onChangeText={(t) => setIntervalText(digits(t))}
                keyboardType="number-pad"
                placeholder="2"
                placeholderTextColor={Colors.textMuted}
              />
            ) : null}
            {kind === 'times_per_week' ? (
              <TextInput
                style={styles.input}
                accessibilityLabel="Completions per week"
                value={countText}
                onChangeText={(t) => setCountText(digits(t))}
                keyboardType="number-pad"
                placeholder="3"
                placeholderTextColor={Colors.textMuted}
              />
            ) : null}

            <Text style={styles.label}>Difficulty</Text>
            <ChipGroup
              options={DIFFICULTY_OPTIONS}
              selected={difficulty}
              onSelect={setDifficulty}
            />

            <Text style={styles.label}>Checklist — one item per line</Text>
            <TextInput
              style={[styles.input, styles.itemsInput]}
              accessibilityLabel="Checklist items"
              value={itemsText}
              placeholder={'e.g.\nWarm up\n30-min session'}
              placeholderTextColor={Colors.textMuted}
              onChangeText={setItemsText}
              multiline
            />
            {!itemsValid ? (
              <Text style={styles.hintError}>
                Up to {ITEMS_MAX} items, {TITLE_MAX} characters each.
              </Text>
            ) : null}

            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Notes"
              value={notes}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
              onChangeText={setNotes}
            />

            <Text style={styles.label}>Reminders (HH:MM, comma separated)</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Reminder times"
              value={reminders}
              placeholder="e.g. 08:00, 21:30"
              placeholderTextColor={Colors.textMuted}
              onChangeText={setReminders}
            />

            {initial !== undefined ? (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Active — unchecked days cost HP</Text>
                <Switch
                  accessibilityLabel="Active"
                  accessibilityHint="Unchecked scheduled days are scored as misses while active"
                  value={active}
                  onValueChange={setActive}
                  trackColor={{ true: Colors.accent, false: Colors.backgroundSelected }}
                  thumbColor={Colors.text}
                />
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.buttons}>
              <Pressable
                style={styles.cancelButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, !canSubmit && styles.disabled]}
                disabled={!canSubmit}
                onPress={submit}
                accessibilityRole="button"
                accessibilityLabel={initial ? 'Save daily' : 'Add daily'}
              >
                {busy ? (
                  <ActivityIndicator color={Colors.background} />
                ) : (
                  <Text style={styles.saveText}>{initial ? 'Save daily' : 'Add daily'}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: Spacing.five,
  },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    maxHeight: '90%',
  },
  heading: { color: Colors.text, fontSize: 18, fontWeight: '700', marginBottom: Spacing.two },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  input: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  itemsInput: { minHeight: 72, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  dayChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.backgroundSelected },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: Colors.accent },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.three,
    marginTop: Spacing.three,
    gap: Spacing.three,
  },
  switchLabel: { color: Colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  hintError: { color: Colors.danger, fontSize: 12, marginTop: Spacing.two },
  errorText: { color: Colors.danger, fontSize: 13, marginTop: Spacing.three },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  cancelButton: {
    borderRadius: 10,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: Colors.background, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
