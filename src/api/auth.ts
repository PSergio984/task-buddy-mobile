/**
 * Auth for the mobile client: Bearer token stored in expo-secure-store,
 * plus a reactive `useAuth()` hook for the root layout's auth gate.
 */
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { apiFetch, setUnauthorizedHandler, TOKEN_STORAGE_KEY } from './client';
import type { RegisterResponse, TokenResponse } from './types';

/* --- Token storage helpers (SecureStore + in-memory cache) --- */

let cachedToken: string | null = null;
let hydrated = false;
// useSyncExternalStore requires a stable snapshot reference — mutate this
// object's contents only via refreshSnapshot().
let snapshot: { token: string | null; hydrated: boolean } = { token: null, hydrated: false };
const listeners = new Set<() => void>();

function refreshSnapshot() {
  snapshot = { token: cachedToken, hydrated };
}

function emit() {
  refreshSnapshot();
  for (const listener of listeners) listener();
}

export async function setToken(token: string): Promise<void> {
  cachedToken = token;
  await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, token);
  emit();
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
  emit();
}

/** Load the persisted token into memory. Call once at app start. */
export async function hydrateAuth(): Promise<void> {
  try {
    cachedToken = await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
  } finally {
    hydrated = true;
    emit();
  }
}

// Expired or blacklisted token → clear it so the auth gate bounces to /login.
setUnauthorizedHandler(() => {
  void clearToken();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Session state for routing decisions. `hydrated` is false until the
 * first SecureStore read resolves — gate navigation on it. */
export function useAuth(): { token: string | null; hydrated: boolean } {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/* --- Auth endpoints --- */

/** POST /api/v1/users/token — OAuth2 password form (username carries email). */
export async function login(email: string, password: string): Promise<void> {
  const res = await apiFetch<TokenResponse>('/api/v1/users/token', {
    method: 'POST',
    form: { username: email.trim().toLowerCase(), password },
    auth: false,
  });
  await setToken(res.access_token);
}

/** POST /api/v1/users/register — username + email + password.
 *  The returned token is NOT stored: the backend requires a confirmed email
 *  for every endpoint, so it would dead-end the session until then. */
export async function register(username: string, email: string, password: string): Promise<void> {
  await apiFetch<RegisterResponse>('/api/v1/users/register', {
    method: 'POST',
    json: { username: username.trim(), email: email.trim().toLowerCase(), password },
    auth: false,
  });
}

/** POST /api/v1/users/resend-confirmation — requeues the confirm email. */
export async function resendConfirmation(email: string): Promise<void> {
  await apiFetch('/api/v1/users/resend-confirmation', {
    method: 'POST',
    json: { email: email.trim().toLowerCase() },
    auth: false,
  });
}

/** Server-side logout blacklists the token; local state clears either way. */
export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/v1/users/logout', { method: 'POST' });
  } catch {
    // Best-effort server logout — offline must not strand the session.
  } finally {
    await clearToken();
  }
}
