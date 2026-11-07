/**
 * Android foreground-service coverage provider — `expo-focus-service`.
 *
 * The service is a specialUse FGS started while the app is foreground
 * (API 31+ forbids starting one from background). It holds a partial wake
 * lock and subscribes to the proximity sensor natively, buffering every
 * covered/uncovered transition with a timestamp. The buffer survives app
 * suspension — `drainTransitions()` replays the real face-down history
 * after a backgrounded interval, so `coversSuspension` is true.
 *
 * Transitions are pulled on a poll (foreground liveness) and once on
 * resume; mid-gap pickups become ordinary machine edges, so grace/violation
 * semantics stay identical to the live path.
 */
import type { NativeModule } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

import type { DrainResult, OrientationEdgeEvent, OrientationProvider } from './types';
import { tryNativeModule } from './native';

/** Raw native row — 'heartbeat' rows prove service liveness; they are not
 *  orientation edges and must be filtered out before edge replay. */
type NativeTransition = { near: boolean; ts: number; kind?: 'edge' | 'heartbeat' };

declare class ExpoFocusServiceModule extends NativeModule<Record<never, never>> {
  isAvailable(): Promise<boolean>;
  startService(): Promise<void>;
  stopService(): Promise<void>;
  /** Service-lifecycle truth — start/stop intents resolve asynchronously. */
  isRunning(): Promise<boolean>;
  /** Destructive read — buffered transitions oldest-first plus the count
   *  of rows the bounded buffer dropped since the previous drain. */
  drainTransitions(): Promise<{ transitions: NativeTransition[]; dropped: number }>;
}

/** Bounded poll — a start/stop intent that never reflects in `running`
 *  within this window means the intent was dropped or the service died
 *  coming up; either way JS must not assert the new state. */
const LIFECYCLE_ACK_MS = 3_000;
const LIFECYCLE_POLL_MS = 100;

export class FocusServiceProvider implements OrientationProvider {
  readonly name = 'focus-service';
  readonly coversSuspension = true;

  private running = false;
  /** start/stop are serialized — the provider instance is shared across
   *  arms, so a re-arm's start() must queue behind an in-flight stop():
   *  otherwise the stale stop's `running=false` lands after the fresh
   *  start, claiming stopped while the FGS keeps its wake lock (and the
   *  next teardown's stop() early-returns — the service leaks). */
  private ops: Promise<void> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.ops.then(fn);
    this.ops = p.then(
      () => {},
      () => {},
    );
    return p;
  }

  private module(): ExpoFocusServiceModule | null {
    return tryNativeModule<ExpoFocusServiceModule>('ExpoFocusService');
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await this.module()?.isAvailable()) === true;
    } catch {
      return false;
    }
  }

  /** Poll the native flag until it reflects `target` or the bound hits —
   *  start/stop are fire-and-forget intents whose effects land in
   *  onCreate/onDestroy, so `running` can only follow confirmation. */
  private async awaitLifecycle(mod: ExpoFocusServiceModule, target: boolean): Promise<boolean> {
    const deadline = Date.now() + LIFECYCLE_ACK_MS;
    while (Date.now() < deadline) {
      if ((await mod.isRunning()) === target) return true;
      await new Promise((resolve) => setTimeout(resolve, LIFECYCLE_POLL_MS));
    }
    return (await mod.isRunning()) === target;
  }

  async start(_onEdge: (e: OrientationEdgeEvent) => void): Promise<void> {
    return this.serialize(async () => {
      const mod = this.module();
      if (!mod) throw new Error('ExpoFocusService module unavailable');
      // Android 13+: without the runtime permission the FGS notification —
      // the wake-lock transparency the user is owed — is suppressed.
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      // A JS reload (or a torn-down session that never reached stopService)
      // leaves the FGS alive with a stale buffer — drain-and-discard it or
      // those rows replay into THIS arm as fabricated edges.
      await mod.drainTransitions();
      await mod.startService();
      // The intent resolves before onCreate runs — claiming coverage
      // before the native flag confirms it would lie about who is live.
      if (!(await this.awaitLifecycle(mod, true))) {
        throw new Error('Focus service did not confirm startup');
      }
      this.running = true;
    });
  }

  async stop(): Promise<void> {
    return this.serialize(async () => {
      if (!this.running) return;
      try {
        const mod = this.module();
        if (!mod) throw new Error('ExpoFocusService module unavailable');
        await mod.stopService();
        // Wait for onDestroy — the serialized chain means a re-arm's
        // start() queues behind this, and starting a still-alive service
        // must not inherit its stale buffered rows.
        await this.awaitLifecycle(mod, false);
      } finally {
        this.running = false;
      }
    });
  }

  /** Buffered covered/uncovered transitions, oldest first. The native side
   *  interleaves heartbeat rows (service liveness); `lastProofTs` carries
   *  the freshest row's ts so a suspended gap is covered only when the
   *  service provably survived it. */
  async drainTransitions(): Promise<DrainResult> {
    if (!this.running) return { transitions: [], lastProofTs: null };
    try {
      const res = await this.module()?.drainTransitions();
      const rows = res?.transitions ?? [];
      return {
        transitions: rows
          .filter((r) => r.kind !== 'heartbeat')
          .map((r) => ({ near: r.near, ts: r.ts })),
        lastProofTs: rows.length > 0 ? Math.max(...rows.map((r) => r.ts)) : null,
        dropped: res?.dropped ?? 0,
      };
    } catch {
      return { transitions: [], lastProofTs: null };
    }
  }
}
