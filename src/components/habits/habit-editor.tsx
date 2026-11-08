/**
 * Habit create/edit modal — title, notes, direction, difficulty, reminder
 * times (HH:MM comma list) and the bind_focus toggle. Mounted only while
 * open (the parent keys state off `initial`), so useState initializers are
 * the whole reset story.
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

import type { Habit, HabitDirection, HabitInput, SessionDifficulty } from '@/api/types';
import { ChipGroup } from '@/components/chip-group';
import { Colors, Spacing } from '@/constants/colors';

/** Mirrors the backend's HabitIn.title max_length. */
const TITLE_MAX = 200;

const DIRECTION_OPTIONS: { value: HabitDirection; label: string }[] = [
  { value: 'both', label: '+ and −' },
  { value: 'positive', label: '+ only' },
  { value: 'negative', label: '− only' },
];

const DIFFICULTY_OPTIONS: { value: SessionDifficulty; label: string }[] = [
  { value: 'trivial', label: 'Trivial' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

interface HabitEditorProps {
  /** undefined → create form; a habit → edit form prefilled from it. */
  initial?: Habit;
  busy: boolean;
  error: string | null;
  onSubmit: (input: HabitInput) => void;
  onClose: () => void;
}

export function HabitEditor({ initial, busy, error, onSubmit, onClose }: HabitEditorProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [direction, setDirection] = useState<HabitDirection>(initial?.direction ?? 'both');
  const [difficulty, setDifficulty] = useState<SessionDifficulty>(initial?.difficulty ?? 'easy');
  const [bindFocus, setBindFocus] = useState(initial?.bind_focus ?? false);
  const [reminders, setReminders] = useState((initial?.reminder_times ?? []).join(', '));

  // A negative-only habit accepts no +click, so binding is a stored no-op —
  // the toggle is disabled there and the flag is forced off on submit.
  const bindable = direction !== 'negative';
  const canSubmit = title.trim() !== '' && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      direction,
      difficulty,
      // The comma list shows every stored time, so a full replace is honest
      // (no hidden tail to preserve, unlike the web's single-slot field).
      reminder_times: reminders
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
      bind_focus: bindFocus && bindable,
    });
  };

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>{initial ? 'Edit habit' : 'New habit'}</Text>

            <Text style={styles.label}>Habit</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Habit title"
              value={title}
              maxLength={TITLE_MAX}
              placeholder="e.g. Read 20 pages"
              placeholderTextColor={Colors.textMuted}
              onChangeText={setTitle}
            />

            <Text style={styles.label}>Direction</Text>
            <ChipGroup options={DIRECTION_OPTIONS} selected={direction} onSelect={setDirection} />

            <Text style={styles.label}>Difficulty</Text>
            <ChipGroup
              options={DIFFICULTY_OPTIONS}
              selected={difficulty}
              onSelect={setDifficulty}
            />

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

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Auto +click per focus phase</Text>
              <Switch
                accessibilityLabel="Auto +click per focus phase"
                accessibilityHint={
                  bindable ? undefined : 'Negative-only habits cannot bind to focus'
                }
                value={bindFocus && bindable}
                disabled={!bindable}
                onValueChange={setBindFocus}
                trackColor={{ true: Colors.accent, false: Colors.backgroundSelected }}
                thumbColor={Colors.text}
              />
            </View>
            {!bindable ? (
              <Text style={styles.hint}>Negative-only habits can’t bind to focus.</Text>
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
                accessibilityLabel={initial ? 'Save habit' : 'Add habit'}
              >
                {busy ? (
                  <ActivityIndicator color={Colors.background} />
                ) : (
                  <Text style={styles.saveText}>{initial ? 'Save habit' : 'Add habit'}</Text>
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
  hint: { color: Colors.textMuted, fontSize: 12, fontStyle: 'italic', marginTop: Spacing.two },
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
