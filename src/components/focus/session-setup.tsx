/**
 * Session setup — mode, preset/custom durations, cycles, difficulty,
 * auto-start, task linking and the phone-down toggle. Stateless: the
 * route owns `FocusSetupSettings` and patches it through `onChange`.
 * Field set mirrors the web FocusSettings (speedrun is web-only).
 */
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { SessionDifficulty, SessionMode } from '@/api/types';
import { PhoneDownToggle } from './phone-down-toggle';
import { FOCUS_PRESETS, type FocusPresetId } from '@/game/session-view';
import { Colors, Spacing } from '@/constants/colors';

export type PresetChoice = FocusPresetId | 'custom';

export interface FocusSetupSettings {
  mode: SessionMode;
  presetId: PresetChoice;
  /** Custom durations as raw text — parsed + clamped at start time. */
  customFocus: string;
  customBreak: string;
  customLong: string;
  cycles: string;
  difficulty: SessionDifficulty;
  taskId: number | null;
  autoBreaks: boolean;
  autoFocus: boolean;
  phoneDown: boolean;
}

export const DEFAULT_SETUP_SETTINGS: FocusSetupSettings = {
  mode: 'timer',
  presetId: 'classic',
  customFocus: '25',
  customBreak: '5',
  customLong: '15',
  cycles: '4',
  difficulty: 'easy',
  taskId: null,
  autoBreaks: true,
  autoFocus: false,
  phoneDown: false,
};

const MODES: { id: SessionMode; label: string }[] = [
  { id: 'timer', label: 'Timer' },
  { id: 'stopwatch', label: 'Stopwatch' },
];

const DIFFICULTIES: { id: SessionDifficulty; label: string }[] = [
  { id: 'trivial', label: 'Trivial 0.1×' },
  { id: 'easy', label: 'Easy 1×' },
  { id: 'medium', label: 'Medium 1.5×' },
  { id: 'hard', label: 'Hard 2×' },
];

const digits = (t: string) => t.replace(/\D/g, '');

interface SessionSetupProps {
  settings: FocusSetupSettings;
  onChange: (patch: Partial<FocusSetupSettings>) => void;
  onPhoneDown: (next: boolean) => void;
  onStart: () => void;
  busy: boolean;
  /** Incomplete tasks for the optional link picker (id + title). */
  tasks: { id: number; title: string }[];
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <View style={styles.numberField}>
      <Text style={styles.numberLabel}>{label}</Text>
      <TextInput
        style={styles.numberInput}
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChange(digits(t))}
        keyboardType="number-pad"
        placeholderTextColor={Colors.textMuted}
      />
    </View>
  );
}

export function SessionSetup({
  settings,
  onChange,
  onPhoneDown,
  onStart,
  busy,
  tasks,
}: SessionSetupProps) {
  const timer = settings.mode === 'timer';
  return (
    <View style={styles.setup}>
      <Text style={styles.sectionTitle}>Mode</Text>
      <View style={styles.chipRow}>
        {MODES.map((m) => (
          <Pressable
            key={m.id}
            style={[styles.chip, settings.mode === m.id && styles.chipSelected]}
            onPress={() =>
              // Phone-down is timer-only — clear it so a stale toggle
              // can't arm a stopwatch session.
              onChange({ mode: m.id, ...(m.id === 'stopwatch' ? { phoneDown: false } : {}) })
            }
          >
            <Text style={[styles.chipText, settings.mode === m.id && styles.chipTextSelected]}>
              {m.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {timer ? (
        <>
          <Text style={styles.sectionTitle}>Preset</Text>
          <View style={styles.chipRow}>
            {(Object.keys(FOCUS_PRESETS) as FocusPresetId[]).map((id) => {
              const p = FOCUS_PRESETS[id];
              return (
                <Pressable
                  key={id}
                  style={[styles.chip, settings.presetId === id && styles.chipSelected]}
                  onPress={() => onChange({ presetId: id })}
                >
                  <Text
                    style={[styles.chipText, settings.presetId === id && styles.chipTextSelected]}
                  >
                    {p.label} {p.focus}/{p.short}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.chip, settings.presetId === 'custom' && styles.chipSelected]}
              onPress={() => onChange({ presetId: 'custom' })}
            >
              <Text
                style={[styles.chipText, settings.presetId === 'custom' && styles.chipTextSelected]}
              >
                Custom
              </Text>
            </Pressable>
          </View>

          {settings.presetId === 'custom' ? (
            <View style={styles.numberRow}>
              <NumberInput
                label="Focus min"
                value={settings.customFocus}
                onChange={(t) => onChange({ customFocus: t })}
              />
              <NumberInput
                label="Break min"
                value={settings.customBreak}
                onChange={(t) => onChange({ customBreak: t })}
              />
              <NumberInput
                label="Long break min"
                value={settings.customLong}
                onChange={(t) => onChange({ customLong: t })}
              />
            </View>
          ) : null}

          <View style={styles.numberRow}>
            <NumberInput
              label="Cycles (1–8)"
              value={settings.cycles}
              onChange={(t) => onChange({ cycles: t })}
            />
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Difficulty</Text>
      <View style={styles.chipRow}>
        {DIFFICULTIES.map((d) => (
          <Pressable
            key={d.id}
            style={[styles.chip, settings.difficulty === d.id && styles.chipSelected]}
            onPress={() => onChange({ difficulty: d.id })}
          >
            <Text
              style={[styles.chipText, settings.difficulty === d.id && styles.chipTextSelected]}
            >
              {d.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {timer ? (
        <>
          <View style={styles.autoRow}>
            <Text style={styles.autoLabel}>Auto-start breaks</Text>
            <Switch
              accessibilityLabel="Auto-start breaks"
              value={settings.autoBreaks}
              onValueChange={(v) => onChange({ autoBreaks: v })}
              trackColor={{ true: Colors.accent, false: Colors.backgroundSelected }}
              thumbColor={Colors.text}
            />
          </View>
          <View style={styles.autoRow}>
            <Text style={styles.autoLabel}>Auto-start next focus</Text>
            <Switch
              accessibilityLabel="Auto-start next focus"
              value={settings.autoFocus}
              onValueChange={(v) => onChange({ autoFocus: v })}
              trackColor={{ true: Colors.accent, false: Colors.backgroundSelected }}
              thumbColor={Colors.text}
            />
          </View>
        </>
      ) : null}

      {tasks.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Link task (optional)</Text>
          <View style={styles.chipRow}>
            <Pressable
              style={[styles.chip, settings.taskId === null && styles.chipSelected]}
              onPress={() => onChange({ taskId: null })}
            >
              <Text style={[styles.chipText, settings.taskId === null && styles.chipTextSelected]}>
                None
              </Text>
            </Pressable>
            {tasks.map((t) => (
              <Pressable
                key={t.id}
                style={[styles.chip, settings.taskId === t.id && styles.chipSelected]}
                onPress={() => onChange({ taskId: t.id })}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.chipText,
                    styles.taskChipText,
                    settings.taskId === t.id && styles.chipTextSelected,
                  ]}
                >
                  {t.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {timer ? (
        <PhoneDownToggle
          subtitle="Face-down time is verified and reported with the session."
          value={settings.phoneDown}
          onChange={onPhoneDown}
        />
      ) : null}

      <Pressable
        style={[styles.primaryButton, busy && styles.disabled]}
        disabled={busy}
        onPress={onStart}
      >
        {busy ? (
          <ActivityIndicator color={Colors.background} />
        ) : (
          <Text style={styles.primaryButtonText}>Start focus</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  setup: { gap: Spacing.four },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: 6,
  },
  chipSelected: { borderColor: Colors.accent, backgroundColor: Colors.backgroundSelected },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: Colors.accent },
  taskChipText: { maxWidth: 160 },
  numberRow: { flexDirection: 'row', gap: Spacing.two },
  numberField: { flex: 1, gap: 2 },
  numberLabel: { color: Colors.textMuted, fontSize: 12 },
  numberInput: {
    backgroundColor: Colors.backgroundElement,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  autoLabel: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    minHeight: 48,
  },
  primaryButtonText: { color: Colors.background, fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
