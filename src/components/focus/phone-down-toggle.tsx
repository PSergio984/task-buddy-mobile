/**
 * The phone-down toggle row — one implementation for the setup card and
 * the running view (previously duplicated in focus.tsx).
 */
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/colors';

interface PhoneDownToggleProps {
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  /** Explains WHY the switch is disabled — never a silent dead control. */
  hint?: string | null;
  onChange: (next: boolean) => void;
}

export function PhoneDownToggle({
  subtitle,
  value,
  disabled = false,
  hint = null,
  onChange,
}: PhoneDownToggleProps) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleTitle}>Phone-down</Text>
        <Text style={styles.toggleSub}>{subtitle}</Text>
        {hint !== null ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel="Phone-down"
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: Colors.accent, false: Colors.backgroundSelected }}
        thumbColor={Colors.text}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  toggleSub: { color: Colors.textMuted, fontSize: 12 },
  toggleHint: { color: Colors.textMuted, fontSize: 12, fontStyle: 'italic' },
});
