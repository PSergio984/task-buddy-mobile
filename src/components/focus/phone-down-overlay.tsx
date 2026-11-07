/**
 * The full-screen phone-down overlay — blocks the session view while the
 * machine is armed/in-grace/violated so the user puts the phone back down.
 * Escape hatches are explicit: turning phone-down off reports the earned
 * evidence and keeps the session; ending stops everything. Rendered only
 * while pd.state is not idle/running — a paused session disarms first, so
 * the overlay can never sit on top of the Resume button.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PhoneDownState } from '@/game/phone-down';
import { Colors, Spacing } from '@/constants/colors';

interface PhoneDownOverlayProps {
  /** 'armed' | 'grace' | 'violated' — the only states that render. */
  pdState: PhoneDownState;
  graceLeftMs: number | null;
  busy: boolean;
  onDisarm: () => void;
  onStop: () => void;
}

export function PhoneDownOverlay({
  pdState,
  graceLeftMs,
  busy,
  onDisarm,
  onStop,
}: PhoneDownOverlayProps) {
  return (
    <View style={styles.overlay}>
      <Text style={styles.overlayTitle}>
        {pdState === 'armed'
          ? 'Put your phone face-down'
          : pdState === 'grace'
            ? `Picked up — back down in ${Math.ceil((graceLeftMs ?? 0) / 1000)}s`
            : 'Violation recorded'}
      </Text>
      <Text style={styles.overlaySub}>
        {pdState === 'armed'
          ? 'The session is counting. Face-down time is what gets verified.'
          : pdState === 'grace'
            ? 'Stay down or the span is marked violated.'
            : 'Reduced XP for this span. Put it face-down to keep going.'}
      </Text>
      {/* Escape hatches — a dead sensor must not trap the session. */}
      <Pressable style={styles.overlayDisarm} disabled={busy} onPress={onDisarm}>
        <Text style={styles.overlayDisarmText}>Turn off phone-down</Text>
      </Pressable>
      <Pressable style={styles.overlayStop} disabled={busy} onPress={onStop}>
        {busy ? (
          <ActivityIndicator color={Colors.danger} />
        ) : (
          <Text style={styles.overlayStopText}>End session</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background + 'F5', // ~96% alpha scrim
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.three,
  },
  overlayTitle: { color: Colors.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  overlaySub: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center' },
  overlayDisarm: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  overlayDisarmText: { color: Colors.accent, fontSize: 14, fontWeight: '600' },
  overlayStop: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  overlayStopText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
});
