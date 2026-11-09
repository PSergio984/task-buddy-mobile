/**
 * One editable preview card in the Smart Import flow (#3): title +
 * deadline (YYYY-MM-DD) + priority chips + read-only subtask preview,
 * gated by an include switch, with a remove affordance. All edits are
 * locked while a commit runs and permanently once the card is created.
 */
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { TaskPriority } from '@/api/types';
import { ChipGroup } from '@/components/chip-group';
import { deadlineError, type DraftProposal } from '@/components/import/draft';
import { Colors, Spacing } from '@/constants/colors';

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];

interface ProposalCardProps {
  draft: DraftProposal;
  /** Locks every control while a commit is in flight. */
  busy: boolean;
  onChange: (patch: Partial<DraftProposal>) => void;
  onRemove: () => void;
}

export function ProposalCard({ draft, busy, onChange, onRemove }: ProposalCardProps) {
  const locked = busy || draft.created;
  const deadlineHint = deadlineError(draft.deadline);

  return (
    <View style={[styles.card, !draft.included && styles.cardOff]}>
      <View style={styles.headRow}>
        <Switch
          value={draft.included}
          disabled={locked}
          onValueChange={(included) => onChange({ included })}
          trackColor={{ true: Colors.accent, false: Colors.backgroundSelected }}
          thumbColor={Colors.text}
          accessibilityLabel="Include this task"
        />
        {draft.created ? <Text style={styles.createdBadge}>Created</Text> : null}
        <View style={styles.headSpacer} />
        <Pressable
          onPress={onRemove}
          disabled={locked}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Remove this proposal"
        >
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.titleInput}
        value={draft.title}
        editable={!locked && draft.included}
        onChangeText={(title) => onChange({ title })}
        placeholder="Task title"
        placeholderTextColor={Colors.textMuted}
        accessibilityLabel="Task title"
        maxLength={100}
      />

      {draft.included ? (
        <>
          <Text style={styles.label}>Priority</Text>
          <ChipGroup
            options={PRIORITY_OPTIONS}
            selected={draft.priority}
            onSelect={(priority) => {
              // ChipGroup has no disabled state — gate the change here so
              // priority can't diverge from the payload mid-commit.
              if (!locked) onChange({ priority });
            }}
          />

          <Text style={styles.label}>Deadline (YYYY-MM-DD, optional)</Text>
          <TextInput
            style={styles.input}
            value={draft.deadline}
            editable={!locked}
            onChangeText={(deadline) => onChange({ deadline })}
            placeholder="e.g. 2026-03-15"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Deadline"
          />
          {deadlineHint ? <Text style={styles.hintError}>{deadlineHint}</Text> : null}
        </>
      ) : null}

      {draft.subtasks.length > 0 ? (
        <View style={styles.subtasks}>
          {draft.subtasks.map((title, index) => (
            <Text key={index} style={styles.subtaskText} numberOfLines={1}>
              • {title}
            </Text>
          ))}
        </View>
      ) : null}

      {draft.error ? <Text style={styles.errorText}>{draft.error}</Text> : null}
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
    gap: Spacing.two,
  },
  cardOff: { opacity: 0.45 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headSpacer: { flex: 1 },
  createdBadge: { color: Colors.success, fontSize: 12, fontWeight: '700' },
  removeText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  titleInput: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.two,
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
  hintError: { color: Colors.danger, fontSize: 12 },
  subtasks: { gap: 2, marginTop: Spacing.two },
  subtaskText: { color: Colors.textSecondary, fontSize: 13 },
  errorText: { color: Colors.danger, fontSize: 13, marginTop: Spacing.two },
});
