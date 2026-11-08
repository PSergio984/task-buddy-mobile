/**
 * Dailies screen smoke + behavior tests — the list renders from a mocked
 * API, a check hits the REST fast-path online with the right payload, and
 * a status-0 network failure falls back to the offline event queue
 * (`daily_check`). dailiesApi and the event queue are mocked behind
 * interfaces.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { Daily } from '@/api/types';

import { dailiesApi } from '@/api/game';
import DailiesScreen from '@/app/game/dailies';

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
  dailiesApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    check: jest.fn(),
  },
}));

// Stack.Screen needs a navigator context the bare render doesn't provide.
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

// Sequential client_event_ids — a constant would let a per-call mint
// produce divergent REST/queue ids without tripping an assertion.
let mockUuidN = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${++mockUuidN}`),
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
    pending: () => [],
    subscribe: () => () => {},
  })),
}));

const daily: Daily = {
  id: 5,
  title: 'Morning workout',
  notes: null,
  difficulty: 'medium',
  recurrence: { kind: 'daily' },
  streak: 4,
  active: true,
  reminder_times: [],
  items: [
    { id: 11, title: 'Warm up', position: 0, done_today: false },
    { id: 12, title: '30-min session', position: 1, done_today: true },
  ],
  completed_today: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return await render(
    <QueryClientProvider client={client}>
      <DailiesScreen />
    </QueryClientProvider>,
  );
}

// A cold jest-expo cache pays the first FlatList mount's lazy RN module
// cost inside the running test — warm it here so the 5s per-test budget
// measures the screen, not module loading.
beforeAll(async () => {
  (dailiesApi.list as jest.Mock).mockResolvedValue([daily]);
  (await renderScreen()).unmount();
}, 30000);

beforeEach(() => {
  jest.clearAllMocks();
  (dailiesApi.list as jest.Mock).mockResolvedValue([daily]);
  mockFlush.mockResolvedValue({ sent: 0, pending: 1, failed: false, dropped: 0 });
});

describe('DailiesScreen', () => {
  it('renders the list state from the API: title, streak, items, progress', async () => {
    await renderScreen();
    expect(await screen.findByText('Morning workout')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy(); // streak
    expect(screen.getByText('Warm up')).toBeTruthy();
    expect(screen.getByText('30-min session')).toBeTruthy();
    expect(screen.getByText('1/2 done')).toBeTruthy();
    expect(screen.getByText('Every day')).toBeTruthy();
  });

  it('a whole-daily check hits the REST fast-path', async () => {
    (dailiesApi.check as jest.Mock).mockResolvedValue({
      daily,
      profile: {},
      status: 'applied',
      server_time: 't',
    });
    await renderScreen();
    await screen.findByText('Morning workout');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Check Morning workout'));
    });
    await waitFor(() =>
      expect(dailiesApi.check).toHaveBeenCalledWith(
        5,
        { done: true },
        expect.stringMatching(/^mobile:/),
      ),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('an item check sends the daily_item_id payload', async () => {
    (dailiesApi.check as jest.Mock).mockResolvedValue({
      daily,
      profile: {},
      status: 'applied',
      server_time: 't',
    });
    await renderScreen();
    await screen.findByText('Warm up');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Check Warm up'));
    });
    await waitFor(() =>
      expect(dailiesApi.check).toHaveBeenCalledWith(
        5,
        { daily_item_id: 11, done: true },
        expect.stringMatching(/^mobile:/),
      ),
    );
  });

  it('a done item un-marks with done: false', async () => {
    (dailiesApi.check as jest.Mock).mockResolvedValue({
      daily,
      profile: {},
      status: 'applied',
      server_time: 't',
    });
    await renderScreen();
    await screen.findByText('30-min session');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Check 30-min session'));
    });
    await waitFor(() =>
      expect(dailiesApi.check).toHaveBeenCalledWith(
        5,
        { daily_item_id: 12, done: false },
        expect.stringMatching(/^mobile:/),
      ),
    );
  });

  it('a status-0 failure enqueues daily_check for offline sync', async () => {
    const { ApiError } = jest.requireActual<typeof import('@/api/client')>('@/api/client');
    (dailiesApi.check as jest.Mock).mockRejectedValue(new ApiError(0, 'down'));
    await renderScreen();
    await screen.findByText('Warm up');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Check Warm up'));
    });
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalled());
    // The dedupe contract: the queued replay must carry the SAME id the
    // lost REST attempt sent — a divergent id double-scores.
    const restEid = (dailiesApi.check as jest.Mock).mock.calls[0][2];
    expect(restEid).toMatch(/^mobile:/);
    expect(mockEnqueue).toHaveBeenCalledWith(
      'daily_check',
      { daily_id: 5, daily_item_id: 11, done: true },
      restEid,
    );
    expect(mockFlush).toHaveBeenCalled();
  });
});
