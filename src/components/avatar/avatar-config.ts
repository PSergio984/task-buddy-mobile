/**
 * DiceBear avatar config — the {style, seed, traits, costume} blob persisted
 * on the game profile. Port of web src/lib/avatar.ts (#65): the picker owns
 * the option vocabulary; the backend stores the blob as given.
 *
 * traits maps DiceBear HTTP-API option names to a single picked value — the
 * picker writes only the pixel-art keys below. costume is the gear layer —
 * owned equipment flagged as costume; the picker doesn't manage it but must
 * carry it through saves untouched.
 *
 * Divergence from web: the URL points at the /png endpoint (RN <Image>
 * can't render the web's /svg) and pins size=256 so the raster stays
 * crisp on the profile screen's larger frames.
 */

export type AvatarConfig = {
  style: string;
  seed: string;
  traits: Record<string, string>;
  // Picker-unmanaged — raw members carry through saves, so the member type
  // is unconstrained (backend currently stores string maps).
  costume: Record<string, unknown>;
};

/** DiceBear pixel-art is the spec'd avatar style (#46). */
export const DEFAULT_AVATAR_STYLE = 'pixel-art';

/** Seed injected wherever an absent one would silently produce a null
 *  DiceBear URL — saves and previews must agree on it. */
export const FALLBACK_SEED = 'taskbuddy';

/** A config guaranteed renderable — the empty-seed bug this guards
 *  persisted '' while the preview masked it with the fallback. */
export function withFallbackSeed(config: AvatarConfig): AvatarConfig {
  return { ...config, seed: config.seed || FALLBACK_SEED };
}

/** The DiceBear styles the picker offers — also the URL allowlist, so a
 *  stored config can never inject an arbitrary path segment. */
export const AVATAR_STYLES = [
  'pixel-art',
  'adventurer',
  'bottts',
  'thumbs',
  'micah',
  'miniavs',
  'personas',
  'fun-emoji',
] as const;

const DICEBEAR_STYLES = new Set<string>(AVATAR_STYLES);

const numbered = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);

/** Variant (single-select) options, from the DiceBear 9.x pixel-art schema. */
export const PIXEL_ART_VARIANTS: Record<string, string[]> = {
  hair: [...numbered('long', 21), ...numbered('short', 24)],
  eyes: numbered('variant', 12),
  mouth: [...numbered('happy', 13), ...numbered('sad', 10)],
  clothing: numbered('variant', 23),
  accessories: numbered('variant', 4),
};

/** Color (swatch) options — the style's shipped palettes, no '#'. */
export const PIXEL_ART_COLORS: Record<string, string[]> = {
  skinColor: ['ffdbac', 'f5cfa0', 'eac393', 'e0b687', 'cb9e6e', 'b68655', 'a26d3d', '8d5524'],
  hairColor: [
    'cab188',
    '603a14',
    '83623b',
    'a78961',
    '611c17',
    '603015',
    '612616',
    '28150a',
    '009bbd',
    'bd1700',
    '91cb15',
  ],
  clothingColor: [
    '5bc0de',
    '428bca',
    '03396c',
    '88d8b0',
    '44c585',
    '00b159',
    'ff6f69',
    'd11141',
    'ae0001',
    'ffeead',
    'ffd969',
    'ffc425',
  ],
  accessoriesColor: ['daa520', 'ffd700', 'fafad2', 'd3d3d3', 'a9a9a9'],
  backgroundColor: ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'],
};

const PIXEL_ART_OPTION_KEYS = new Set([
  ...Object.keys(PIXEL_ART_VARIANTS),
  ...Object.keys(PIXEL_ART_COLORS),
]);

/** Picked traits → pixel-art query params. Unknown keys and non-string
 *  values are skipped — options stored ahead of the picker's vocabulary
 *  carry through saves but never reach the URL. `accessories` also pins its
 *  probability gate to 100 so a picked variant always renders. */
function setPixelArtParams(params: URLSearchParams, traits: unknown): void {
  if (traits === null || typeof traits !== 'object') return;
  for (const [key, value] of Object.entries(traits)) {
    if (!PIXEL_ART_OPTION_KEYS.has(key)) continue;
    if (typeof value !== 'string' || value.length === 0) continue;
    params.set(key, value);
    if (key === 'accessories') params.set('accessoriesProbability', '100');
  }
}

/**
 * Config blob → DiceBear HTTP-API URL. Requires a seed; an absent style
 * defaults to pixel-art and a present-but-unknown style yields null so the
 * caller can fall back to initials (stored configs are user data — the
 * allowlist keeps arbitrary values out of the URL path).
 *
 * Trait params are emitted only for pixel-art — the option names above are
 * pixel-art's schema and other styles would 400 on unknown keys. Options
 * with a DiceBear `*Probability` gate (accessories) are pinned to 100 so a
 * picked variant always renders.
 */
export function avatarConfigToUrl(
  config: Record<string, unknown> | null | undefined,
): string | null {
  const seed = config?.seed;
  if (typeof seed !== 'string' || seed.length === 0) return null;
  const raw = config?.style ?? DEFAULT_AVATAR_STYLE;
  if (typeof raw !== 'string' || !DICEBEAR_STYLES.has(raw)) return null;

  const params = new URLSearchParams({ seed, size: '256' });
  if (raw === 'pixel-art') setPixelArtParams(params, config?.traits);
  return `https://api.dicebear.com/9.x/${raw}/png?${params.toString()}`;
}

/** 'short01' → 'Short 01', 'happy13' → 'Happy 13' — picker labels. */
export function traitLabel(value: string): string {
  return value.replace(/^([a-z]+)(\d+)$/i, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** String-valued members of the traits blob — Record<string,string>;
 *  other member types couldn't be saved back anyway. */
function stringMembers(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value !== null && typeof value === 'object') {
    for (const [key, member] of Object.entries(value)) {
      if (typeof member === 'string' && member.length > 0) out[key] = member;
    }
  }
  return out;
}

/**
 * Read the stored blob into a picker draft. Keys the picker doesn't manage —
 * costume gear flags, unrecognized trait keys, future top-level additions —
 * carry through untouched so a save never wipes them.
 */
export function normalizeAvatarConfig(raw: Record<string, unknown> | undefined): AvatarConfig {
  return {
    ...raw,
    style: typeof raw?.style === 'string' ? raw.style : DEFAULT_AVATAR_STYLE,
    seed: typeof raw?.seed === 'string' ? raw.seed : '',
    traits: stringMembers(raw?.traits),
    // costume is picker-unmanaged — the raw object passes through so
    // non-string members (ids, flags) survive a save unmangled.
    costume:
      raw?.costume !== null && typeof raw?.costume === 'object'
        ? (raw.costume as Record<string, unknown>)
        : {},
  };
}
