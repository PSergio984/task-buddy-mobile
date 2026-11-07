/**
 * Focus screen smoke tests — setup renders, start wires the session +
 * phone-down arm, and stop calls the server verb then shows the end card.
 * gameApi/sessionsApi and the sensor layer are mocked behind interfaces.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { GameSession } from '@/api/types';

import { sessionsApi } from '@/api/game';
import FocusScreen from '@/app/(tabs)/focus';

/* --- mocks --- */

jest.mock('@/api/auth', () => ({
  useAuth: () => ({ token: 'tok', hydrated: true }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('tok'),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@/api/client', () => ({
  ...jest.requireActual('@/api/client'),
  tasksApi: { list: jest.fn().mockResolvedValue([]) },
}));

jest.mock('@/api/game', () => ({
  sessionsApi: {
    start: jest.fn(),
    getActive: jest.fn().mockResolvedValue(null),
    pause: jest.fn(),
    resume: jest.fn(),
    advance: jest.fn(),
    stop: jest.fn(),
  },
  gameApi: {
    postEvents: jest.fn(),
    getEvents: jest.fn().mockResolvedValue({ events: [], server_time: 'x' }),
  },
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn().mockResolvedValue(undefined),
}));

const mockStop = jest.fn().mockResolvedValue({
  sessionId: 7,
  spans: [],
  violations: [],
  syncFailed: false,
  evidenceDropped: 0,
});

const mockPdInstances: { arm: jest.Mock; disarm: jest.Mock; state: string }[] = [];

jest.mock('@/game/phone-down-session', () => ({
  // The screen's reported-spans notice filters on MIN_SPAN_MS — keep the
  // real constant or the notice paths are silently dead under the mock.
  MIN_SPAN_MS: 2_000,
  PhoneDownSession: jest
    .fn()
    .mockImplementation((deps: { onStateChange?: (s: unknown) => void }) => {
      // Stateful: arm/disarm move `state` and fire onStateChange so the
      // screen's pdState wiring (arm/disarm effects) actually exercises.
      const inst = {
        state: 'idle',
        activeProviderNames: ['accelerometer'],
        liveCovering: true,
        graceRemainingMs: () => null,
        feedEdge: jest.fn(),
        arm: jest.fn(async () => {
          inst.state = 'running';
          deps.onStateChange?.(inst);
          return true;
        }),
        stop: mockStop,
        disarm: jest.fn(async () => {
          inst.state = 'idle';
          deps.onStateChange?.(inst);
          return { sessionId: 7, spans: [], violations: [], syncFailed: false, evidenceDropped: 0 };
        }),
      };
      mockPdInstances.push(inst as never);
      return inst;
    }),
}));

jest.mock('@/game/event-queue', () => ({
  createEventQueue: jest.fn(() => ({
    hydrate: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ sent: 0, pending: 0, failed: false }),
    enqueue: jest.fn().mockResolvedValue({}),
    deadLetterCount: () => 0,
  })),
}));

const liveSession: GameSession = {
  id: 7,
  mode: 'timer',
  status: 'active',
  task_id: null,
  activity_label: null,
  preset: null,
  pause_budget_count: 3,
  pause_budget_seconds: 300,
  started_at: new Date(1_700_000_000_000).toISOString(),
  ended_at: null,
  phases: [
    {
      seq: 0,
      kind: 'focus',
      status: 'active',
      planned_seconds: 1500,
      actual_seconds: null,
      pause_count: 0,
      paused_seconds: 0,
      pause_started_at: null,
      started_at: new Date(1_700_000_000_000).toISOString(),
      ended_at: null,
    },
    {
      seq: 1,
      kind: 'break',
      status: 'pending',
      planned_seconds: 300,
      actual_seconds: null,
      pause_count: 0,
      paused_seconds: 0,
      pause_started_at: null,
      started_at: null,
      ended_at: null,
    },
  ],
};

const endedSession: GameSession = {
  ...liveSession,
  status: 'ended',
  ended_at: new Date(1_700_000_500_000).toISOString(),
  phases: [{ ...liveSession.phases[0], status: 'completed' }, liveSession.phases[1]],
};

const pdSession: GameSession = {
  ...liveSession,
  phone_down: { enabled: true, spans: [], violations: 0 },
};

const pausedSession: GameSession = {
  ...pdSession,
  phases: [
    {
      ...pdSession.phases[0],
      status: 'paused',
      pause_started_at: new Date(1_700_000_100_000).toISOString(),
    },
    pdSession.phases[1],
  ],
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FocusScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPdInstances.length = 0;
});

describe('FocusScreen', () => {
  it('renders the setup view: modes, presets, phone-down toggle, start', async () => {
    await renderScreen();
    expect(screen.getByText('Timer')).toBeTruthy();
    expect(screen.getByText('Stopwatch')).toBeTruthy();
    expect(screen.getByText('Classic 25/5')).toBeTruthy();
    expect(screen.getByText('Phone-down')).toBeTruthy();
    expect(screen.getByText('Start focus')).toBeTruthy();
  });

  it('start posts a timer session with phases and phone_down off by default', async () => {
    (sessionsApi.start as jest.Mock).mockResolvedValue({
      session: liveSession,
      profile: null,
      server_time: 't',
    });
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Start focus'));
    });
    await waitFor(() => expect(sessionsApi.start).toHaveBeenCalledTimes(1));
    const body = (sessionsApi.start as jest.Mock).mock.calls[0][0];
    expect(body.mode).toBe('timer');
    expect(body.phone_down).toBe(false);
    expect(body.phases).toHaveLength(8); // classic = 4 focus + 4 breaks
    expect(body.phases[0]).toEqual({ kind: 'focus', minutes: 25 });
  });

  it('shows the running view after a successful start', async () => {
    (sessionsApi.start as jest.Mock).mockResolvedValue({
      session: liveSession,
      profile: null,
      server_time: 't',
    });
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Start focus'));
    });
    await waitFor(() => expect(screen.getByText('Focus · phase 1/1')).toBeTruthy());
    expect(screen.getByText(/Pause/)).toBeTruthy();
    expect(screen.getByText('Stop → abandon (−HP)')).toBeTruthy();
  });

  it('offline start surfaces an honest message instead of a fake session', async () => {
    const { ApiError } = jest.requireActual<typeof import('@/api/client')>('@/api/client');
    (sessionsApi.start as jest.Mock).mockRejectedValue(new ApiError(0, 'down'));
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Start focus'));
    });
    expect(await screen.findByText(/cannot reach the server|Offline/i)).toBeTruthy();
  });

  it('stop calls the server verb and shows the end card', async () => {
    (sessionsApi.start as jest.Mock).mockResolvedValue({
      session: liveSession,
      profile: null,
      server_time: 't',
    });
    (sessionsApi.stop as jest.Mock).mockResolvedValue({
      session: endedSession,
      profile: null,
      server_time: 't',
    });
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Start focus'));
    });
    await screen.findByText('Focus · phase 1/1');
    await act(async () => {
      fireEvent.press(screen.getByText('Stop → abandon (−HP)'));
    });
    await waitFor(() => expect(sessionsApi.stop).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Session complete')).toBeTruthy();
  });

  it('pause disarms the sensors and resume re-arms them', async () => {
    (sessionsApi.start as jest.Mock).mockResolvedValue({
      session: pdSession,
      profile: null,
      server_time: 't',
    });
    (sessionsApi.pause as jest.Mock).mockResolvedValue({
      session: pausedSession,
      profile: null,
      server_time: 't',
    });
    (sessionsApi.resume as jest.Mock).mockResolvedValue({
      session: pdSession,
      profile: null,
      server_time: 't',
    });
    await renderScreen();
    await act(async () => {
      fireEvent(screen.getByRole('switch', { name: /phone-down/i }), 'onValueChange', true);
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Start focus'));
    });
    const pd = mockPdInstances[mockPdInstances.length - 1];
    await waitFor(() => expect(pd.arm).toHaveBeenCalledTimes(1));
    expect(pd.state).toBe('running');

    await act(async () => {
      fireEvent.press(screen.getByText(/^Pause/));
    });
    await waitFor(() => expect(pd.disarm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pd.state).toBe('idle'));

    // Resume must re-arm — a freed machine refires the arm effect.
    await act(async () => {
      fireEvent.press(screen.getByText('Resume'));
    });
    await waitFor(() => expect(pd.arm).toHaveBeenCalledTimes(2));
    expect(pd.state).toBe('running');
  });
});
