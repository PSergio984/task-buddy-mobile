/**
 * Timeline screen test — a mocked day renders its session block (phases
 * inline), point markers with the score summary, and the day's diary.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { timelineApi } from '@/api/game';
import type { TimelineDayResponse } from '@/api/types';
import TimelineScreen from '@/app/game/timeline';

jest.mock('@/api/auth', () => ({
  useAuth: () => ({ token: 'tok', hydrated: true }),
}));

jest.mock('@/api/game', () => ({
  timelineApi: { day: jest.fn() },
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

const day: TimelineDayResponse = {
  date: '2025-11-02',
  sessions: [
    {
      id: 7,
      mode: 'timer',
      status: 'ended',
      task_id: null,
      activity_label: 'Deep work',
      started_at: '2025-11-02T09:00:00Z',
      ended_at: '2025-11-02T10:30:00Z',
      duration_seconds: 5400,
      phases: [
        {
          seq: 0,
          kind: 'focus',
          status: 'completed',
          planned_seconds: 3000,
          actual_seconds: 3120,
          started_at: '2025-11-02T09:00:00Z',
          ended_at: '2025-11-02T09:52:00Z',
        },
        {
          seq: 1,
          kind: 'break',
          status: 'completed',
          planned_seconds: 600,
          actual_seconds: 600,
          started_at: '2025-11-02T09:52:00Z',
          ended_at: '2025-11-02T10:02:00Z',
        },
      ],
    },
  ],
  markers: [
    {
      id: 9,
      type: 'habit_click',
      ts: '2025-11-02T14:22:00Z',
      outcome: { scored: true, xp: 5, gold: 2 },
    },
  ],
  diary: [
    {
      id: 3,
      kind: 'freeform',
      entry_date: '2025-11-02',
      good: null,
      bad: null,
      next: null,
      freeform: 'Shipped the fix',
      created_at: '2025-11-02T18:00:00Z',
      updated_at: '2025-11-02T18:00:00Z',
    },
  ],
  server_time: '2025-11-02T20:00:00Z',
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <TimelineScreen />
    </QueryClientProvider>,
  );
}

// Cold jest caches lazily load RN internals on the first render — that
// cost lands inside the running test's 5s budget, so warm it here.
beforeAll(async () => {
  (timelineApi.day as jest.Mock).mockResolvedValue(day);
  (await renderScreen()).unmount();
}, 30000);

beforeEach(() => {
  jest.clearAllMocks();
  (timelineApi.day as jest.Mock).mockResolvedValue(day);
});

describe('TimelineScreen', () => {
  it('renders the session block, marker, and diary entry for the day', async () => {
    await renderScreen();
    // The default day is today (UTC) — the mocked endpoint is asked for it.
    expect(timelineApi.day).toHaveBeenCalledWith(new Date().toISOString().slice(0, 10));

    expect(await screen.findByText('Deep work')).toBeTruthy();
    expect(screen.getByText('ended')).toBeTruthy();
    expect(screen.getByText(/09:00–10:30 UTC · 1h 30m/)).toBeTruthy();
    expect(screen.getByText('Focus')).toBeTruthy();
    expect(screen.getByText('completed · 52m / 50m')).toBeTruthy();

    expect(screen.getByText('Habit click')).toBeTruthy();
    expect(screen.getByText('+5 XP · +2g')).toBeTruthy();
    expect(screen.getByText('14:22')).toBeTruthy();

    expect(screen.getByText('Shipped the fix')).toBeTruthy();
  });
});
