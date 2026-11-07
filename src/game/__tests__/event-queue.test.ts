/**
 * EventQueue tests — persistence across reloads, enqueue/flush semantics,
 * dedupe removal, bounded exponential-backoff retry, 4xx fast-fail, batch
 * chunking and re-entrant flush joining. Storage/clock/sleep are injected.
 */
import { ApiError } from '@/api/client';
import type { GameSyncResponse } from '@/api/types';
import { EventQueue, type KeyValueStorage } from '../event-queue';

class MemoryStorage implements KeyValueStorage {
  map = new Map<string, string>();
  async getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  async removeItem(k: string) {
    this.map.delete(k);
  }
}

const okResponse: GameSyncResponse = {
  profile: {} as GameSyncResponse['profile'],
  results: [],
  applied: 0,
  duplicates: 0,
  server_time: '2026-01-01T00:00:00Z',
};

function makeQueue(overrides: Partial<ConstructorParameters<typeof EventQueue>[0]> = {}) {
  const storage = overrides.storage ?? new MemoryStorage();
  const post = (overrides.post ?? jest.fn().mockResolvedValue(okResponse)) as jest.Mock;
  const sleeps: number[] = [];
  let uuidCounter = 0;
  const queue = new EventQueue({
    storage,
    post,
    createId: () => `uuid-${++uuidCounter}`,
    now: () => 1_700_000_000_000,
    maxAttempts: 3,
    baseDelayMs: 100,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { queue, storage, post, sleeps };
}

/** Pending events as persisted — the storage blob is the queue's truth. */
const storedLen = (storage: KeyValueStorage) =>
  JSON.parse((storage as MemoryStorage).map.get('task-buddy.game-event-queue') ?? '[]').length;

describe('EventQueue', () => {
  it('enqueue assigns a namespaced client_event_id and client_ts', async () => {
    const { queue, storage } = makeQueue();
    const e = await queue.enqueue('phone_down_span', { session_id: 7 });
    expect(e.client_event_id).toBe('mobile:uuid-1');
    expect(e.client_ts).toBe(new Date(1_700_000_000_000).toISOString());
    expect(e.type).toBe('phone_down_span');
    expect(storedLen(storage)).toBe(1);
  });

  it('persists the queue so a fresh instance rehydrates it', async () => {
    const storage = new MemoryStorage();
    const { queue } = makeQueue({ storage });
    await queue.enqueue('phone_down_span', { session_id: 1 });
    await queue.enqueue('phone_down_violation', { session_id: 1 });

    const post = jest.fn().mockResolvedValue(okResponse);
    const q2 = new EventQueue({ storage, post, createId: () => 'x' });
    await q2.hydrate();
    expect(storedLen(storage)).toBe(2);
    await q2.flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toHaveLength(2);
    expect(storedLen(storage)).toBe(0);
  });

  it('an enqueue landing mid-hydrate joins the same load — nothing is lost', async () => {
    const storage = new MemoryStorage();
    storage.map.set(
      'task-buddy.game-event-queue',
      JSON.stringify([{ client_event_id: 'old', type: 'a', client_ts: 't', payload: {} }]),
    );
    let resolveRead!: (v: string | null) => void;
    const slowStorage: KeyValueStorage = {
      getItem: (k) =>
        k === 'task-buddy.game-event-queue'
          ? new Promise((r) => (resolveRead = r))
          : storage.getItem(k),
      setItem: (k, v) => storage.setItem(k, v),
      removeItem: (k) => storage.removeItem(k),
    };
    const { queue } = makeQueue({ storage: slowStorage });
    const h = queue.hydrate(); // first read still in flight
    const enq = queue.enqueue('b', {}); // must NOT race ahead on empty state
    resolveRead(storage.map.get('task-buddy.game-event-queue') ?? null);
    await Promise.all([h, enq]);
    // The stored row was restored AND the new event appended — both persist.
    const stored = JSON.parse(storage.map.get('task-buddy.game-event-queue')!);
    expect(stored.map((e: { client_event_id: string }) => e.client_event_id)).toEqual([
      'old',
      'mobile:uuid-1',
    ]);
  });

  it('flush sends FIFO order and removes delivered events', async () => {
    const { queue, post, storage } = makeQueue();
    await queue.enqueue('a', { n: 1 });
    await queue.enqueue('b', { n: 2 });
    const res = await queue.flush();
    expect(res).toMatchObject({ sent: 2, pending: 0, failed: false });
    expect(post.mock.calls[0][0].map((e: { type: string }) => e.type)).toEqual(['a', 'b']);
    expect(storedLen(storage)).toBe(0);
  });

  it('deduped events are still removed — the server owns them', async () => {
    const dupResponse = { ...okResponse, results: [], applied: 0, duplicates: 1 };
    const { queue, storage } = makeQueue({ post: jest.fn().mockResolvedValue(dupResponse) });
    await queue.enqueue('a', {});
    await queue.flush();
    expect(storedLen(storage)).toBe(0);
  });

  it('retries network failures with exponential backoff then succeeds', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'down'))
      .mockRejectedValueOnce(new ApiError(500, 'oops'))
      .mockResolvedValueOnce(okResponse);
    const { queue, sleeps, storage } = makeQueue({ post });
    await queue.enqueue('a', {});
    await queue.enqueue('b', {});
    const res = await queue.flush();
    expect(res.failed).toBe(false);
    expect(post).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]); // base * 2^attempt
    // Two events pin the "queued-behind events aren't posted twice"
    // guarantee: every attempt carried the same [a,b] chunk, and the
    // queue drained exactly once — no replay, no loss.
    for (const call of post.mock.calls) {
      expect(call[0].map((e: { type: string }) => e.type)).toEqual(['a', 'b']);
    }
    expect(storedLen(storage)).toBe(0);
  });

  it('gives up after maxAttempts and keeps events queued', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError(0, 'offline'));
    const { queue, storage } = makeQueue({ post });
    await queue.enqueue('a', {});
    const res = await queue.flush();
    expect(res.failed).toBe(true);
    expect(res.pending).toBe(1);
    expect(post).toHaveBeenCalledTimes(3);
    expect(storedLen(storage)).toBe(1);
  });

  it('4xx fails fast — no retries, events kept (poison stays for next launch)', async () => {
    const post = jest.fn().mockRejectedValue(new ApiError(422, 'bad batch'));
    const { queue, storage, sleeps } = makeQueue({ post });
    await queue.enqueue('a', {});
    const res = await queue.flush();
    expect(res.failed).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
    expect(storedLen(storage)).toBe(1);
  });

  it('429 is retryable — the rate limiter, not a deterministic reject', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(429, 'slow down'))
      .mockResolvedValueOnce(okResponse);
    const { queue, sleeps } = makeQueue({ post });
    await queue.enqueue('a', {});
    const res = await queue.flush();
    expect(res.failed).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([100]); // base * 2^0 — backed off, not fast-failed
  });

  it('dead-letters a deterministic 4xx after five flush cycles, then unblocks', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockResolvedValue(okResponse);
    const { queue, storage } = makeQueue({ post });
    await queue.enqueue('a', { n: 1 });
    await queue.enqueue('b', { n: 2 });
    for (let i = 0; i < 4; i++) {
      const r = await queue.flush();
      expect(r.failed).toBe(true);
      expect(r.dropped).toBe(0);
      expect(storedLen(storage)).toBe(2);
    }
    const fifth = await queue.flush();
    expect(post).toHaveBeenCalledTimes(5);
    expect(fifth.dropped).toBe(2);
    expect(storedLen(storage)).toBe(0);
    expect(queue.deadLetterCount()).toBe(2);
    // The counter persists — a relaunched queue still knows the loss.
    const relaunched = new EventQueue({ storage, post: jest.fn() });
    await relaunched.hydrate();
    expect(relaunched.deadLetterCount()).toBe(2);
  });

  it('chunks flushes into ≤500-event batches', async () => {
    const { queue, post, storage } = makeQueue();
    for (let i = 0; i < 501; i++) await queue.enqueue('e', { i });
    await queue.flush();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toHaveLength(500);
    expect(post.mock.calls[1][0]).toHaveLength(1);
    expect(storedLen(storage)).toBe(0);
  });

  it('a failed batch does not remove events or send later ones twice', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'nope'))
      .mockRejectedValueOnce(new ApiError(500, 'nope'))
      .mockRejectedValueOnce(new ApiError(500, 'nope'))
      .mockResolvedValue(okResponse);
    const { queue, storage } = makeQueue({ post });
    await queue.enqueue('a', { n: 1 });
    const first = await queue.flush();
    expect(first.failed).toBe(true);
    const second = await queue.flush();
    expect(second.failed).toBe(false);
    // 'a' sent exactly once across both flushes (4 total calls: 3 fails + 1 ok)
    const sentIds = post.mock.calls.flatMap((c) =>
      c[0].map((e: { client_event_id: string }) => e.client_event_id),
    );
    expect(sentIds).toEqual(['mobile:uuid-1', 'mobile:uuid-1', 'mobile:uuid-1', 'mobile:uuid-1']);
    expect(storedLen(storage)).toBe(0);
  });

  it('concurrent flush calls join the in-flight flush', async () => {
    let resolvePost!: (v: GameSyncResponse) => void;
    const post = jest
      .fn()
      .mockImplementation(() => new Promise<GameSyncResponse>((r) => (resolvePost = r)));
    const { queue } = makeQueue({ post });
    await queue.enqueue('a', {});
    const f1 = queue.flush();
    const f2 = queue.flush();
    // flush hydrates asynchronously before posting — wait for the call.
    while (post.mock.calls.length === 0) await new Promise(setImmediate);
    resolvePost(okResponse);
    const [r1, r2] = await Promise.all([f1, f2]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(r1.sent).toBe(1);
    expect(r2.sent).toBe(1);
  });

  it('auth rejections (401/403) are retried once — a fresh token may fix them', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'expired'))
      .mockResolvedValueOnce(okResponse);
    const { queue, sleeps } = makeQueue({ post });
    await queue.enqueue('a', {});
    const res = await queue.flush();
    expect(res.failed).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([100]); // one backoff, then delivered
  });

  it('posted events never carry local bookkeeping fields', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockRejectedValueOnce(new ApiError(422, 'bad'))
      .mockResolvedValueOnce(okResponse);
    const { queue } = makeQueue({ post });
    await queue.enqueue('a', { n: 1 });
    // Four deterministic rejects bump the bump counter — the wire must stay clean.
    for (let i = 0; i < 4; i++) await queue.flush();
    await queue.flush();
    for (const call of post.mock.calls) {
      for (const e of call[0]) {
        expect(Object.keys(e).sort()).toEqual(['client_event_id', 'client_ts', 'payload', 'type']);
      }
    }
  });

  it('a corrupt stored blob hydrates to an empty queue', async () => {
    const storage = new MemoryStorage();
    storage.map.set('task-buddy.game-event-queue', '{not json');
    const { queue } = makeQueue({ storage });
    await queue.hydrate();
    const res = await queue.flush();
    expect(res).toMatchObject({ sent: 0, pending: 0, failed: false });
  });

  it('drops malformed entries from a stored blob', async () => {
    const storage = new MemoryStorage();
    storage.map.set(
      'task-buddy.game-event-queue',
      JSON.stringify([
        { client_event_id: 'x', type: 'a', client_ts: 't', payload: {} },
        { nope: true },
        null,
      ]),
    );
    const post = jest.fn().mockResolvedValue(okResponse);
    const { queue } = makeQueue({ storage, post });
    await queue.hydrate();
    await queue.flush();
    expect(post.mock.calls[0][0]).toHaveLength(1);
  });
});
