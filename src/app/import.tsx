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
import { usePreventRemove, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

import { ApiError, importApi, tasksApi } from '@/api/client';
import { committable, planJobs, toDrafts, type DraftProposal } from '@/components/import/draft';
import { ProposalCard } from '@/components/import/proposal-card';
import { Colors, Spacing } from '@/constants/colors';

/** Matches the extract contract's 1..10_000-char text field. */
const MAX_TEXT = 10_000;

// Module-level so the key survives screen unmount: leaving mid-extract
// loses the result but not the key — re-submitting the same text replays
// the cached (or still in-flight) response instead of billing a second
// LLM call, which is what lets navigation proceed during extraction.
let extractKeyCache: { source: string; key: string } | null = null;

/** Unicode code points — the backend counts these, not UTF-16 units
 *  (String.length would double-count emoji and false-positive the cap). */
const codePoints = (s: string) => Array.from(s).length;

export default function ImportScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftProposal[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  // Render state can't guard onPress — two taps before a re-render both
  // see committing=false. Refs gate the actual work.
  const commitInFlight = useRef(false);
  const extractInFlight = useRef(false);
  const textCount = codePoints(text);
  const overLimit = textCount > MAX_TEXT;

  // A second pick while the picker is already open rejects and flashes a
  // bogus error — same stale-state shape as the commit/extract guards.
  const pickingInFlight = useRef(false);

  // Back-nav runs in an effect, not inline in commit(): the committing=
  // false render must lift removal prevention before GO_BACK dispatches,
  // or the dispatch is swallowed and the user is stranded on Created cards.
  useEffect(() => {
    if (!commitDone) return;
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [commitDone, queryClient, router]);

  const extract = useMutation({
    mutationFn: ({ source, key }: { source: string; key: string }) =>
      importApi.extract(source, key),
    onSuccess: (data) => {
      setDrafts(toDrafts(data.proposals));
      setReason(data.reason);
      setInputError(null);
    },
    onSettled: () => {
      extractInFlight.current = false;
    },
  });

  // Back / swipe must not interrupt the POST loop — a pop mid-commit hides
  // per-card state. Extraction is NOT blocked: the key lives module-level,
  // so leaving mid-flight loses the response but re-submitting the same
  // text replays it (or attaches to the still-running call) — no double
  // billing, and nobody is stuck watching a 90s spinner.
  usePreventRemove(committing);

  const submitExtract = () => {
    const source = text.trim();
    if (source === '' || overLimit || extractInFlight.current) return;
    extractInFlight.current = true;
    const key = extractKeyCache?.source === source ? extractKeyCache.key : Crypto.randomUUID();
    extractKeyCache = { source, key };
    extract.mutate({ source, key });
  };

  const pickFile = async () => {
    if (pickingInFlight.current) return;
    pickingInFlight.current = true;
    setInputError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // Android providers report .md as octet-stream or x-markdown —
        // restricting to text/plain alone greys Drive-stored notes out.
        type: ['text/plain', 'text/markdown', 'text/x-markdown', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      // The wider MIME net means the extension is the real filter.
      if (!/\.(md|txt)$/i.test(asset.name)) {
        setInputError('Pick a .md or .txt file.');
        return;
      }
      // Each code point costs at most 4 UTF-8 bytes, so >40 KB guarantees
      // >10,000 code points — reject before buffering the file into memory.
      if (asset.size != null && asset.size > 40_000) {
        setInputError(`"${asset.name}" is over the 10,000-character limit.`);
        return;
      }
      // The contract limit counts characters, not bytes — check after the
      // read (asset.size is bytes and would false-positive on multibyte).
      const picked = await new File(asset.uri).text();
      if (codePoints(picked) > MAX_TEXT) {
        setInputError(`"${asset.name}" is over the 10,000-character limit.`);
        return;
      }
      setText(picked);
    } catch {
      setInputError('Could not read that file.');
    } finally {
      pickingInFlight.current = false;
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
    if (drafts === null || commitInFlight.current) return;
    // Freeze payloads + keys up front — card edits are locked while this
    // runs, and each key is stored on the draft before its POST so a retry
    // reuses it instead of minting a new one.
    const jobs = planJobs(drafts, () => Crypto.randomUUID());
    if (jobs.length === 0) return;
    commitInFlight.current = true;
    setCommitting(true);
    setDrafts(
      (ds) =>
        ds?.map((d) => {
          const job = jobs.find((j) => j.id === d.id);
          return job ? { ...d, idempotencyKey: job.key, error: null } : d;
        }) ?? ds,
    );
    let failures = 0;
    let anyCreated = false;
    try {
      for (const job of jobs) {
        try {
          // Sequential: per-card progress stays visible and each create's
          // idempotency key is already committed to state before it posts.
          await tasksApi.create(job.payload, job.key);
          anyCreated = true;
          setDrafts(
            (ds) =>
              ds?.map((d) => (d.id === job.id ? { ...d, created: true, error: null } : d)) ?? ds,
          );
        } catch (e) {
          // Same key + a different body means the first POST DID land —
          // the user edited the card after a create that succeeded
          // server-side but failed client-side (30s abort, network drop).
          // The task exists with its earlier payload; mark it created
          // instead of 422ing on every retry.
          if (e instanceof ApiError && e.status === 422 && /idempotency/i.test(e.message)) {
            anyCreated = true;
            setDrafts(
              (ds) =>
                ds?.map((d) =>
                  d.id === job.id
                    ? {
                        ...d,
                        created: true,
                        error: 'Created with the earlier values — the first attempt went through.',
                      }
                    : d,
                ) ?? ds,
            );
            continue;
          }
          failures += 1;
          const message =
            e instanceof ApiError && e.status === 429
              ? `${e.message} — wait a minute and retry`
              : e instanceof Error
                ? e.message
                : 'Create failed';
          setDrafts((ds) => ds?.map((d) => (d.id === job.id ? { ...d, error: message } : d)) ?? ds);
        }
      }
    } finally {
      commitInFlight.current = false;
      setCommitting(false);
    }
    const targetIds = new Set(jobs.map((j) => j.id));
    // Cards that were included but never committable (bad title/deadline)
    // block completion the same way failures do.
    const leftover = drafts.filter((d) => d.included && !d.created && !targetIds.has(d.id));
    // Invalidate on ANY success — a partial commit still landed tasks, and
    // backing out early must not leave the list stale.
    if (anyCreated) {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
    if (failures === 0 && leftover.length === 0) {
      setCommitDone(true);
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
        automaticallyAdjustKeyboardInsets
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
              // Once a card is created the task exists server-side — going
              // back to the notes would discard each card's `created` flag
              // and stored key, and a re-commit would double-create them.
              disabled={committing || drafts.some((d) => d.created)}
              style={committing || drafts.some((d) => d.created) ? styles.disabled : undefined}
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
          {textCount.toLocaleString()} / {MAX_TEXT.toLocaleString()}
        </Text>
        {overLimit ? (
          <Text style={styles.errorText}>
            Over the 10,000-character limit — trim the notes before extracting.
          </Text>
        ) : null}
        {inputError ? <Text style={styles.errorText}>{inputError}</Text> : null}
        {extract.error instanceof Error ? (
          <Text style={styles.errorText}>
            {extract.error instanceof ApiError && extract.error.status === 429
              ? `${extract.error.message} — wait a minute and retry`
              : extract.error.message}
          </Text>
        ) : null}
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.secondaryButton, extract.isPending && styles.disabled]}
            onPress={() => void pickFile()}
            disabled={extract.isPending}
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
            onPress={submitExtract}
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
