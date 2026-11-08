/**
 * Diary entry editor — stand-ups get the three labeled fields, freeform a
 * single textarea. The same shape serves create (no `initial`) and edit.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DiaryEntryKind, DiaryEntryPatch } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

/** Mirrors the backend's _TEXT_MAX_LEN on diary fields. */
const FIELD_MAX = 10_000;

const STANDUP_FIELDS: readonly { key: 'good' | 'bad' | 'next'; label: string }[] = [
  { key: 'good', label: 'Went well' },
  { key: 'bad', label: "Didn't go well" },
  { key: 'next', label: 'Up next' },
];

interface DiaryEntryEditorProps {
  kind: DiaryEntryKind;
  initial?: DiaryEntryPatch;
  submitLabel: string;
  busy: boolean;
  onSubmit: (patch: DiaryEntryPatch) => void;
  onCancel?: () => void;
}

export function DiaryEntryEditor({
  kind,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: DiaryEntryEditorProps) {
  const [fields, setFields] = useState<DiaryEntryPatch>(initial ?? {});

  const set = (key: keyof DiaryEntryPatch, value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (kind === 'standup') {
      onSubmit({
        good: (fields.good ?? '').trim(),
        bad: (fields.bad ?? '').trim(),
        next: (fields.next ?? '').trim(),
      });
    } else {
      onSubmit({ freeform: (fields.freeform ?? '').trim() });
    }
  };

  // The backend requires at least one filled stand-up field / non-empty
  // freeform — an all-blank submit would just 422.
  const hasContent =
    kind === 'standup'
      ? STANDUP_FIELDS.some(({ key }) => (fields[key] ?? '').trim() !== '')
      : (fields.freeform ?? '').trim() !== '';

  return (
    <View style={styles.editor}>
      {kind === 'standup' ? (
        STANDUP_FIELDS.map(({ key, label }) => (
          <View key={key} style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              multiline
              maxLength={FIELD_MAX}
              accessibilityLabel={label}
              value={fields[key] ?? ''}
              onChangeText={(v) => set(key, v)}
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        ))
      ) : (
        <TextInput
          style={[styles.input, styles.freeform]}
          multiline
          maxLength={FIELD_MAX}
          accessibilityLabel="Entry text"
          placeholder="What else happened today?"
          placeholderTextColor={Colors.textMuted}
          value={fields.freeform ?? ''}
          onChangeText={(v) => set('freeform', v)}
        />
      )}
      <View style={styles.actions}>
        <Pressable
          style={[styles.submit, (!hasContent || busy) && styles.disabled]}
          disabled={!hasContent || busy}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
        >
          <Text style={styles.submitText}>{submitLabel}</Text>
        </Pressable>
        {onCancel !== undefined ? (
          <Pressable
            style={styles.cancel}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: Spacing.three },
  field: { gap: 4 },
  fieldLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 40,
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
  freeform: { minHeight: 72 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  submit: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: Spacing.four,
  },
  submitText: { color: Colors.background, fontSize: 14, fontWeight: '700' },
  cancel: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  cancelText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
