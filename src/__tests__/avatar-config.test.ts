import {
  avatarConfigToUrl,
  FALLBACK_SEED,
  normalizeAvatarConfig,
  withFallbackSeed,
  type AvatarConfig,
} from '@/components/avatar/avatar-config';

const base: AvatarConfig = { style: 'pixel-art', seed: '', traits: {}, costume: {} };

describe('withFallbackSeed', () => {
  it('injects the fallback on an empty seed — the persisted-null-avatar bug', () => {
    // The original defect: a trait save wrote seed:'' while the preview
    // masked it — avatarConfigToUrl('') → null → letter avatar forever.
    expect(withFallbackSeed(base).seed).toBe(FALLBACK_SEED);
  });

  it('keeps a real seed and leaves the input untouched', () => {
    const withSeed = { ...base, seed: 'mario' };
    expect(withFallbackSeed(withSeed).seed).toBe('mario');
    expect(withSeed.seed).toBe('mario'); // no mutation
  });

  it('makes the empty-seed config produce a DiceBear URL', () => {
    expect(avatarConfigToUrl(base)).toBeNull();
    expect(avatarConfigToUrl(withFallbackSeed(base))).toMatch(
      `api.dicebear.com/9.x/pixel-art/png?seed=${FALLBACK_SEED}`,
    );
  });
});

describe('normalizeAvatarConfig', () => {
  it('defaults a missing seed to empty — withFallbackSeed owns the rescue', () => {
    expect(normalizeAvatarConfig({}).seed).toBe('');
    expect(normalizeAvatarConfig({ seed: 'abc' }).seed).toBe('abc');
  });
});
