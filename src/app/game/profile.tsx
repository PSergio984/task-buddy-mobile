/**
 * Character/Profile screen (#71 parity) — profile header (level, XP/HP
 * bars, gold), attributes + class card, DiceBear avatar section,
 * achievements, and the diary retention preference. All writes go
 * straight to the game API (server owns gold/stat arithmetic); every
 * mutation returns the authoritative profile, which folds straight into
 * the ['game-profile'] cache.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/api/auth';
import { achievementsApi, characterApi, gameApi, gearApi } from '@/api/game';
import type { GameClass, GameProfile, RetentionPreference, StatKey } from '@/api/types';
import { GameAvatar } from '@/components/avatar/avatar';
import { DEFAULT_AVATAR_STYLE } from '@/components/avatar/avatar-config';
import { AvatarSection } from '@/components/avatar/avatar-picker';
import { AchievementsPanel } from '@/components/character/achievements-panel';
import { RESPEC_GOLD_COST } from '@/components/character/character-utils';
import { StatsPanel } from '@/components/character/stats-panel';
import { Colors, Spacing } from '@/constants/colors';

const RETENTION_OPTIONS: readonly { value: RetentionPreference; label: string }[] = [
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'forever', label: 'Forever' },
];

function StatBar({
  label,
  current,
  max,
  color,
}: {
  label: string;
  current: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  return (
    <View style={styles.barGroup}>
      <View style={styles.barLabelRow}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barLabel}>
          {Math.floor(current)} / {Math.floor(max)}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['game-profile'],
    queryFn: gameApi.getProfile,
    enabled: !!token,
  });
  const achievementsQuery = useQuery({
    queryKey: ['achievements'],
    queryFn: achievementsApi.list,
    enabled: !!token,
  });

  const profile = profileQuery.data;
  // The gear overlay renders for pixel-art only — another resolved style
  // would discard the rows, so the catalog fetch waits for a profile that
  // uses them (absent style means the pixel-art default, same as web).
  const avatarStyle = profile?.avatar_config.style;
  const pixelArt =
    (typeof avatarStyle === 'string' ? avatarStyle : DEFAULT_AVATAR_STYLE) === 'pixel-art';
  const gearQuery = useQuery({
    queryKey: ['gear'],
    queryFn: gearApi.list,
    enabled: !!token && profile !== undefined && pixelArt,
  });

  // Every character/avatar/retention write returns the authoritative
  // profile — fold it into the cache instead of refetching.
  const applyProfile = (updated: GameProfile): void => {
    queryClient.setQueryData(['game-profile'], updated);
  };

  const allocate = useMutation({
    mutationFn: (points: Partial<Record<StatKey, number>>) => characterApi.allocate(points),
    onSuccess: applyProfile,
  });
  const updateCharacter = useMutation({
    mutationFn: (autoAllocate: boolean) => characterApi.update(autoAllocate),
    onSuccess: applyProfile,
  });
  const selectClass = useMutation({
    mutationFn: (gameClass: GameClass) => characterApi.selectClass(gameClass),
    onSuccess: applyProfile,
  });
  const respec = useMutation({
    mutationFn: () => characterApi.respec(),
    onSuccess: applyProfile,
  });
  const updateAvatar = useMutation({
    mutationFn: (config: Record<string, unknown>) => gameApi.updateAvatarConfig(config),
    onSuccess: applyProfile,
  });
  const updateRetention = useMutation({
    mutationFn: (retention: RetentionPreference) => gameApi.updateRetention(retention),
    onSuccess: applyProfile,
  });

  const busy =
    allocate.isPending || updateCharacter.isPending || selectClass.isPending || respec.isPending;

  const confirmRespec = (): void => {
    Alert.alert('Respec', `Refunds all allocated points for ${RESPEC_GOLD_COST}g. Continue?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Respec', style: 'destructive', onPress: () => respec.mutate() },
    ]);
  };

  if (profileQuery.isPending) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (profile === undefined) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <Text style={styles.emptyText}>
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : "Couldn't load your character."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading profile"
          style={styles.retryButton}
          onPress={() => void profileQuery.refetch()}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const levelLine = `Lv ${profile.level}${profile.game_class ? ` · ${profile.game_class}` : ''}`;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Profile' }} />

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <GameAvatar config={profile.avatar_config} items={gearQuery.data ?? []} size={64} />
          <View style={styles.headerText}>
            <Text style={styles.levelText}>{levelLine}</Text>
            <Text style={styles.goldText}>{Math.floor(profile.gold)}g</Text>
          </View>
        </View>
        <StatBar label="HP" current={profile.hp} max={profile.max_hp} color={Colors.danger} />
        {profile.hp <= 0 ? (
          <Text style={styles.deadText}>You died — losable gear was dropped</Text>
        ) : null}
        <StatBar label="XP" current={profile.xp} max={profile.xp_to_next_level} color="#38BDF8" />
      </View>

      <StatsPanel
        profile={profile}
        busy={busy}
        onAllocate={(stat) => allocate.mutate({ [stat]: 1 })}
        onAutoAllocateChange={(enabled) => updateCharacter.mutate(enabled)}
        onSelectClass={(gameClass) => selectClass.mutate(gameClass)}
        onRespec={confirmRespec}
      />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Avatar</Text>
        <AvatarSection
          config={profile.avatar_config}
          items={gearQuery.data ?? []}
          pending={updateAvatar.isPending}
          onSave={(config) => updateAvatar.mutate(config)}
        />
      </View>

      {achievementsQuery.isPending ? (
        <ActivityIndicator color={Colors.accent} />
      ) : achievementsQuery.isError ? (
        <Text style={styles.emptyText}>{"Couldn't load achievements."}</Text>
      ) : (
        <AchievementsPanel achievements={achievementsQuery.data ?? []} />
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Diary retention</Text>
        <Text style={styles.retentionHint}>
          How far back diary entries and timeline days stay visible.
        </Text>
        <View style={styles.chipRow}>
          {RETENTION_OPTIONS.map((option) => {
            const selected = profile.retention === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`Retention ${option.label}`}
                accessibilityState={{
                  selected,
                  disabled: updateRetention.isPending,
                }}
                style={[styles.chip, selected && styles.chipSelected]}
                disabled={updateRetention.isPending}
                onPress={() => updateRetention.mutate(option.value)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.five,
    gap: Spacing.three,
    backgroundColor: Colors.background,
  },
  emptyText: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center' },
  retryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  cardTitle: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headerText: { flex: 1, gap: 2 },
  levelText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  goldText: { color: '#FBBF24', fontSize: 16, fontWeight: '900' },
  deadText: {
    color: Colors.danger,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  barGroup: { gap: 2 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },
  retentionHint: { color: Colors.textSecondary, fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.backgroundSelected },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: Colors.accent },
});
