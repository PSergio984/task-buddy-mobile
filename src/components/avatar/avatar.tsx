/**
 * DiceBear avatar image + the worn-gear badge layer (#65 port).
 *
 * The image comes from avatarConfigToUrl (png — RN Image can't take the
 * web's svg). Gear has no sprite assets, so each visually-worn slot renders
 * a symbol badge anchored to the avatar frame — costume flags win their
 * slot, else the equipped piece shows. Only pixel-art supports the layer;
 * other styles show the base avatar untouched.
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { GearItem } from '@/api/types';
import { Colors } from '@/constants/colors';

import { avatarConfigToUrl, DEFAULT_AVATAR_STYLE } from './avatar-config';

type SymbolName = SymbolViewProps['name'];

const SLOT_ICONS: Record<string, SymbolName> = {
  weapon: { ios: 'figure.fencing', android: 'swords', web: 'swords' },
  shield: { ios: 'shield.fill', android: 'shield', web: 'shield' },
  head: { ios: 'crown.fill', android: 'crown', web: 'crown' },
  armor: { ios: 'shield.lefthalf.filled', android: 'health_and_safety', web: 'health_and_safety' },
  body: { ios: 'tshirt.fill', android: 'checkroom', web: 'checkroom' },
  back: { ios: 'backpack.fill', android: 'backpack', web: 'backpack' },
  eyewear: { ios: 'eyeglasses', android: 'eyeglasses', web: 'eyeglasses' },
};

const FALLBACK_ICON: SymbolName = { ios: 'diamond.fill', android: 'diamond', web: 'diamond' };

/** Badge anchors around the frame edge, as fractions of the avatar size. */
const SLOT_POSITION: Record<string, { x: number; y: number }> = {
  head: { x: 0.5, y: 0 },
  eyewear: { x: 0.86, y: 0.1 },
  weapon: { x: 0.98, y: 0.52 },
  back: { x: 0.14, y: 0.1 },
  shield: { x: 0.02, y: 0.52 },
  armor: { x: 0.22, y: 0.94 },
  body: { x: 0.78, y: 0.94 },
};

/** A catalog slot the map doesn't know anchors bottom-center — a new slot
 *  still shows its badge instead of rendering at the origin. */
const FALLBACK_POSITION = { x: 0.5, y: 0.96 };

/** Tier tint: iron → stone, steel+ → amber (web slate/amber scale). */
function tierTint(tier: number): string {
  if (tier <= 1) return '#A8A29E';
  if (tier === 2) return '#FBBF24';
  return '#FCD34D';
}

/**
 * Visually-worn item per slot: a costume flag wins its slot, else the
 * equipped piece shows. `costume` is absent on pre-#65 backends — the
 * `=== true` reads treat missing as false, so equipped still renders.
 */
function wornGear(items: readonly GearItem[]): Map<string, GearItem> {
  const worn = new Map<string, GearItem>();
  for (const item of items) {
    if (item.owned && item.costume === true && !worn.has(item.slot)) worn.set(item.slot, item);
  }
  for (const item of items) {
    if (item.owned && item.equipped && !worn.has(item.slot)) worn.set(item.slot, item);
  }
  return worn;
}

interface AvatarGearOverlayProps {
  items: readonly GearItem[];
  /** The avatar_config blob (or anything with a `style` member). */
  config?: { style?: unknown } | null;
  /** Parent frame size — badge diameter is 24% of it (web w-[24%]). */
  size: number;
}

export function AvatarGearOverlay({ items, config, size }: AvatarGearOverlayProps) {
  const style = typeof config?.style === 'string' ? config.style : undefined;
  if ((style ?? DEFAULT_AVATAR_STYLE) !== 'pixel-art') return null;
  const worn = wornGear(items);
  if (worn.size === 0) return null;
  const badge = Math.max(18, Math.round(size * 0.24));
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[...worn.values()].map((item) => {
        const pos = SLOT_POSITION[item.slot] ?? FALLBACK_POSITION;
        return (
          <View
            key={item.slot}
            accessibilityLabel={item.name}
            style={[
              styles.badge,
              {
                width: badge,
                height: badge,
                borderRadius: badge / 2,
                left: pos.x * size - badge / 2,
                top: pos.y * size - badge / 2,
              },
            ]}
          >
            <SymbolView
              name={SLOT_ICONS[item.slot] ?? FALLBACK_ICON}
              tintColor={tierTint(item.tier)}
              size={Math.round(badge * 0.62)}
            />
          </View>
        );
      })}
    </View>
  );
}

interface GameAvatarProps {
  /** The raw avatar_config blob — resolved through avatarConfigToUrl. */
  config: Record<string, unknown> | null | undefined;
  /** Frame edge length in px. */
  size?: number;
  /** Gear rows for the worn-gear badge layer (pixel-art only). */
  items?: readonly GearItem[];
}

/** DiceBear avatar with a letter fallback for missing/failed images. */
export function GameAvatar({ config, size = 48, items = [] }: GameAvatarProps) {
  // A changed config resets the failure fallback — same contract as web.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = avatarConfigToUrl(config);
  const showImg = url !== null && url !== failedUrl;
  const seed = typeof config?.seed === 'string' && config.seed.length > 0 ? config.seed : 'U';
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.frame, { borderRadius: Math.round(size / 4) }]}>
        {showImg ? (
          <Image
            source={{ uri: url }}
            accessibilityLabel="Avatar"
            style={styles.image}
            onError={() => setFailedUrl(url)}
          />
        ) : (
          <Text style={[styles.initial, { fontSize: Math.round(size * 0.4) }]}>
            {seed[0].toUpperCase()}
          </Text>
        )}
      </View>
      <AvatarGearOverlay items={items} config={config} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundSelected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  initial: { color: Colors.text, fontWeight: '900' },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(15,23,42,0.8)',
  },
});
