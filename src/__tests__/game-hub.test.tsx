/**
 * Game hub smoke test — the menu lists all seven /game/* routes and the
 * slim header shows profile chips from getProfile (mocked).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { gameApi } from '@/api/game';
import type { GameProfile } from '@/api/types';
import GameScreen from '@/app/(tabs)/game';

jest.mock('@/api/auth', () => ({
  useAuth: () => ({ token: 'tok', hydrated: true }),
}));

jest.mock('@/api/game', () => ({
  gameApi: { getProfile: jest.fn() },
}));

jest.mock('expo-router', () => ({
  // asChild Links pass navigation to the child Pressable — rendering only
  // needs the children.
  Link: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

const profile: GameProfile = {
  level: 5,
  xp: 120,
  xp_to_next_level: 200,
  hp: 30,
  max_hp: 40,
  gold: 87.4,
  str_stat: 3,
  int_stat: 4,
  con_stat: 2,
  per_stat: 1,
  unspent_stat_points: 0,
  game_class: 'mage',
  class_unlocked: true,
  auto_allocate: false,
  avatar_config: {},
  xp_today: 40,
  gold_today: 12,
  retention: 'forever',
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <GameScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (gameApi.getProfile as jest.Mock).mockResolvedValue(profile);
});

describe('GameScreen', () => {
  it('renders all seven menu links and the profile chips', async () => {
    await renderScreen();
    for (const title of [
      'Habits',
      'Dailies',
      'Character',
      'Shop',
      'Activity',
      'Timeline',
      'Diary',
    ]) {
      expect(await screen.findByText(title)).toBeTruthy();
    }
    expect(await screen.findByText('Lv 5 · mage')).toBeTruthy();
    expect(screen.getByText('HP 30/40')).toBeTruthy();
    expect(screen.getByText('87g')).toBeTruthy();
    expect(screen.getByText('XP 120/200')).toBeTruthy();
  });
});
