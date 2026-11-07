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
  // Same lazy require as createEventQueue — the native module throws at
  // import time under jest.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require('@react-native-async-storage/async-storage')
    .default as KeyValueStorage;
  await AsyncStorage.removeItem(DEFAULT_KEY);
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
  /** Memoized first-read: concurrent hydrate()/enqueue()/flush() callers
   *  join the same in-flight load instead of racing ahead on an empty
   *  queue and clobbering events that were still being restored. */
  private hydrating: Promise<void> | null = null;
  private flushing: Promise<FlushResult> | null = null;

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
    this.hydrating ??= this.doHydrate();
    return this.hydrating;
  }

  private async doHydrate(): Promise<void> {
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.events = parsed.filter(
            (e): e is QueuedEvent =>
              !!e && typeof e.client_event_id === 'string' && typeof e.type === 'string',
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
    return this.deadLetters;
  }

  private deadKey(): string {
    return `${this.storageKey}.dead-letters`;
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(this.storageKey, JSON.stringify(this.events));
  }

  private async persistDeadLetters(): Promise<void> {
    await this.storage.setItem(this.deadKey(), String(this.deadLetters));
  }

  /** Queue one event for the next flush. Id assigned via expo-crypto UUID. */
  async enqueue(type: string, payload: Record<string, unknown>): Promise<QueuedEvent> {
    // A transient storage fault gets one immediate retry — evidence must not
    // die on a momentary read failure (a durable failure still rejects and is
    // counted by the caller's drop counter, not swallowed silently).
    await this.hydrate().catch(() => this.hydrate());
    const event: QueuedEvent = {
      client_event_id: `mobile:${this.createId()}`,
      type,
      client_ts: new Date(this.now()).toISOString(),
      payload,
    };
    this.events.push(event);
    await this.persist();
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
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<FlushResult> {
    await this.hydrate();
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

/** Default app queue — AsyncStorage-backed, posts through gameApi. */
export function createEventQueue(): EventQueue {
  // Lazy require: the native AsyncStorage module throws at import time under
  // jest, and the pure EventQueue must stay loadable for tests/injection.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require('@react-native-async-storage/async-storage')
    .default as KeyValueStorage;
  return new EventQueue({ storage: AsyncStorage, post: (events) => gameApi.postEvents(events) });
}
