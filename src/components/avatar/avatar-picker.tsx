/**
 * Avatar section — DiceBear preview plus the picker's trait surface:
 * seed, style chips, and (pixel-art only) variant selects and color
 * swatches. Port of web avatar-picker.tsx; unlike the web draft+Save
 * flow, each pick PATCHes the whole config blob immediately via onSave.
 * Keys the picker doesn't manage (costume flags, unknown traits) carry
 * through normalizeAvatarConfig untouched.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AvatarConfig } from './avatar-config';
import type { GearItem } from '@/api/types';
import { Colors, Spacing } from '@/constants/colors';

import { GameAvatar } from './avatar';
import {
  AVATAR_STYLES,
  FALLBACK_SEED,
  normalizeAvatarConfig,
  PIXEL_ART_COLORS,
  PIXEL_ART_VARIANTS,
  traitLabel,
  withFallbackSeed,
} from './avatar-config';

const VARIANT_LABELS: Record<string, string> = {
  hair: 'Hair',
  eyes: 'Eyes',
  mouth: 'Mouth',
  clothing: 'Outfit',
  accessories: 'Accessory',
};

const COLOR_LABELS: Record<string, string> = {
  skinColor: 'Skin',
  hairColor: 'Hair color',
  clothingColor: 'Outfit color',
  accessoriesColor: 'Accessory color',
  backgroundColor: 'Background',
};

interface AvatarSectionProps {
  /** Raw profile.avatar_config blob. */
  config: Record<string, unknown>;
  /** Gear rows for the worn-gear badge layer on the preview. */
  items?: readonly GearItem[];
  /** A save is in flight — all controls disable meanwhile (web parity). */
  pending: boolean;
  /** Writes the WHOLE config object back (updateAvatarConfig). */
  onSave: (config: Record<string, unknown>) => void;
}

export function AvatarSection({
  config: rawConfig,
  items = [],
  pending,
  onSave,
}: AvatarSectionProps) {
  const config = normalizeAvatarConfig(rawConfig);
  // null draft = untouched; editing the seed holds it locally until blur.
  const [seedText, setSeedText] = useState<string | null>(null);
  const seed = seedText ?? config.seed;

  // Saves merge onto the last config this component *requested*, not the
  // last server echo — concurrent whole-blob PATCHes (a trait chip tapped
  // while a seed commit is in flight) would otherwise silently revert
  // each other, last-write-wins.
  const requested = useRef<AvatarConfig | null>(null);
  useEffect(() => {
    requested.current = null;
  }, [rawConfig]);

  // Every save path carries a non-empty seed — an absent seed must persist
  // as the fallback the preview shows, not '' (avatarConfigToUrl(null) →
  // the avatar degrades to a letter everywhere else).
  const save = (patch: Record<string, unknown>): void => {
    const next = {
      ...withFallbackSeed(requested.current ?? config),
      // A seed still being typed is user intent — a concurrent chip tap
      // must not persist the pre-edit seed over it.
      ...(seedText !== null ? { seed: seedText.trim() || FALLBACK_SEED } : {}),
      ...patch,
    };
    requested.current = next;
    onSave(next);
  };

  const setTrait = (key: string, value: string | null): void => {
    const traits = { ...(requested.current ?? config).traits };
    if (value === null) delete traits[key];
    else traits[key] = value;
    save({ traits });
  };

  const commitSeed = (): void => {
    const next = seed.trim() || FALLBACK_SEED;
    if (next !== config.seed) save({ seed: next });
  };

  return (
    <View style={styles.section}>
      <View style={styles.previewRow}>
        <GameAvatar config={withFallbackSeed(config)} items={items} size={96} />
        <View style={styles.seedField}>
          <Text style={styles.label}>Seed</Text>
          <TextInput
            style={styles.seedInput}
            accessibilityLabel="Avatar seed"
            value={seed}
            onChangeText={setSeedText}
            onEndEditing={commitSeed}
            onSubmitEditing={commitSeed}
            placeholder="Anything — e.g. your username"
            placeholderTextColor={Colors.textMuted}
            editable={!pending}
            maxLength={64}
            returnKeyType="done"
          />
        </View>
      </View>

      <Text style={styles.label}>Style</Text>
      <View style={styles.chipRow}>
        {AVATAR_STYLES.map((style) => (
          <Pressable
            key={style}
            accessibilityRole="button"
            accessibilityLabel={`Avatar style ${style}`}
            accessibilityState={{ selected: config.style === style, disabled: pending }}
            style={[styles.chip, config.style === style && styles.chipSelected]}
            disabled={pending}
            onPress={() => save({ style })}
          >
            <Text style={[styles.chipText, config.style === style && styles.chipTextSelected]}>
              {style}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Trait/color pickers only apply to pixel-art — avatarConfigToUrl
          ignores their option names for other stored styles. */}
      {config.style === 'pixel-art' ? (
        <>
          {Object.entries(PIXEL_ART_VARIANTS).map(([key, options]) => {
            const label = VARIANT_LABELS[key] ?? traitLabel(key);
            const picked = config.traits[key];
            return (
              <View key={key} style={styles.traitGroup}>
                <Text style={styles.label}>{label}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.optionRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${label} auto`}
                      accessibilityState={{ selected: picked === undefined, disabled: pending }}
                      style={[styles.chip, picked === undefined && styles.chipSelected]}
                      disabled={pending}
                      onPress={() => setTrait(key, null)}
                    >
                      <Text
                        style={[styles.chipText, picked === undefined && styles.chipTextSelected]}
                      >
                        Auto
                      </Text>
                    </Pressable>
                    {options.map((option) => (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityLabel={`${label} ${traitLabel(option)}`}
                        accessibilityState={{ selected: picked === option, disabled: pending }}
                        style={[styles.chip, picked === option && styles.chipSelected]}
                        disabled={pending}
                        onPress={() => setTrait(key, option)}
                      >
                        <Text
                          style={[styles.chipText, picked === option && styles.chipTextSelected]}
                        >
                          {traitLabel(option)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            );
          })}

          {Object.entries(PIXEL_ART_COLORS).map(([key, palette]) => {
            const label = COLOR_LABELS[key] ?? traitLabel(key);
            const picked = config.traits[key];
            return (
              <View key={key} style={styles.traitGroup}>
                <Text style={styles.label}>{label}</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${label} auto`}
                    accessibilityState={{ selected: picked === undefined, disabled: pending }}
                    style={[styles.chip, picked === undefined && styles.chipSelected]}
                    disabled={pending}
                    onPress={() => setTrait(key, null)}
                  >
                    <Text
                      style={[styles.chipText, picked === undefined && styles.chipTextSelected]}
                    >
                      Auto
                    </Text>
                  </Pressable>
                  {palette.map((color) => (
                    <Pressable
                      key={color}
                      accessibilityRole="button"
                      accessibilityLabel={`${label} ${color}`}
                      accessibilityState={{ selected: picked === color, disabled: pending }}
                      hitSlop={8}
                      style={[
                        styles.swatch,
                        { backgroundColor: `#${color}` },
                        picked === color && styles.swatchSelected,
                      ]}
                      disabled={pending}
                      onPress={() => setTrait(key, color)}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  previewRow: { flexDirection: 'row', gap: Spacing.four, alignItems: 'center' },
  seedField: { flex: 1, gap: Spacing.two },
  label: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  seedInput: {
    backgroundColor: Colors.backgroundElement,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  optionRow: { flexDirection: 'row', gap: Spacing.two },
  traitGroup: { gap: Spacing.two },
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
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    alignSelf: 'center',
  },
  swatchSelected: { borderColor: Colors.accent, borderWidth: 3 },
});
