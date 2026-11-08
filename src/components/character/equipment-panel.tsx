/**
 * Equipment panel — the gear catalog grouped by slot with buy/equip and
 * costume controls. Port of web character/equipment-panel.tsx; the buy
 * guard (buyBlock) mirrors the server's ladder/class/gold rules so a
 * doomed purchase disables instead of failing.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GameProfile, GearItem } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

import { buyBlock, gearBySlot, type BuyBlock } from './character-utils';

const BLOCK_HINT: Record<BuyBlock, string> = {
  owned: '',
  class: 'Class locked',
  tier: 'Own the previous tier first',
  gold: 'Not enough gold',
};

function statsLabel(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([key, n]) => `+${n} ${key.toUpperCase()}`)
    .join(' · ');
}

interface EquipmentPanelProps {
  items: GearItem[];
  /** Missing profile is neutral — writes disable without claiming why. */
  profile: GameProfile | undefined;
  /** Item keys with a buy/equip/costume in flight; their buttons disable. */
  pendingKeys?: ReadonlySet<string>;
  onBuy: (key: string) => void;
  onEquip: (key: string, equipped: boolean) => void;
  onToggleCostume: (key: string, costume: boolean) => void;
}

export function EquipmentPanel({
  items,
  profile,
  pendingKeys,
  onBuy,
  onEquip,
  onToggleCostume,
}: EquipmentPanelProps) {
  return (
    <View style={styles.panels}>
      {[...gearBySlot(items).entries()].map(([slot, slotItems]) => (
        <View key={slot} style={styles.card}>
          <Text style={styles.slotTitle}>{slot}</Text>
          <View style={styles.itemList}>
            {slotItems.map((item) => {
              const block = profile !== undefined ? buyBlock(item, items, profile) : null;
              // set_equipped enforces the same class lock as buy_gear: an
              // owned cross-class piece stays owned but can't be re-worn.
              const equipLocked = item.klass !== 'all' && profile?.game_class !== item.klass;
              const classLocked = profile !== undefined && equipLocked;
              const hint =
                block !== null && block !== 'owned'
                  ? BLOCK_HINT[block]
                  : classLocked
                    ? BLOCK_HINT.class
                    : null;
              const pending = pendingKeys?.has(item.key) ?? false;
              // Cost joins a non-empty stats line with " · " — an item
              // with no stats must not orphan the separator.
              const meta = [statsLabel(item.stats), item.owned ? '' : `${item.cost}g`]
                .filter((part) => part !== '')
                .join(' · ');
              const costumeOn = item.costume === true;
              return (
                <View
                  key={item.key}
                  style={[styles.itemRow, item.equipped && styles.itemRowEquipped]}
                >
                  <View style={styles.itemText}>
                    <View style={styles.itemTitleRow}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>T{item.tier}</Text>
                      </View>
                      {item.losable ? (
                        <View style={[styles.badge, styles.badgeDanger]}>
                          <Text style={[styles.badgeText, styles.badgeDangerText]}>Losable</Text>
                        </View>
                      ) : null}
                      {item.klass !== 'all' ? (
                        <View style={[styles.badge, classLocked && styles.badgeDanger]}>
                          <Text style={[styles.badgeText, classLocked && styles.badgeDangerText]}>
                            {item.klass}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.itemMeta}>
                      {meta}
                      {hint !== null ? (
                        <Text style={styles.hintText}>
                          {meta === '' ? '' : ' · '}
                          {hint}
                        </Text>
                      ) : null}
                    </Text>
                  </View>

                  <View style={styles.actions}>
                    {item.equipped ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Unequip ${item.name}`}
                        accessibilityState={{ disabled: pending }}
                        style={[styles.actionButton, pending && styles.disabled]}
                        disabled={pending}
                        onPress={() => onEquip(item.key, false)}
                      >
                        <Text style={styles.equippedText}>Equipped</Text>
                      </Pressable>
                    ) : item.owned ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Equip ${item.name}`}
                        accessibilityHint={classLocked ? BLOCK_HINT.class : undefined}
                        accessibilityState={{ disabled: pending || equipLocked }}
                        style={[styles.actionButton, (pending || equipLocked) && styles.disabled]}
                        disabled={pending || equipLocked}
                        onPress={() => onEquip(item.key, true)}
                      >
                        <Text style={styles.actionText}>Equip</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Buy ${item.name}`}
                        accessibilityHint={
                          block !== null && block !== 'owned' ? BLOCK_HINT[block] : undefined
                        }
                        accessibilityState={{
                          disabled: pending || profile === undefined || block !== null,
                        }}
                        style={[
                          styles.actionButton,
                          styles.buyButton,
                          (pending || profile === undefined || block !== null) && styles.disabled,
                        ]}
                        disabled={pending || profile === undefined || block !== null}
                        onPress={() => onBuy(item.key)}
                      >
                        <Text style={styles.buyButtonText}>Buy</Text>
                      </Pressable>
                    )}

                    {/* Costume flags ride owned gear (#65) — absent on
                        pre-#65 backends, so the control only renders when
                        the field actually ships. */}
                    {item.owned && item.costume !== undefined ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${item.name} as costume`}
                        accessibilityState={{ selected: costumeOn, disabled: pending }}
                        style={[
                          styles.actionButton,
                          costumeOn && styles.costumeOn,
                          pending && styles.disabled,
                        ]}
                        disabled={pending}
                        onPress={() => onToggleCostume(item.key, !costumeOn)}
                      >
                        <Text style={[styles.actionText, costumeOn && styles.costumeOnText]}>
                          Costume
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {items.length === 0 ? <Text style={styles.empty}>The catalog is empty.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panels: { gap: Spacing.four },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  slotTitle: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  itemList: { gap: Spacing.two },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    padding: Spacing.three,
  },
  itemRowEquipped: {
    borderColor: 'rgba(194,163,136,0.3)',
    backgroundColor: 'rgba(194,163,136,0.08)',
  },
  itemText: { flex: 1, gap: 4, minWidth: 0 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  itemName: { color: Colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  badge: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  badgeDanger: { borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.1)' },
  badgeDangerText: { color: Colors.danger },
  itemMeta: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  hintText: { color: '#FBBF24' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  actionButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionText: { color: Colors.text, fontSize: 12, fontWeight: '700' },
  equippedText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
  buyButton: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  buyButtonText: { color: Colors.background, fontSize: 12, fontWeight: '700' },
  costumeOn: { borderColor: Colors.accent, backgroundColor: Colors.backgroundSelected },
  costumeOnText: { color: Colors.accent },
  disabled: { opacity: 0.4 },
  empty: { color: Colors.textSecondary, fontSize: 14 },
});
