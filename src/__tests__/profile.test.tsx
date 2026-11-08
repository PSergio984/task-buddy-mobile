/**
 * Profile screen smoke + behavior tests — header renders the profile
 * totals, the + button posts a single point to characterApi.allocate,
 * and the class picker posts its pick. The game API surface is mocked
 * behind interfaces (same convention as focus.test.tsx).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { achievementsApi, characterApi, gameApi, gearApi } from '@/api/game';
import type { GameProfile } from '@/api/types';
import ProfileScreen from '@/app/game/profile';

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
  gameApi: {
    getProfile: jest.fn(),
    updateRetention: jest.fn(),
    updateAvatarConfig: jest.fn(),
  },
  characterApi: {
    update: jest.fn(),
    allocate: jest.fn(),
    selectClass: jest.fn(),
    respec: jest.fn(),
  },
  gearApi: {
    list: jest.fn().mockResolvedValue([]),
    buy: jest.fn(),
    equip: jest.fn(),
    toggleCostume: jest.fn(),
  },
  achievementsApi: {
    list: jest.fn().mockResolvedValue([]),
  },
}));

const profile: GameProfile = {
  level: 5,
  xp: 120,
  xp_to_next_level: 200,
  hp: 40,
  max_hp: 50,
  gold: 250,
  str_stat: 3,
  int_stat: 2,
  con_stat: 4,
  per_stat: 1,
  unspent_stat_points: 2,
  game_class: null,
  class_unlocked: false,
  auto_allocate: false,
  avatar_config: { style: 'pixel-art', seed: 'abc', traits: {}, costume: {} },
  xp_today: 0,
  gold_today: 0,
  retention: 'forever',
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(
    <QueryClientProvider client={client}>
      <ProfileScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (gameApi.getProfile as jest.Mock).mockResolvedValue(profile);
  (achievementsApi.list as jest.Mock).mockResolvedValue([]);
  (gearApi.list as jest.Mock).mockResolvedValue([]);
});

describe('ProfileScreen', () => {
  it('renders level, hp/xp bars, gold and the four stats', async () => {
    await renderScreen();
    expect(await screen.findByText('Lv 5')).toBeTruthy();
    expect(screen.getByText('40 / 50')).toBeTruthy(); // HP bar
    expect(screen.getByText('120 / 200')).toBeTruthy(); // XP bar
    expect(screen.getByText('250g')).toBeTruthy(); // gold
    expect(screen.getByText('Strength')).toBeTruthy();
    expect(screen.getByText('Constitution')).toBeTruthy();
    expect(screen.getByText('2 points unspent')).toBeTruthy();
  });

  it('+ posts {str: 1} to characterApi.allocate', async () => {
    (characterApi.allocate as jest.Mock).mockResolvedValue(profile);
    await renderScreen();
    await screen.findByText('Strength');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add Strength point'));
    });
    expect(characterApi.allocate).toHaveBeenCalledTimes(1);
    expect(characterApi.allocate).toHaveBeenCalledWith({ str: 1 });
  });

  it('shows the class picker once the choice opens (level >= 10)', async () => {
    (gameApi.getProfile as jest.Mock).mockResolvedValue({
      ...profile,
      level: 10,
      unspent_stat_points: 0,
    });
    await renderScreen();
    expect(await screen.findByText('Warrior')).toBeTruthy();
    (characterApi.selectClass as jest.Mock).mockResolvedValue({
      ...profile,
      level: 10,
      game_class: 'mage',
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Pick Mage class'));
    });
    expect(characterApi.selectClass).toHaveBeenCalledWith('mage');
  });
});
