/**
 * Sensor-provider abstraction for phone-down verification. Every provider
 * answers `isAvailable()` honestly — Expo Go lacks the custom native
 * modules, so those providers report false and the stack degrades to
 * accelerometer-only. Tests inject fakes; nothing here is imported by the
 * pure state machine.
 */

import type { GapVerdict } from '@/game/phone-down';

export interface OrientationEdgeEvent {
  edge: 'face_down' | 'picked_up';
  /** Epoch ms — sensor/native timestamp when known, else receipt time. */
  ts: number;
}

/** Buffered native transition (e.g. Android FGS proximity, recorded while
 *  the app was suspended). `near` = covered → face-down edge. */
export interface BufferedTransition {
  near: boolean;
  ts: number;
}

/** One destructive read of a provider's native buffer. */
export interface DrainResult {
  /** Real covered/uncovered edges, oldest first — replayed into the machine. */
  transitions: BufferedTransition[];
  /**
   * Newest proof-of-life ts the native side could attest: the freshest
   * buffered row, including heartbeat rows and the drain-time liveness
   * stamp. `null` = nothing proved the provider was alive — a suspended
   * interval it claimed to cover must not be trusted.
   */
  lastProofTs: number | null;
  /**
   * Rows the native buffer dropped since the previous drain — a nonzero
   * count means the replayed history is a suffix with edges lost, so the
   * coverage story it tells is incomplete and can't promote anything.
   */
  dropped?: number;
}

export interface OrientationProvider {
  readonly name: string;
  /**
   * True when the provider keeps recording through app suspension
   * (Android FGS + wake-up proximity). When any started provider reports
   * true, a backgrounded interval isn't a proof gap.
   */
  readonly coversSuspension: boolean;
  /**
   * Receipt ts of the last sample for continuous emitters (accelerometer)
   * — silence bounds live coverage to a dead stream's final sample.
   * Event-driven providers (proximity, FGS) leave it undefined: their
   * silence is normal, not death.
   */
  readonly lastSampleAt?: number | null;
  /** Continuous emitters only: the freshest reading's measured direction
   *  — corroborates (or vetoes) an event-driven edge. `undefined` = not
   *  yet measured (calibrating/no samples); `false` = measured upright. */
  readonly stillFlat?: boolean;
  isAvailable(): Promise<boolean>;
  /** Begin streaming orientation edges. */
  start(onEdge: (e: OrientationEdgeEvent) => void): Promise<void>;
  stop(): Promise<void>;
  /**
   * Providers that buffer natively while suspended drain recorded
   * transitions here; replayed in order they reproduce the real history.
   */
  drainTransitions?(): Promise<DrainResult>;
}

/**
 * Retro-verification provider: records sensor data while the app is
 * suspended, so a backgrounded interval can be classified after the fact.
 */
export interface RetroProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  /** Classify the suspended interval [fromTs, toTs] epoch ms. */
  verifyGap(fromTs: number, toTs: number): Promise<GapVerdict>;
}
