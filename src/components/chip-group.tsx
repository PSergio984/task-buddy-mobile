/** Shared option-chip row for the habit/daily editors — one Pressable per
 *  option with `selected` state; previously copied verbatim per editor. */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/colors';

export function ChipGroup<T extends string | number>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === o.value }}
          style={[styles.chip, selected === o.value && styles.chipSelected]}
          onPress={() => onSelect(o.value)}
        >
          <Text style={[styles.chipText, selected === o.value && styles.chipTextSelected]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.backgroundSelected },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: Colors.accent },
});
