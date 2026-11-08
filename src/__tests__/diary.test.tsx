/**
 * Diary screen test — mocked entries render with kind badges, and the
 * editor posts a create through diaryApi.create (mocked).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { diaryApi } from '@/api/game';
import type { DiaryListResponse } from '@/api/types';
import DiaryScreen from '@/app/game/diary';

jest.mock('@/api/auth', () => ({
  useAuth: () => ({ token: 'tok', hydrated: true }),
}));

jest.mock('@/api/game', () => ({
  diaryApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

const list: DiaryListResponse = {
  entries: [
    {
      id: 1,
      kind: 'standup',
      entry_date: '2025-10-30',
      good: 'Focus went well',
      bad: null,
      next: 'Keep going',
      freeform: null,
      created_at: '2025-10-30T08:00:00Z',
      updated_at: '2025-10-30T08:00:00Z',
    },
    {
      id: 2,
      kind: 'freeform',
      entry_date: '2025-10-29',
      good: null,
      bad: null,
      next: null,
      freeform: 'A note',
      created_at: '2025-10-29T18:00:00Z',
      updated_at: '2025-10-29T18:00:00Z',
    },
  ],
  has_more: false,
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <DiaryScreen />
    </QueryClientProvider>,
  );
}

// Cold jest caches lazily load RN internals on the first render — that
// cost lands inside the running test's 5s budget, so warm it here.
beforeAll(async () => {
  (diaryApi.list as jest.Mock).mockResolvedValue(list);
  (await renderScreen()).unmount();
}, 30000);

beforeEach(() => {
  jest.clearAllMocks();
  (diaryApi.list as jest.Mock).mockResolvedValue(list);
  (diaryApi.create as jest.Mock).mockResolvedValue(list.entries[1]);
});

describe('DiaryScreen', () => {
  it('renders the entries with kind badges', async () => {
    await renderScreen();
    expect(await screen.findByText('Focus went well')).toBeTruthy();
    expect(screen.getByText('A note')).toBeTruthy();
    // 'Stand-up' appears on the entry badge AND the kind picker.
    expect(screen.getAllByText('Stand-up').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Entry')).toBeTruthy();
    expect(screen.getByText('Keep going')).toBeTruthy();
  });

  it('posts a freeform create from the editor', async () => {
    await renderScreen();
    const input = await screen.findByLabelText('Entry text');
    await act(async () => {
      fireEvent.changeText(input, 'My new note');
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add entry'));
    });
    await waitFor(() =>
      expect(diaryApi.create).toHaveBeenCalledWith({
        kind: 'freeform',
        entry_date: new Date().toISOString().slice(0, 10),
        freeform: 'My new note',
      }),
    );
  });
});
