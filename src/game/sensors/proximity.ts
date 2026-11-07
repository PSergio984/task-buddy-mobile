/**
 * Proximity-sensor provider — backed by the local `expo-proximity` module.
 *
 * near → face-down (the sensor fires when anything covers the phone —
 * desk, pocket, hand; all equally unreadable). Unavailable in Expo Go
 * (module not linked) → isAvailable() false and the stack degrades.
 *
 * Foreground only on iOS (proximity monitoring dies on suspend); on
 * Android the wake-up sensor still fires in Doze but JS can't receive it —
 * suspension coverage comes from expo-focus-service instead.
 */
import type { EventSubscription, NativeModule } from 'expo-modules-core';

import type { OrientationEdgeEvent, OrientationProvider } from './types';
import { tryNativeModule } from './native';

type ProximityEventPayload = { near: boolean; ts?: number };

declare class ExpoProximityModule extends NativeModule<{
  onProximityChange: (payload: ProximityEventPayload) => void;
}> {
  isAvailable(): Promise<boolean>;
}

export class ProximityOrientationProvider implements OrientationProvider {
  readonly name = 'proximity';
  readonly coversSuspension = false;

  private subscription: EventSubscription | null = null;

  private module(): ExpoProximityModule | null {
    return tryNativeModule<ExpoProximityModule>('ExpoProximity');
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await this.module()?.isAvailable()) === true;
    } catch {
      return false;
    }
  }

  async start(onEdge: (e: OrientationEdgeEvent) => void): Promise<void> {
    const mod = this.module();
    if (!mod) throw new Error('ExpoProximity module unavailable');
    this.subscription = mod.addListener('onProximityChange', (payload) => {
      onEdge({
        edge: payload.near ? 'face_down' : 'picked_up',
        ts: payload.ts ?? Date.now(),
      });
    });
  }

  async stop(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
  }
}
