/**
 * Smart Import (#3): paste notes or pick a .md/.txt file → extract task
 * proposals (POST /api/v1/import/extract) → edit/include per card →
 * commit via POST /api/v1/tasks with a per-card X-Idempotency-Key that a
 * retry reuses, so re-submitting can never double-create. Extraction is
 * server-side AI — ApiError(0) surfaces plainly as "server unreachable".
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { importApi, tasksApi } from '@/api/client';
import { committable, toDrafts, toTaskCreate, type DraftProposal } from '@/components/import/draft';
import { ProposalCard } from '@/components/import/proposal-card';
import { Colors, Spacing } from '@/constants/colors';

/** Matches the extract contract's 1..10_000-char text field. */
const MAX_TEXT = 10_000;

export default function ImportScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftProposal[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const overLimit = text.length > MAX_TEXT;

  const extract = useMutation({
    mutationFn: (source: string) => importApi.extract(source),
    onSuccess: (data) => {
      setDrafts(toDrafts(data.proposals));
      setReason(data.reason);
      setInputError(null);
    },
  });

  const pickFile = async () => {
    setInputError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/markdown'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      // The contract limit counts characters, not bytes — check after the
      // read (asset.size is bytes and would false-positive on multibyte).
      const picked = await new File(asset.uri).text();
      if (picked.length > MAX_TEXT) {
        setInputError(`"${asset.name}" is over the 10,000-character limit.`);
        return;
      }
      setText(picked);
    } catch {
      setInputError('Could not read that file.');
    }
  };

  const updateDraft = (id: number, patch: Partial<DraftProposal>) => {
    setDrafts((ds) => ds?.map((d) => (d.id === id ? { ...d, ...patch } : d)) ?? ds);
  };

  const removeDraft = (id: number) => {
    setDrafts((ds) => ds?.filter((d) => d.id !== id) ?? ds);
  };

  const startOver = () => {
    setDrafts(null);
    setReason(null);
    extract.reset();
  };

  const commit = async () => {
    if (drafts === null || committing) return;
    const targets = committable(drafts);
    if (targets.length === 0) return;
    setCommitting(true);
    // Freeze payloads + keys up front — card edits are locked while this
    // runs, and each key is stored on the draft before its POST so a retry
    // reuses it instead of minting a new one.
    const jobs = targets.map((d) => ({
      id: d.id,
      key: d.idempotencyKey ?? Crypto.randomUUID(),
      payload: toTaskCreate(d),
    }));
    setDrafts(
      (ds) =>
        ds?.map((d) => {
          const job = jobs.find((j) => j.id === d.id);
          return job ? { ...d, idempotencyKey: job.key, error: null } : d;
        }) ?? ds,
    );
    let failures = 0;
    for (const job of jobs) {
      try {
        // Sequential: per-card progress stays visible and each create's
        // idempotency key is already committed to state before it posts.
        await tasksApi.create(job.payload, job.key);
        setDrafts(
          (ds) =>
            ds?.map((d) => (d.id === job.id ? { ...d, created: true, error: null } : d)) ?? ds,
        );
      } catch (e) {
        failures += 1;
        setDrafts(
          (ds) =>
            ds?.map((d) =>
              d.id === job.id
                ? { ...d, error: e instanceof Error ? e.message : 'Create failed' }
                : d,
            ) ?? ds,
        );
      }
    }
    setCommitting(false);
    const targetIds = new Set(jobs.map((j) => j.id));
    // Cards that were included but never committable (bad title/deadline)
    // block completion the same way failures do.
    const leftover = drafts.filter((d) => d.included && !d.created && !targetIds.has(d.id));
    if (failures === 0 && leftover.length === 0) {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      router.back();
    }
  };

  if (drafts !== null) {
    const pending = committable(drafts).length;
    return (
      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        data={drafts}
        keyExtractor={(d) => String(d.id)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ProposalCard
            draft={item}
            busy={committing}
            onChange={(patch) => updateDraft(item.id, patch)}
            onRemove={() => removeDraft(item.id)}
          />
        )}
        ListHeaderComponent={
          <View style={styles.listHead}>
            {reason ? <Text style={styles.reasonText}>{reason}</Text> : null}
            <Pressable
              onPress={startOver}
              disabled={committing}
              accessibilityRole="button"
              accessibilityLabel="Edit the notes"
            >
              <Text style={styles.startOver}>← Edit the notes</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={<Text style={styles.emptyText}>No tasks found in those notes.</Text>}
        ListFooterComponent={
          drafts.length > 0 ? (
            pending > 0 ? (
              <Pressable
                style={[styles.primaryButton, committing && styles.disabled]}
                disabled={committing}
                onPress={() => void commit()}
                accessibilityRole="button"
              >
                {committing ? (
                  <ActivityIndicator color={Colors.background} />
                ) : (
                  <Text style={styles.primaryText}>
                    Import {pending} {pending === 1 ? 'task' : 'tasks'}
                  </Text>
                )}
              </Pressable>
            ) : (
              <Text style={styles.emptyText}>Nothing selected to import.</Text>
            )
          ) : undefined
        }
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.noteInput}
          multiline
          value={text}
          onChangeText={setText}
          placeholder={'Paste notes — one task per line, or freeform text…'}
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="Notes to import"
        />
        <Text style={[styles.counter, overLimit && styles.counterOver]}>
          {text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()}
        </Text>
        {overLimit ? (
          <Text style={styles.errorText}>
            Over the 10,000-character limit — trim the notes before extracting.
          </Text>
        ) : null}
        {inputError ? <Text style={styles.errorText}>{inputError}</Text> : null}
        {extract.error instanceof Error ? (
          <Text style={styles.errorText}>{extract.error.message}</Text>
        ) : null}
        <View style={styles.buttonRow}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => void pickFile()}
            accessibilityRole="button"
            accessibilityLabel="Pick a markdown or text file"
          >
            <Text style={styles.secondaryText}>Pick .md / .txt</Text>
          </Pressable>
          <Pressable
            style={[
              styles.primaryButton,
              (text.trim() === '' || overLimit || extract.isPending) && styles.disabled,
            ]}
            disabled={text.trim() === '' || overLimit || extract.isPending}
            onPress={() => extract.mutate(text.trim())}
            accessibilityRole="button"
          >
            {extract.isPending ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <Text style={styles.primaryText}>Extract tasks</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  inputWrap: { flex: 1, padding: Spacing.four, gap: Spacing.two },
  noteInput: {
    flex: 1,
    backgroundColor: Colors.backgroundElement,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 15,
    padding: Spacing.three,
    textAlignVertical: 'top',
  },
  counter: { color: Colors.textMuted, fontSize: 12, textAlign: 'right' },
  counterOver: { color: Colors.danger },
  errorText: { color: Colors.danger, fontSize: 13 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: Colors.background, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  listContent: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  listHead: { gap: Spacing.two },
  reasonText: {
    color: Colors.gold,
    fontSize: 13,
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.three,
    overflow: 'hidden',
  },
  startOver: { color: Colors.accent, fontSize: 14, fontWeight: '600' },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
