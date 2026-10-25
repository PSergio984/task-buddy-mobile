import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/client';
import { login, register, resendConfirmation } from '@/api/auth';
import { Colors, Spacing } from '@/constants/colors';

export default function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  const isRegister = mode === 'register';
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    (!isRegister || username.trim().length >= 3) &&
    !submitting;

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      if (isRegister) {
        await register(username, email, password);
        // Backend requires a confirmed email before any endpoint works —
        // don't log in; send the user to the confirm-email state.
        setStage('confirm');
      } else {
        await login(email, password);
      }
      // Login navigation is handled by the auth gate in _layout.tsx.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : isRegister
            ? 'Could not create the account.'
            : 'Invalid email or password.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    setResendMsg(null);
    setSubmitting(true);
    try {
      await resendConfirmation(email);
      setResendMsg('Confirmation email requeued.');
    } catch {
      setResendMsg('Could not resend — try again shortly.');
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === 'confirm') {
    return (
      <View style={[styles.flex, styles.scroll]}>
        <View style={styles.card}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a confirmation link to {email.trim().toLowerCase()}. Confirm it, then sign in.
          </Text>
          {resendMsg ? <Text style={styles.subtitle}>{resendMsg}</Text> : null}
          <Pressable
            style={[styles.button, submitting && styles.buttonDisabled]}
            disabled={submitting}
            onPress={onResend}>
            {submitting ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <Text style={styles.buttonText}>Resend confirmation</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setStage('form');
              setMode('login');
              setError(null);
            }}
            hitSlop={8}>
            <Text style={styles.switchText}>Back to sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Task Buddy</Text>
          <Text style={styles.subtitle}>
            {isRegister ? 'Create your account' : 'Sign in to continue'}
          </Text>

          {isRegister ? (
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
            />
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (8+ characters)"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            textContentType={isRegister ? 'newPassword' : 'password'}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            disabled={!canSubmit}
            onPress={onSubmit}>
            {submitting ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <Text style={styles.buttonText}>{isRegister ? 'Create account' : 'Sign in'}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setMode(isRegister ? 'login' : 'register');
              setError(null);
            }}
            hitSlop={8}>
            <Text style={styles.switchText}>
              {isRegister ? 'Already have an account? Sign in' : "No account? Create one"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.five,
  },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 16,
    padding: Spacing.five,
    gap: Spacing.four,
  },
  title: {
    color: Colors.accent,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  input: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  error: { color: Colors.danger, fontSize: 14 },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Colors.background, fontSize: 16, fontWeight: '700' },
  switchText: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
