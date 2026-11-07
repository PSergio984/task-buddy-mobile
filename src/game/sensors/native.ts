/**
 * Safe bridge to the local Expo modules under modules/. In Expo Go (or in
 * jest, where nothing is registered) `requireNativeModule` throws — we turn
 * that into null so providers degrade to isAvailable()===false instead of
 * crashing the screen.
 *
 * Providers re-declare the native surface locally and resolve it lazily
 * through this helper — there is deliberately no `requireNativeModule`
 * wrapper under modules/, so nothing can crash Expo Go at import time.
 */
import { requireNativeModule } from 'expo';

export function tryNativeModule<T>(name: string): T | null {
  try {
    return requireNativeModule<T>(name);
  } catch {
    return null;
  }
}
