import { Stack } from 'expo-router';

import { Colors } from '@/constants/colors';

/** Game-parity screens (#71) — pushed over the Game tab hub. */
export default function GameLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        contentStyle: { backgroundColor: Colors.background },
      }}
    />
  );
}
