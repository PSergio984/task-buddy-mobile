/**
 * Timeline day items — focus sessions as cards with their phases inline,
 * ledger events as compact marker rows. Same labeling rules as the web
 * day-timeline (lib/timeline.ts).
 */
import { StyleSheet, Text, View } from 'react-native';

import type { TimelineMarker, TimelineSessionBlock } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

import { utcTimeLabel } from './dates';

const DAY_MS = 86_400_000;

/** "session_started" → "Session started". */
export function markerLabel(type: string): string {
  const words = type.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Scoring summary from the marker's outcome blob; null when unscored. */
export function markerScoreLabel(outcome: Record<string, unknown> | null): string | null {
  if (outcome === null || outcome.scored !== true) return null;
  const parts: string[] = [];
  if (typeof outcome.xp === 'number' && outcome.xp > 0) parts.push(`+${outcome.xp} XP`);
  if (typeof outcome.gold === 'number' && outcome.gold > 0)
    parts.push(`+${Math.floor(outcome.gold)}g`);
  if (typeof outcome.hp_lost === 'number' && outcome.hp_lost > 0)
    parts.push(`−${outcome.hp_lost} HP`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function blockLabel(mode: string, activityLabel: string | null): string {
  if (activityLabel !== null && activityLabel !== '') return activityLabel;
  if (mode === 'stopwatch') return 'Stopwatch session';
  if (mode === 'speedrun') return 'Speedrun session';
  return 'Focus session';
}

function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.round(total / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** End label — a block running over UTC midnight gets a "+Nd" suffix. */
function endLabel(endIso: string | null, dayStartMs: number, dayEndMs: number): string {
  if (endIso === null) return 'running';
  const label = utcTimeLabel(endIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs) || endMs < dayEndMs) return label;
  const days = Math.max(1, Math.floor((endMs - dayStartMs) / DAY_MS));
  return `${label} +${days}d`;
}

export function SessionBlockCard({
  block,
  dayStartMs,
}: {
  block: TimelineSessionBlock;
  /** Date.parse(`${res.date}T00:00:00Z`) — the UTC axis the day buckets on. */
  dayStartMs: number;
}) {
  const dayEndMs = dayStartMs + DAY_MS;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {blockLabel(block.mode, block.activity_label)}
        </Text>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>{block.status}</Text>
        </View>
      </View>
      <Text style={styles.cardMeta}>
        {utcTimeLabel(block.started_at)}–{endLabel(block.ended_at, dayStartMs, dayEndMs)} UTC ·{' '}
        {durationLabel(block.duration_seconds)}
        {block.task_id !== null ? ` · Task #${block.task_id}` : ''}
      </Text>
      {block.phases.map((p) => (
        <View key={p.seq} style={styles.phaseRow}>
          <Text style={styles.phaseKind}>{markerLabel(p.kind)}</Text>
          <Text style={styles.phaseMeta}>
            {p.status} ·{' '}
            {p.actual_seconds !== null
              ? `${durationLabel(p.actual_seconds)} / ${durationLabel(p.planned_seconds)}`
              : `${durationLabel(p.planned_seconds)} planned`}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function MarkerRow({ marker }: { marker: TimelineMarker }) {
  const score = markerScoreLabel(marker.outcome);
  return (
    <View style={styles.markerRow}>
      <View style={styles.markerDot} />
      <Text style={styles.markerLabel} numberOfLines={1}>
        {markerLabel(marker.type)}
      </Text>
      {score !== null ? <Text style={styles.markerScore}>{score}</Text> : null}
      <Text style={styles.markerTime}>{utcTimeLabel(marker.ts)}</Text>
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardTitle: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '700' },
  statusChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusChipText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cardMeta: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  phaseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.two,
  },
  phaseKind: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  phaseMeta: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  markerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 28 },
  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textMuted,
  },
  markerLabel: { flex: 1, color: Colors.text, fontSize: 13 },
  markerScore: { color: Colors.accent, fontSize: 11, fontWeight: '700' },
  markerTime: { color: Colors.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'] },
});
