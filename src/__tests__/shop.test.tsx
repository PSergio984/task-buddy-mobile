/**
 * Gear shop smoke + behavior tests — items render grouped by slot, the
 * buy guard disables when gold < cost (server mirror), and Equip posts
 * to gearApi.equip. Mocks follow focus.test.tsx conventions.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { gameApi, gearApi } from '@/api/game';
import type { GameProfile, GearItem } from '@/api/types';
import ShopScreen from '@/app/game/shop';

/* --- mocks --- */

// Stack.Screen reads the navigation context — bare render has none.
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

jest.mock('@/api/auth', () => ({
  useAuth: () => ({ token: 'tok', hydrated: true }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('tok'),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@/api/game', () => ({
  gameApi: { getProfile: jest.fn() },
  gearApi: {
    list: jest.fn(),
    buy: jest.fn(),
    equip: jest.fn(),
    toggleCostume: jest.fn(),
  },
}));

const profile: GameProfile = {
  level: 12,
  xp: 0,
  xp_to_next_level: 500,
  hp: 50,
  max_hp: 50,
  gold: 75,
  str_stat: 0,
  int_stat: 0,
  con_stat: 0,
  per_stat: 0,
  unspent_stat_points: 0,
  game_class: 'warrior',
  class_unlocked: true,
  auto_allocate: true,
  avatar_config: {},
  xp_today: 0,
  gold_today: 0,
  retention: 'forever',
};

const gear: GearItem[] = [
  {
    key: 'weapon_iron_sword',
    name: 'Iron Sword',
    slot: 'weapon',
    klass: 'all',
    tier: 1,
    stats: { str: 2 },
    cost: 100,
    losable: true,
    owned: false,
    equipped: false,
  },
  {
    key: 'armor_leather',
    name: 'Leather Armor',
    slot: 'armor',
    klass: 'all',
    tier: 1,
    stats: { con: 1 },
    cost: 50,
    losable: false,
    owned: true,
    equipped: false,
    costume: false,
  },
  {
    key: 'armor_steel',
    name: 'Steel Armor',
    slot: 'armor',
    klass: 'all',
    tier: 2,
    stats: { con: 3 },
    cost: 300,
    losable: false,
    owned: false,
    equipped: false,
  },
];

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return await render(
    <QueryClientProvider client={client}>
      <ShopScreen />
    </QueryClientProvider>,
  );
}

// Cold jest caches lazily load RN internals on the first render — that
// cost lands inside the running test's 5s budget, so warm it here.
beforeAll(async () => {
  (gameApi.getProfile as jest.Mock).mockResolvedValue(profile);
  (gearApi.list as jest.Mock).mockResolvedValue(gear);
  (await renderScreen()).unmount();
}, 30000);

beforeEach(() => {
  jest.clearAllMocks();
  (gameApi.getProfile as jest.Mock).mockResolvedValue(profile);
  (gearApi.list as jest.Mock).mockResolvedValue(gear);
});

describe('ShopScreen', () => {
  it('renders the gold balance and items grouped by slot', async () => {
    await renderScreen();
    expect(await screen.findByText('75g')).toBeTruthy();
    expect(screen.getByText('weapon')).toBeTruthy();
    expect(screen.getByText('armor')).toBeTruthy();
    expect(screen.getByText('Iron Sword')).toBeTruthy();
    expect(screen.getByText('Leather Armor')).toBeTruthy();
    expect(screen.getByText('Steel Armor')).toBeTruthy();
  });

  it('disables Buy when gold < cost', async () => {
    await renderScreen();
    await screen.findByText('Iron Sword');
    // 75g < 100g cost — the server-mirroring buyBlock guard.
    expect(screen.getByLabelText('Buy Iron Sword')).toBeDisabled();
    // Steel Armor is also past the ladder (tier 2 needs owned tier 1).
    expect(screen.getByLabelText('Buy Steel Armor')).toBeDisabled();
  });

  it('Equip posts gearApi.equip(key, true)', async () => {
    (gearApi.equip as jest.Mock).mockResolvedValue({ items: gear, profile });
    await renderScreen();
    await screen.findByText('Leather Armor');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Equip Leather Armor'));
    });
    expect(gearApi.equip).toHaveBeenCalledTimes(1);
    expect(gearApi.equip).toHaveBeenCalledWith('armor_leather', true);
  });
});
