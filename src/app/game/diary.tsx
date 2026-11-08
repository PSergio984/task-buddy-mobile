/**
 * Diary screen — newest-first entry list plus today's editor. Stand-ups
 * are one-per-UTC-day (backend enforces it), so the kind picker only
 * offers a stand-up while today doesn't have one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/api/auth';
import { diaryApi } from '@/api/game';
import type { DiaryEntry, DiaryEntryInput, DiaryEntryKind, DiaryEntryPatch } from '@/api/types';
import { addUtcDays, todayUtcDay, utcDayLabel, type UtcDay } from '@/components/activity/dates';
import { DiaryEntryCard } from '@/components/diary/entry-card';
import { DiaryEntryEditor } from '@/components/diary/entry-editor';
import { Colors, Spacing } from '@/constants/colors';

const KINDS: DiaryEntryKind[] = ['freeform', 'standup'];

export default function DiaryScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [kind, setKind] = useState<DiaryEntryKind>('freeform');
  /** Bumped on each successful create — remounts the editor empty while
   *  a failed submit (or the list's first load) keeps the draft. */
  const [draftKey, setDraftKey] = useState(0);

  const entriesQuery = useQuery({
    queryKey: ['diary'],
    queryFn: () => diaryApi.list(),
    enabled: !!token,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['diary'] });
    // Timeline day responses embed the same DiaryEntry rows.
    void queryClient.invalidateQueries({ queryKey: ['timeline'] });
  };

  const createEntry = useMutation({
    mutationFn: (input: DiaryEntryInput) => diaryApi.create(input),
    onSuccess: () => {
      setDraftKey((k) => k + 1);
      invalidate();
    },
  });
  const updateEntry = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: DiaryEntryPatch }) =>
      diaryApi.update(id, patch),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });
  const deleteEntry = useMutation({
    mutationFn: (id: number) => diaryApi.remove(id),
    onSuccess: invalidate,
  });

  const busy = createEntry.isPending || updateEntry.isPending || deleteEntry.isPending;
  const mutationError = createEntry.error ?? updateEntry.error ?? deleteEntry.error;

  const entries = entriesQuery.data?.entries ?? [];
  // UTC rollover — a screen left open across midnight must write to the
  // new day, not the day it mounted on.
  const [today, setToday] = useState<UtcDay>(todayUtcDay);
  useEffect(() => {
    const id = setInterval(() => {
      const now = todayUtcDay();
      setToday((d) => (d === now ? d : now));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  // The editor targets `entryDay` (today by default) — the ‹› stepper
  // backfills missed days; the API accepts entry_date on create.
  const [entryDay, setEntryDay] = useState<UtcDay | null>(null);
  // Frozen at mount: after UTC rollover a draft keeps the day it was
  // started on (and submits there) instead of remounting empty or
  // silently landing on the new day. ‹› steps out of the pin explicitly.
  const [pinnedDay] = useState(today);
  const targetDay = entryDay ?? pinnedDay;
  // One stand-up per (user, UTC day) — the backend unique-indexes it, so
  // the editor stops offering the kind once that day's exists. Gated on
  // the list having loaded — and on page 1 only: a standup beyond
  // has_more still 422s on submit (the server remains the authority).
  const hasDayStandup = entries.some((e) => e.kind === 'standup' && e.entry_date === targetDay);
  const editorKind = hasDayStandup ? 'freeform' : kind;

  const header = (
    <View style={styles.headerCard}>
      <View style={styles.dayNav}>
        <Pressable
          style={styles.dayNavButton}
          onPress={() => setEntryDay(addUtcDays(targetDay, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Text style={styles.dayNavButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {targetDay === today ? 'Today' : 'Entry for'} — {utcDayLabel(targetDay)}
        </Text>
        <Pressable
          style={[styles.dayNavButton, targetDay === today && styles.dayNavDisabled]}
          onPress={() => setEntryDay(addUtcDays(targetDay, 1))}
          disabled={targetDay === today}
          accessibilityRole="button"
          accessibilityLabel="Next day"
        >
          <Text style={styles.dayNavButtonText}>›</Text>
        </Pressable>
      </View>
      {entriesQuery.isPending ? (
        <ActivityIndicator color={Colors.accent} />
      ) : (
        <>
          {!hasDayStandup ? (
            <View style={styles.kindPicker} accessibilityRole="radiogroup">
              {KINDS.map((k) => (
                <Pressable
                  key={k}
                  style={[styles.kindOption, editorKind === k && styles.kindOptionActive]}
                  onPress={() => setKind(k)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: editorKind === k }}
                  accessibilityLabel={k === 'standup' ? 'Stand-up' : 'Freeform'}
                >
                  <Text
                    style={[styles.kindOptionText, editorKind === k && styles.kindOptionTextActive]}
                  >
                    {k === 'standup' ? 'Stand-up' : 'Freeform'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* Keyed on draftKey + kind + the explicit nav day — a
              successful create remounts the editor empty, a failed
              submit keeps the draft, and UTC rollover can't steal one
              (entryDay is still null, so the key doesn't move). */}
          <DiaryEntryEditor
            key={`new-${draftKey}-${editorKind}-${entryDay ?? 'pinned'}`}
            kind={editorKind}
            submitLabel={editorKind === 'standup' ? 'Save stand-up' : 'Add entry'}
            busy={busy}
            onSubmit={(patch) =>
              createEntry.mutate({ kind: editorKind, entry_date: targetDay, ...patch })
            }
          />
        </>
      )}
    </View>
  );

  const renderEntry = ({ item }: { item: DiaryEntry }) =>
    editingId === item.id ? (
      <View style={styles.editCard}>
        <DiaryEntryEditor
          kind={item.kind}
          initial={item}
          submitLabel="Save"
          busy={busy}
          onSubmit={(patch) => updateEntry.mutate({ id: item.id, patch })}
          onCancel={() => setEditingId(null)}
        />
      </View>
    ) : (
      <DiaryEntryCard
        entry={item}
        onEdit={() => setEditingId(item.id)}
        onDelete={() => deleteEntry.mutate(item.id)}
      />
    );

  return (
    <>
      <Stack.Screen options={{ title: 'Diary' }} />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          style={styles.root}
          contentContainerStyle={styles.content}
          data={entries}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderEntry}
          ListHeaderComponent={
            <View style={styles.headerWrap}>
              {header}
              {mutationError instanceof Error ? (
                <Text style={styles.error}>{mutationError.message}</Text>
              ) : null}
              {entriesQuery.isPending ? (
                <ActivityIndicator color={Colors.accent} />
              ) : entriesQuery.isError ? (
                <Text style={styles.error}>Couldn’t load your diary entries.</Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            !entriesQuery.isPending && !entriesQuery.isError ? (
              <Text style={styles.empty}>No entries yet — write the first one above.</Text>
            ) : undefined
          }
          ListFooterComponent={
            entriesQuery.data?.has_more === true ? (
              <Text style={styles.hasMore}>
                Older entries exist — showing the most recent page.
              </Text>
            ) : undefined
          }
        />
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.two },
  headerWrap: { gap: Spacing.two, marginBottom: Spacing.two },
  headerCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  dayNav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dayNavButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 10,
  },
  dayNavButtonText: { color: Colors.text, fontSize: 20, fontWeight: '700' },
  dayNavDisabled: { opacity: 0.3 },
  kindPicker: { flexDirection: 'row', gap: Spacing.two },
  kindOption: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
  },
  kindOptionActive: { backgroundColor: Colors.backgroundSelected, borderColor: Colors.accent },
  kindOptionText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  kindOptionTextActive: { color: Colors.text },
  editCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.three,
  },
  error: { color: Colors.danger, fontSize: 13 },
  empty: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  hasMore: {
    color: Colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
});
