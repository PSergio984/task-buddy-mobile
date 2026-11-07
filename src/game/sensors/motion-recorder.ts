/**
 * iOS retro-verification provider — `expo-motion-recorder`.
 *
 * CMSensorRecorder.recordAccelerometer keeps sampling while the app is
 * suspended (iPhone 7+, ≤12h). On return to foreground we query the
 * recorded gravity-z for the gap and classify it: the phone stayed flat
 * face-down (z ≈ +1g throughout — iOS proper-acceleration convention),
 * moved, or produced no usable data → 'unknown' → unverified.
 *
 * Android stub: the module registers there but isAvailable() → false.
 */
import type { NativeModule } from 'expo-modules-core';

import type { GapVerdict } from '@/game/phone-down';
import type { RetroProvider } from './types';
import { tryNativeModule } from './native';

/** Gravity-z summary the native module returns for a query window.
 *  firstTs/lastTs bound WHICH samples answered — a sparse query result
 *  can't stand in for coverage of the whole gap. */
export interface AccelerometerWindowStats {
  count: number;
  minZ: number;
  maxZ: number;
  meanZ: number;
  /** Epoch ms of the first/last returned sample — coverage bounds. */
  firstTs: number;
  lastTs: number;
}

declare class ExpoMotionRecorderModule extends NativeModule<Record<never, never>> {
  isAvailable(): Promise<boolean>;
  /** Start recording for up to `durationSeconds` (max 43200 = 12h). */
  startRecording(durationSeconds: number): Promise<void>;
  stopRecording(): Promise<void>;
  /** Sampled gravity-z stats over [fromTs, toTs] epoch ms; null if no data. */
  queryAccelerometer(fromTs: number, toTs: number): Promise<AccelerometerWindowStats | null>;
}

export interface RetroThresholds {
  /** Minimum samples needed to call a gap provable at all. */
  minSamples: number;
  /** iOS face-down window on gravity z (proper acceleration, +1g down). */
  flatMin: number;
  flatMax: number;
  /** Each gap edge may be uncovered by at most this long before the
   *  verdict stops being proof of the whole interval (recorder start/stop
   *  latency, CMSensorRecorder delivery lag). */
  edgeSlopMs: number;
}

const DEFAULT_THRESHOLDS: RetroThresholds = {
  minSamples: 3,
  flatMin: 0.8,
  flatMax: 1.45,
  edgeSlopMs: 60_000,
};

/** Classify recorded gravity-z stats — exported for tests. The samples
 *  must bracket the gap: a recorder hole at either end fabricates
 *  'stayed_flat' for time nobody measured. */
export function classifyGapStats(
  stats: AccelerometerWindowStats | null,
  fromTs: number,
  toTs: number,
  thresholds: RetroThresholds = DEFAULT_THRESHOLDS,
): GapVerdict {
  if (!stats || stats.count < thresholds.minSamples) return 'unknown';
  if (
    stats.firstTs > fromTs + thresholds.edgeSlopMs ||
    stats.lastTs < toTs - thresholds.edgeSlopMs
  ) {
    return 'unknown';
  }
  // Face-down throughout: z pinned to the +1g window the whole interval.
  if (stats.minZ > thresholds.flatMin && stats.maxZ < thresholds.flatMax) return 'stayed_flat';
  return 'moved';
}

export class MotionRecorderProvider implements RetroProvider {
  readonly name = 'motion-recorder';
  private readonly thresholds: RetroThresholds;
  /** Cap a session's recording window at the 12h CMSensorRecorder limit. */
  private readonly recordSeconds = 43200;

  constructor(thresholds: RetroThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  private module(): ExpoMotionRecorderModule | null {
    return tryNativeModule<ExpoMotionRecorderModule>('ExpoMotionRecorder');
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await this.module()?.isAvailable()) === true;
    } catch {
      return false;
    }
  }

  async startRecording(): Promise<void> {
    try {
      await this.module()?.startRecording(this.recordSeconds);
    } catch {
      // Permission denied or unsupported — gaps will resolve 'unknown'.
    }
  }

  async stopRecording(): Promise<void> {
    try {
      await this.module()?.stopRecording();
    } catch {
      // Nothing to unwind — recording expiry is device-side.
    }
  }

  async verifyGap(fromTs: number, toTs: number): Promise<GapVerdict> {
    try {
      const stats = (await this.module()?.queryAccelerometer(fromTs, toTs)) ?? null;
      return classifyGapStats(stats, fromTs, toTs, this.thresholds);
    } catch {
      return 'unknown';
    }
  }
}
