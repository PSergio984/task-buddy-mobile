/**
 * Offline FIFO for game-ledger events (phone-down spans/violations and any
 * other client-claimable event). Persisted to AsyncStorage so spans recorded
 * during a dead-zone — or a killed app — still reach POST /api/v1/game/events.
 *
 * Pure logic lives in `EventQueue` with an injectable storage adapter, poster
 * and clock so tests never touch the native bridge; `createEventQueue` wires
 * the real AsyncStorage + apiFetch defaults.
 */
import * as Crypto from 'expo-crypto';

import { gameApi } from '@/api/game';
import { ApiError } from '@/api/client';
import type { GameEventIn, GameSyncResponse } from '@/api/types';

/** Minimal storage surface — matches AsyncStorage, trivial to fake in tests. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface QueuedEvent extends GameEventIn {
  /** Internal queue bookkeeping — failed-flush counter for the dead-letter
   *  escape: a deterministic (4xx) batch counts attempts until
   *  MAX_FLUSH_ATTEMPTS, then the chunk is dropped so it can't wedge the FIFO. */
  attempts?: number;
}

export interface FlushResult {
  sent: number;
  pending: number;
  /** Events dead-lettered this flush after MAX_FLUSH_ATTEMPTS 4xx rejects. */
  dropped: number;
  /** True when the batch POST failed after retries (events stay queued). */
  failed: boolean;
  lastError?: string;
}

export interface EventQueueOptions {
  storage: KeyValueStorage;
  storageKey?: string;
  post: (events: GameEventIn[]) => Promise<GameSyncResponse>;
  createId?: () => string;
  now?: () => number;
  /** POST attempts per flush() call — first try plus bounded backoff retries. */
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_KEY = 'task-buddy.game-event-queue';

/** Drop the persisted queue — called on logout so the NEXT login on this
 *  device can't flush the previous account's unposted evidence under its
 *  own identity (the server attributes ledger rows to the bearer token). */
export async function purgeEventQueueStorage(): Promise<void> {
  // The shared instance's in-memory copy survives a disk-only purge —
  // mounted screens still hold the reference, so abandon it outright.
  shared?.abandon();
  shared = null;
  // Same lazy require as createEventQueue — the native module throws at
  // import time under jest.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require('@react-native-async-storage/async-storage')
    .default as KeyValueStorage;
  await AsyncStorage.removeItem(DEFAULT_KEY);
  // The dead-letter ledger is account-scoped too — a fresh login must not
  // inherit the previous account's dropped-count banner.
  await AsyncStorage.removeItem(`${DEFAULT_KEY}.dead-letters`);
}
/** Server caps GameEventBatch.events at 500 — chunk at the same bound. */
const BATCH_SIZE = 500;
/** Flush cycles a deterministically-rejected batch survives before the
 *  chunk is dead-lettered — a schema-class reject can't wedge the FIFO. */
const MAX_FLUSH_ATTEMPTS = 5;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 4xx is a deterministic reject (validation) — except statuses that say
 *  nothing about the payload: 401/403 (expired or unconfirmed auth — the
 *  events may post fine after a re-login) and 408/429 (timeout / rate
 *  limit), which deserve the same backoff as 5xx/network. */
function isDeterministicReject(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 401 &&
    e.status !== 403 &&
    e.status !== 408 &&
    e.status !== 429
  );
}

export class EventQueue {
  private readonly storage: KeyValueStorage;
  private readonly storageKey: string;
  private readonly post: EventQueueOptions['post'];
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private events: QueuedEvent[] = [];
  private deadLetters = 0;
  /** Set by purgeEventQueueStorage — mounted screens holding a stale
   *  reference can neither flush nor re-persist the old account's queue.
   *  Calls on an abandoned instance forward to the current shared queue
   *  (when one exists) so a screen that outlives logout keeps working. */
  private abandoned = false;
  /** Memoized first-read: concurrent hydrate()/enqueue()/flush() callers
   *  join the same in-flight load instead of racing ahead on an empty
   *  queue and clobbering events that were still being restored. */
  private hydrating: Promise<void> | null = null;
  private flushing: Promise<FlushResult> | null = null;
  /** Listeners fired after the pending set changes — screens derive
   *  queued badges from these, and a flush they didn't start (the root
   *  foreground flush, another screen's retry) would otherwise leave
   *  them stale. The arg is how many events the flush delivered. */
  private listeners = new Set<(sent: number) => void>();

  /** The queue a stale reference should talk to — this instance unless it
   *  was abandoned and a post-login shared queue replaced it. */
  private delegate(): EventQueue {
    return this.abandoned && shared !== null ? shared : this;
  }

  /** Subscribe to pending-set changes; returns the unsubscribe. A stale
   *  reference forwards to the live queue so a remounted screen still
   *  hears post-login flushes. */
  subscribe(listener: (sent: number) => void): () => void {
    const q = this.delegate();
    if (q !== this) return q.subscribe(listener);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(sent: number): void {
    for (const listener of this.listeners) listener(sent);
  }

  constructor(options: EventQueueOptions) {
    this.storage = options.storage;
    this.storageKey = options.storageKey ?? DEFAULT_KEY;
    this.post = options.post;
    this.createId = options.createId ?? (() => Crypto.randomUUID());
    this.now = options.now ?? Date.now;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Restore persisted events. Idempotent — safe to call on every launch.
   *  A corrupt blob resolves to empty and never re-reads (deterministic);
   *  a transient read fault rejects and retries on the next call. */
  hydrate(): Promise<void> {
    const q = this.delegate();
    if (q !== this) return q.hydrate();
    this.hydrating ??= this.doHydrate();
    return this.hydrating;
  }

  private async doHydrate(): Promise<void> {
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Validate every wire field — a parseable row missing client_ts
          // or payload posts a guaranteed 422 and dead-letters itself and
          // (batched behind it) every well-formed event after it.
          this.events = parsed.filter(
            (e): e is QueuedEvent =>
              !!e &&
              typeof e.client_event_id === 'string' &&
              typeof e.type === 'string' &&
              typeof e.client_ts === 'string' &&
              !!e.payload &&
              typeof e.payload === 'object',
          );
        }
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        this.events = []; // corrupt blob — deterministic, never re-read
      } else {
        // Transient storage fault: let the next call retry rather than
        // risk a later persist clobbering a still-good stored blob.
        this.hydrating = null;
        throw e;
      }
    }
    try {
      const dead = await this.storage.getItem(this.deadKey());
      this.deadLetters = dead ? parseInt(dead, 10) || 0 : 0;
    } catch {
      // Informational only — a failed dead-letter read never touches the queue.
    }
  }

  /** Events dropped after MAX_FLUSH_ATTEMPTS deterministic rejects —
   *  persisted so a poisoned batch is an honest loss, not a silent one. */
  deadLetterCount(): number {
    const q = this.delegate();
    return q !== this ? q.deadLetterCount() : this.deadLetters;
  }

  private deadKey(): string {
    return `${this.storageKey}.dead-letters`;
  }

  private async persist(): Promise<void> {
    // An abandoned instance must never write — an in-flight flush can
    // resolve after the purge and would persist [] over the new account's
    // freshly-enqueued events.
    if (this.abandoned) return;
    await this.storage.setItem(this.storageKey, JSON.stringify(this.events));
  }

  private async persistDeadLetters(): Promise<void> {
    if (this.abandoned) return;
    await this.storage.setItem(this.deadKey(), String(this.deadLetters));
  }

  /** Drop the in-memory copy and bar further use — a mounted screen's
   *  stale reference must not flush or re-persist after logout. */
  abandon(): void {
    this.abandoned = true;
    this.events = [];
  }

  /** Pending events, post-hydrate — screens derive queued badges from these. */
  pending(): readonly QueuedEvent[] {
    const q = this.delegate();
    return q !== this ? q.pending() : this.events;
  }

  /** Queue one event for the next flush. Id assigned via expo-crypto UUID
   *  unless the caller supplies one — a REST-fallback event reuses the id
   *  its lost request already sent so the server dedupe key survives. */
  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    clientEventId?: string,
  ): Promise<QueuedEvent> {
    const q = this.delegate();
    if (q !== this) return q.enqueue(type, payload, clientEventId);
    // A transient storage fault gets one immediate retry — evidence must not
    // die on a momentary read failure (a durable failure still rejects and is
    // counted by the caller's drop counter, not swallowed silently).
    await this.hydrate().catch(() => this.hydrate());
    if (this.abandoned) throw new Error('event queue abandoned');
    const event: QueuedEvent = {
      client_event_id: clientEventId ?? `mobile:${this.createId()}`,
      type,
      client_ts: new Date(this.now()).toISOString(),
      payload,
    };
    this.events.push(event);
    try {
      await this.persist();
    } catch (e) {
      // Reported-as-lost evidence must not silently deliver on the next
      // flush — roll the in-memory copy back before rethrowing.
      this.events = this.events.filter((x) => x !== event);
      throw e;
    }
    this.notify(0);
    return event;
  }

  /**
   * Send everything pending, oldest first, in ≤500-event batches.
   * A batch is removed only on a 2xx — the server's per-event results
   * (applied|duplicate) are both success since dedupe is idempotent.
   * A deterministic 4xx stops the flush without retries: the batch is
   * transactional, so one poisoned event can't be isolated — each failed
   * flush bumps the batch's `attempts`, and past MAX_FLUSH_ATTEMPTS the
   * chunk is dead-lettered (counted, not silent) so the tail unblocks.
   * 401/403/408 are NOT deterministic — auth expiry and timeouts say
   * nothing about the payload, so they retry like 0/429/5xx and never
   * burn the dead-letter budget.
   * Status 0 / 429 / 5xx retries with exponential backoff inside this call.
   * Re-entrant calls join the in-flight flush instead of double-sending.
   */
  flush(): Promise<FlushResult> {
    const q = this.delegate();
    if (q !== this) return q.flush();
    this.flushing ??= this.doFlush()
      .then((r) => {
        this.notify(r.sent);
        return r;
      })
      .catch((e) => {
        // A faulted flush can still have delivered earlier batches —
        // refresh badges before the error propagates.
        this.notify(0);
        throw e;
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private async doFlush(): Promise<FlushResult> {
    await this.hydrate();
    if (this.abandoned) {
      return { sent: 0, pending: 0, dropped: 0, failed: false };
    }
    const result: FlushResult = {
      sent: 0,
      pending: this.events.length,
      dropped: 0,
      failed: false,
    };

    while (this.events.length > 0) {
      const batch = this.events.slice(0, BATCH_SIZE);
      try {
        await this.postWithRetry(batch);
      } catch (e) {
        result.failed = true;
        result.lastError = e instanceof Error ? e.message : String(e);
        if (isDeterministicReject(e)) {
          for (const ev of batch) ev.attempts = (ev.attempts ?? 0) + 1;
          if (batch.every((ev) => (ev.attempts ?? 0) >= MAX_FLUSH_ATTEMPTS)) {
            // The whole chunk exhausted its tries — dead-letter it so a
            // schema-class poison can't freeze the FIFO forever.
            const sentIds = new Set(batch.map((ev) => ev.client_event_id));
            this.events = this.events.filter((ev) => !sentIds.has(ev.client_event_id));
            this.deadLetters += batch.length;
            result.dropped += batch.length;
            await this.persistDeadLetters();
            await this.persist();
            continue;
          }
          await this.persist(); // the bump must survive an app kill
        }
        break;
      }
      // 2xx — applied or deduped, either way the server owns them now.
      const sentIds = new Set(batch.map((e) => e.client_event_id));
      this.events = this.events.filter((e) => !sentIds.has(e.client_event_id));
      result.sent += batch.length;
      await this.persist();
    }

    result.pending = this.events.length;
    return result;
  }

  private async postWithRetry(batch: QueuedEvent[]): Promise<GameSyncResponse> {
    let lastError: unknown;
    // `attempts` is queue bookkeeping — strip it from the wire payload.
    const wire: GameEventIn[] = batch.map(({ attempts: _attempts, ...e }) => e);
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await this.post(wire);
      } catch (e) {
        lastError = e;
        // Deterministic rejects (4xx except auth/timeout/rate-limit) —
        // retrying delays failure.
        if (isDeterministicReject(e)) throw e;
        if (attempt + 1 < this.maxAttempts) {
          await this.sleep(this.baseDelayMs * 2 ** attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/** Default app queue — AsyncStorage-backed, posts through gameApi. One
 *  instance per app: separate queues over the same storage key race
 *  persist() writes and clobber each other's in-memory events. */
let shared: EventQueue | null = null;

export function createEventQueue(): EventQueue {
  if (!shared) {
    // Lazy require: the native AsyncStorage module throws at import time under
    // jest, and the pure EventQueue must stay loadable for tests/injection.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage')
      .default as KeyValueStorage;
    shared = new EventQueue({
      storage: AsyncStorage,
      post: (events) => gameApi.postEvents(events),
    });
  }
  return shared;
}
