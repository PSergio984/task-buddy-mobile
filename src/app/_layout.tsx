import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { hydrateAuth, useAuth } from '@/api/auth';
import { ApiError } from '@/api/client';
import { Colors } from '@/constants/colors';
import { createEventQueue } from '@/game/event-queue';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx (401/404/422) is deterministic — retrying just delays the error UI
      // and re-fires the unauthorized handler.
      retry: (n, e) => (e instanceof ApiError && e.status >= 400 && e.status < 500 ? false : n < 3),
    },
  },
});

export default function RootLayout() {
  const { token, hydrated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    hydrateAuth().finally(() => void SplashScreen.hideAsync());
  }, []);

  // Cached rows belong to the account that fetched them — a fresh login
  // must never render the previous user's data while it refetches.
  useEffect(() => {
    if (token === null && hydrated) queryClient.clear();
  }, [token, hydrated]);

  // Offline gestures (habit clicks, daily checks, phone-down evidence)
  // only flush when a consumer screen mounts — a reconnect while the app
  // sits on an unrelated screen would leave them parked. Foregrounding
  // is the natural delivery point; gated on token so a flush never posts
  // unauthenticated. Run once at install too — the token can arrive while
  // the app is already foregrounded (cold launch, fresh login).
  useEffect(() => {
    if (!token) return;
    const flush = () => {
      const queue = createEventQueue();
      void queue
        .hydrate()
        .then(() => queue.flush())
        .catch(() => {});
    };
    if (AppState.currentState === 'active') flush();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    return () => sub.remove();
  }, [token]);

  // Auth gate: no stored token → /login; token on /login → tasks.
  useEffect(() => {
    if (!hydrated) return;
    const onLogin = segments[0] === 'login';
    if (!token && !onLogin) {
      router.replace('/login');
    } else if (token && onLogin) {
      router.replace('/');
    }
  }, [hydrated, token, segments, router]);

  // Keep the splash screen up until the token is loaded.
  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
        <Stack.Screen name="import" options={{ title: 'Import notes' }} />
        <Stack.Screen name="game" options={{ headerShown: false }} />
      </Stack>
    </QueryClientProvider>
  );
}
