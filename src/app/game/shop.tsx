/**
 * Gear shop (#71 parity) — the catalog grouped by slot with buy/equip and
 * costume controls. All three writes return the merged GearListResponse
 * (items + authoritative profile totals), which folds into the ['gear']
 * and ['game-profile'] caches — same convention as the web hooks.
 */
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/api/auth';
import { gameApi, gearApi } from '@/api/game';
import type { GearListResponse } from '@/api/types';
import { EquipmentPanel } from '@/components/character/equipment-panel';
import { Colors, Spacing } from '@/constants/colors';

export default function ShopScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['game-profile'],
    queryFn: gameApi.getProfile,
    enabled: !!token,
  });
  const gearQuery = useQuery({
    queryKey: ['gear'],
    queryFn: gearApi.list,
    enabled: !!token,
  });

  // The response carries the merged catalog + authoritative profile —
  // fold both into their caches instead of refetching (web parity).
  const foldGear = (res: GearListResponse): void => {
    queryClient.setQueryData(['gear'], res.items);
    queryClient.setQueryData(['game-profile'], res.profile);
  };

  const buy = useMutation({
    mutationKey: ['gear-buy'],
    mutationFn: (key: string) => gearApi.buy(key),
    onSuccess: foldGear,
    onError: () => void queryClient.invalidateQueries({ queryKey: ['gear'] }),
  });
  const equip = useMutation({
    mutationKey: ['gear-equip'],
    mutationFn: (vars: { key: string; equipped: boolean }) =>
      gearApi.equip(vars.key, vars.equipped),
    onSuccess: foldGear,
    onError: () => void queryClient.invalidateQueries({ queryKey: ['gear'] }),
  });
  const costume = useMutation({
    mutationKey: ['gear-costume'],
    mutationFn: (vars: { key: string; costume: boolean }) =>
      gearApi.toggleCostume(vars.key, vars.costume),
    onSuccess: foldGear,
    onError: () => void queryClient.invalidateQueries({ queryKey: ['gear'] }),
  });

  // Pending item keys as a SET — mutation.variables tracks only the latest
  // call, so a double-submit on two rows must not free the first's button.
  const pendingBuyKeys = useMutationState({
    filters: { mutationKey: ['gear-buy'], status: 'pending' },
    select: (m) => m.state.variables as string,
  });
  const pendingEquipKeys = useMutationState({
    filters: { mutationKey: ['gear-equip'], status: 'pending' },
    select: (m) => (m.state.variables as { key: string }).key,
  });
  const pendingCostumeKeys = useMutationState({
    filters: { mutationKey: ['gear-costume'], status: 'pending' },
    select: (m) => (m.state.variables as { key: string }).key,
  });
  const pendingKeys = new Set([...pendingBuyKeys, ...pendingEquipKeys, ...pendingCostumeKeys]);

  const writeError = buy.error ?? equip.error ?? costume.error;

  if (gearQuery.isPending) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Gear Shop' }} />
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (gearQuery.data === undefined) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Gear Shop' }} />
        <Text style={styles.emptyText}>
          {gearQuery.error instanceof Error
            ? gearQuery.error.message
            : "Couldn't load the gear catalog."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading gear"
          style={styles.retryButton}
          onPress={() => void gearQuery.refetch()}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Gear Shop' }} />

      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Shop</Text>
        <Text style={styles.goldText}>{Math.floor(profileQuery.data?.gold ?? 0)}g</Text>
      </View>

      {writeError ? (
        <Text style={styles.errorText}>
          {writeError instanceof Error ? writeError.message : 'The write failed.'}
        </Text>
      ) : null}

      <EquipmentPanel
        items={gearQuery.data}
        profile={profileQuery.data}
        pendingKeys={pendingKeys}
        onBuy={(key) => buy.mutate(key)}
        onEquip={(key, equipped) => equip.mutate({ key, equipped })}
        onToggleCostume={(key, flag) => costume.mutate({ key, costume: flag })}
      />
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  goldText: { color: '#FBBF24', fontSize: 16, fontWeight: '900' },
  errorText: { color: Colors.danger, fontSize: 13 },
});
