/**
 * Accelerometer orientation provider — the Expo-Go-capable path.
 *
 * expo-sensors `Accelerometer` reports proper acceleration in g. Face-down
 * is |z|≈1g on the platform-dependent side (Android reads ≈ −1g, iOS ≈ +1g).
 * On arm we collect a ~800ms baseline and let the classifier calibrate the
 * sign from it; ~10Hz sampling with a 750ms dwell rejects jostle transients.
 *
 * Foreground only: the listener stops delivering once the app suspends, so
 * `coversSuspension` is false — suspended intervals become proof gaps that
 * need the retro provider or degrade to unverified.
 */
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors';
import type { EventSubscription } from 'expo-modules-core';

import { FaceDownClassifier, type OrientationEdge } from '@/game/phone-down';
import type { OrientationEdgeEvent, OrientationProvider } from './types';

const SAMPLE_INTERVAL_MS = 100; // 10Hz — enough for a 750ms dwell
const CALIBRATION_WINDOW_MS = 800;

export class AccelerometerOrientationProvider implements OrientationProvider {
  readonly name = 'accelerometer';
  readonly coversSuspension = false;

  private subscription: EventSubscription | null = null;
  private readonly classifier: FaceDownClassifier;
  private baseline: number[] = [];
  private startedAt = 0;
  private calibrating = true;
  /** Receipt ts of the last sample — a dead stream's silence bound. */
  private lastSample: number | null = null;

  constructor(classifier?: FaceDownClassifier) {
    this.classifier = classifier ?? new FaceDownClassifier();
  }

  get lastSampleAt(): number | null {
    return this.lastSample;
  }

  /** Tri-state: undefined while calibrating, before any sample, or mid-
   *  dwell toward down — none of those can claim a measured direction.
   *  `false` = a fresh sample read upright and no flip is in flight. */
  get stillFlat(): boolean | undefined {
    if (this.calibrating || this.lastSample === null || this.classifier.pendingDown) {
      return undefined;
    }
    return this.classifier.isDown;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await Accelerometer.isAvailableAsync();
    } catch {
      return false; // Expo Go without the module, emulator without sensors
    }
  }

  async start(onEdge: (e: OrientationEdgeEvent) => void): Promise<void> {
    this.baseline = [];
    this.calibrating = true;
    this.startedAt = Date.now();
    this.lastSample = null;
    // The classifier instance survives across arms — a phone still down
    // from the previous arm keeps `emitted`, emits no face_down edge,
    // and the new session would wedge in 'armed' with zero evidence.
    this.classifier.reset();
    Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
    this.subscription = Accelerometer.addListener((m: AccelerometerMeasurement) => {
      const now = Date.now();
      this.lastSample = now;
      if (this.calibrating) {
        if (now - this.startedAt < CALIBRATION_WINDOW_MS) {
          this.baseline.push(m.z);
          return; // no edges during the calibration window
        }
        // The result is diagnostic-only today — 'already_down' flags the
        // ambiguous arm case in telemetry but nothing consumes it yet.
        this.classifier.calibrate(this.baseline);
        this.calibrating = false;
        // fall through — this sample classifies against the new sign
      }
      const edge: OrientationEdge | null = this.classifier.sample(m.z, now);
      if (edge) onEdge({ edge, ts: now });
    });
  }

  async stop(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    this.lastSample = null;
    // shortcut: setUpdateInterval is process-global with no read-back API,
    // so the 100ms rate can't be restored — any later listener would start
    // at 10Hz instead of a platform default; nothing else samples it.
  }
}
