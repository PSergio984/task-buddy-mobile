/**
 * Character-sheet helpers (pure, no React) — port of web lib/game-profile.ts.
 *
 * The buy guard mirrors the rules character_service.buy_gear enforces
 * server-side (class lock, ladder order, gold) so the UI can disable a
 * purchase it knows will fail.
 */
import type { GameClass, GameProfile, GearItem, StatKey } from '@/api/types';

/** Maps a StatKey onto the GameProfile column it increments. */
export const STAT_COLUMN = {
  str: 'str_stat',
  int: 'int_stat',
  con: 'con_stat',
  per: 'per_stat',
} as const;

export const STAT_META: readonly { key: StatKey; label: string }[] = [
  { key: 'str', label: 'Strength' },
  { key: 'int', label: 'Intelligence' },
  { key: 'con', label: 'Constitution' },
  { key: 'per', label: 'Perception' },
];

export const GAME_CLASSES: readonly {
  value: GameClass;
  label: string;
  /** The class's two affinity stats, for the pick-hint. */
  affinity: string;
}[] = [
  { value: 'warrior', label: 'Warrior', affinity: 'STR · CON' },
  { value: 'mage', label: 'Mage', affinity: 'INT · PER' },
  { value: 'healer', label: 'Healer', affinity: 'CON · INT' },
  { value: 'rogue', label: 'Rogue', affinity: 'PER · STR' },
];

/** engine.CLASS_MIN_LEVEL — classes open at level 10. */
export const CLASS_MIN_LEVEL = 10;

/**
 * engine.STAT_POINT_CAP — the TOTAL allocated pool (sum of the four
 * <stat>_stat columns) tops out at 100.
 */
export const STAT_POINT_CAP = 100;

/**
 * GameRates.respec_gold_cost default — display-only; the server enforces
 * the live value when the POST lands.
 */
export const RESPEC_GOLD_COST = 100;

/**
 * Total allocated points — allocate_points caps this at STAT_POINT_CAP,
 * so the + buttons disable once it's reached.
 */
export function allocatedPoints(profile: GameProfile): number {
  return STAT_META.reduce((n, { key }) => n + profile[STAT_COLUMN[key]], 0);
}

/**
 * A first pick needs level >= CLASS_MIN_LEVEL; class_unlocked is sticky
 * server-side so a classed-then-respeced user re-picks below 10.
 */
export function classChoiceOpen(profile: GameProfile): boolean {
  return profile.class_unlocked || profile.level >= CLASS_MIN_LEVEL;
}

/** Catalog rows grouped by slot, preserving the server's ordering. */
export function gearBySlot(items: GearItem[]): Map<string, GearItem[]> {
  const groups = new Map<string, GearItem[]>();
  for (const item of items) {
    const group = groups.get(item.slot);
    if (group === undefined) groups.set(item.slot, [item]);
    else group.push(item);
  }
  return groups;
}

export type BuyBlock = 'owned' | 'class' | 'tier' | 'gold';

/**
 * Why a buy would be rejected, or null when it can proceed — the same
 * checks character_service.buy_gear runs (ladder = tier N needs the owned
 * N-1 piece of the same slot+klass).
 */
export function buyBlock(item: GearItem, items: GearItem[], profile: GameProfile): BuyBlock | null {
  if (item.owned) return 'owned';
  if (item.klass !== 'all' && profile.game_class !== item.klass) return 'class';
  if (item.tier > 1) {
    const prev = items.find(
      (other) =>
        other.slot === item.slot && other.klass === item.klass && other.tier === item.tier - 1,
    );
    if (prev === undefined || !prev.owned) return 'tier';
  }
  if (profile.gold < item.cost) return 'gold';
  return null;
}
