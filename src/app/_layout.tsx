import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { hydrateAuth, useAuth } from '@/api/auth';
import { ApiError } from '@/api/client';
import { Colors } from '@/constants/colors';

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
      </Stack>
    </QueryClientProvider>
  );
}
