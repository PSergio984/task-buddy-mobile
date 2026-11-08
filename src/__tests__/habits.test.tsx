/**
 * Habits screen smoke + behavior tests — the list renders from a mocked
 * API, a ± tap hits the REST fast-path online, and a status-0 network
 * failure falls back to the offline event queue (`habit_click`).
 * habitsApi and the event queue are mocked behind interfaces.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Habit } from '@/api/types';

import { habitsApi } from '@/api/game';
import HabitsScreen from '@/app/game/habits';

/* --- mocks --- */

jest.mock('@/api/auth', () => ({
  useAuth: () => ({ token: 'tok', hydrated: true }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('tok'),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// ApiError must stay the real class — the screen branches on `instanceof
// ApiError && status === 0` for the queue fallback.
jest.mock('@/api/client', () => ({
  ...jest.requireActual('@/api/client'),
}));

jest.mock('@/api/game', () => ({
  habitsApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    click: jest.fn(),
  },
}));

// Stack.Screen needs a navigator context the bare render doesn't provide.
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

// Deterministic client_event_id for click assertions.
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-test'),
}));

// Native SymbolView isn't loadable under jest — the rows' labels are the
// accessibility contract, not the glyphs.
jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

const mockEnqueue = jest.fn().mockResolvedValue({});
const mockFlush = jest.fn().mockResolvedValue({ sent: 0, pending: 1, failed: false, dropped: 0 });

jest.mock('@/game/event-queue', () => ({
  createEventQueue: jest.fn(() => ({
    hydrate: jest.fn().mockResolvedValue(undefined),
    flush: mockFlush,
    enqueue: mockEnqueue,
    deadLetterCount: () => 0,
  })),
}));

const habit: Habit = {
  id: 1,
  title: 'Read pages',
  notes: null,
  direction: 'both',
  difficulty: 'easy',
  value: 2.5,
  counter: 3,
  bind_focus: true,
  reminder_times: ['08:00'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const negHabit: Habit = {
  ...habit,
  id: 2,
  title: 'Ate junk',
  direction: 'negative',
  bind_focus: false,
  reminder_times: [],
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <HabitsScreen />
    </QueryClientProvider>,
  );
}

// A cold jest-expo cache pays the first FlatList mount's lazy RN module
// cost inside the running test — warm it here so the 5s per-test budget
// measures the screen, not module loading.
beforeAll(async () => {
  (habitsApi.list as jest.Mock).mockResolvedValue([habit]);
  (await renderScreen()).unmount();
}, 30000);

beforeEach(() => {
  jest.clearAllMocks();
  (habitsApi.list as jest.Mock).mockResolvedValue([habit]);
  mockFlush.mockResolvedValue({ sent: 0, pending: 1, failed: false, dropped: 0 });
});

describe('HabitsScreen', () => {
  it('renders the list state from the API: title, drift badge, counter', async () => {
    await renderScreen();
    expect(await screen.findByText('Read pages')).toBeTruthy();
    // value 2.5 ≥ 1 → 'farmed' drift; counter +3 signed.
    expect(screen.getByText('farmed')).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('auto')).toBeTruthy();
  });

  it('gates the ± buttons on direction — a negative-only habit has no +', async () => {
    (habitsApi.list as jest.Mock).mockResolvedValue([negHabit]);
    await renderScreen();
    expect(await screen.findByText('Ate junk')).toBeTruthy();
    expect(screen.getByLabelText('−click Ate junk')).toBeTruthy();
    expect(screen.queryByLabelText('+click Ate junk')).toBeNull();
  });

  it('click hits the REST fast-path with a fresh client_event_id', async () => {
    (habitsApi.click as jest.Mock).mockResolvedValue({
      habit,
      profile: {},
      status: 'applied',
      server_time: 't',
    });
    await renderScreen();
    await screen.findByText('Read pages');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('+click Read pages'));
    });
    await waitFor(() => expect(habitsApi.click).toHaveBeenCalledWith(1, 'positive', 'uuid-test'));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('a status-0 failure enqueues habit_click for offline sync', async () => {
    const { ApiError } = jest.requireActual<typeof import('@/api/client')>('@/api/client');
    (habitsApi.click as jest.Mock).mockRejectedValue(new ApiError(0, 'down'));
    await renderScreen();
    await screen.findByText('Read pages');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('+click Read pages'));
    });
    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith('habit_click', {
        habit_id: 1,
        direction: 'positive',
      }),
    );
    expect(mockFlush).toHaveBeenCalled();
  });

  it('a deterministic error surfaces instead of queueing', async () => {
    const { ApiError } = jest.requireActual<typeof import('@/api/client')>('@/api/client');
    (habitsApi.click as jest.Mock).mockRejectedValue(new ApiError(422, 'bad direction'));
    await renderScreen();
    await screen.findByText('Read pages');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('+click Read pages'));
    });
    expect(await screen.findByText('bad direction')).toBeTruthy();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
