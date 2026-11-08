/**
 * Activity screen test — contribution grid cells render with a11y labels,
 * tapping one opens the day detail, and the stats chips + speedrun PBs
 * come from activityApi (mocked).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { activityApi } from '@/api/game';
import type { ActivityGrid, ActivityStats } from '@/api/types';
import ActivityScreen from '@/app/game/activity';

jest.mock('@/api/auth', () => ({
  useAuth: () => ({ token: 'tok', hydrated: true }),
}));

jest.mock('@/api/game', () => ({
  activityApi: { grid: jest.fn(), stats: jest.fn() },
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

const grid: ActivityGrid = {
  start: '2025-10-27',
  end: '2025-11-02',
  days: [
    { date: '2025-10-27', score: 0, focus_minutes: 0, events: {}, tier: 0 },
    {
      date: '2025-10-28',
      score: 42,
      focus_minutes: 65,
      events: { focus_phase_completed: 2, habit_click: 1 },
      tier: 2,
    },
    { date: '2025-10-29', score: 8, focus_minutes: 10, events: {}, tier: 1 },
    { date: '2025-10-30', score: 0, focus_minutes: 0, events: {}, tier: 0 },
    { date: '2025-10-31', score: 0, focus_minutes: 0, events: {}, tier: 0 },
    { date: '2025-11-01', score: 0, focus_minutes: 0, events: {}, tier: 0 },
    { date: '2025-11-02', score: 0, focus_minutes: 0, events: {}, tier: 0 },
  ],
  tier_thresholds: [10, 25, 50, 100],
  server_time: '2025-11-02T20:00:00Z',
};

const stats: ActivityStats = {
  start: '2025-10-01',
  end: '2025-11-02',
  avg_hours_per_day: 1.5,
  total_hours: 42,
  current_streak: 3,
  longest_streak: 9,
  best_day: { date: '2025-10-28', score: 88 },
  weekly_total: 123,
  speedrun_pbs: [
    {
      activity_label: 'Writing',
      best_seconds: 754,
      attempts: 4,
      set_at: '2025-10-30T10:00:00Z',
    },
  ],
  server_time: '2025-11-02T20:00:00Z',
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return await render(
    <QueryClientProvider client={client}>
      <ActivityScreen />
    </QueryClientProvider>,
  );
}

// Cold jest caches lazily load RN internals on the first render — that
// cost lands inside the running test's 5s budget, so warm it here.
beforeAll(async () => {
  (activityApi.grid as jest.Mock).mockResolvedValue(grid);
  (activityApi.stats as jest.Mock).mockResolvedValue(stats);
  (await renderScreen()).unmount();
}, 30000);

beforeEach(() => {
  jest.clearAllMocks();
  (activityApi.grid as jest.Mock).mockResolvedValue(grid);
  (activityApi.stats as jest.Mock).mockResolvedValue(stats);
});

describe('ActivityScreen', () => {
  it('renders grid cells and stats; tapping a cell shows its detail', async () => {
    await renderScreen();
    const cell = await screen.findByLabelText('Tue, Oct 28: 42 pts, 65m focus');
    expect(screen.getByLabelText('Mon, Oct 27: 0 pts, 0m focus')).toBeTruthy();

    expect(await screen.findByText('1.5h')).toBeTruthy();
    expect(screen.getByText('42.0h')).toBeTruthy();
    expect(screen.getByText('3d')).toBeTruthy();
    expect(screen.getByText('9d')).toBeTruthy();
    expect(screen.getByText('Tue, Oct 28 · 88')).toBeTruthy();
    expect(screen.getByText('123 pts')).toBeTruthy();

    // Speedrun PB row — best_seconds formatted m:ss, recent_attempts absent.
    expect(screen.getByText('Writing')).toBeTruthy();
    expect(screen.getByText('12:34')).toBeTruthy();
    expect(screen.getByText(/4 attempts/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(cell);
    });
    expect(await screen.findByText('Tue, Oct 28 — 42 pts')).toBeTruthy();
    expect(screen.getByText('65m focus')).toBeTruthy();
    expect(screen.getByText('focus phase completed ×2')).toBeTruthy();
    expect(screen.getByText('habit click ×1')).toBeTruthy();
  });
});
