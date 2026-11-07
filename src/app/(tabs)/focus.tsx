/**
 * Focus tab — timer (pomodoro presets) + stopwatch sessions against the
 * server-authoritative session engine, plus the mobile-only phone-down
 * overlay (#70).
 *
 * Start/pause/resume/advance/stop are REST calls and need connectivity —
 * an unreachable server gets an honest "offline" message instead of a
 * silently-local run. Phone-down evidence is the exception: spans and
 * violations queue locally and sync through POST /api/v1/game/events.
 *
 * Pause is PHASE-level: session.status stays 'active' while the live phase
 * reports 'paused', so the phone-down arm/disarm effects key on the derived
 * clock status (`view.status`), never on session.status alone.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as KeepAwake from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/api/auth';
import { ApiError, tasksApi } from '@/api/client';
import { sessionsApi } from '@/api/game';
import type { GameSession } from '@/api/types';
import { SpanRow, TierChip, ViolationRow } from '@/components/focus/evidence';
import { PhoneDownHistoryList } from '@/components/focus/history-list';
import { PhoneDownOverlay } from '@/components/focus/phone-down-overlay';
import { PhoneDownToggle } from '@/components/focus/phone-down-toggle';
import {
  DEFAULT_SETUP_SETTINGS,
  type FocusSetupSettings,
  SessionSetup,
} from '@/components/focus/session-setup';
import { usePhoneDownHistory } from '@/components/focus/use-phone-down-history';
import { Colors, Spacing } from '@/constants/colors';
import { createEventQueue } from '@/game/event-queue';
import type { PhoneDownState } from '@/game/phone-down';
import {
  mergeSummary,
  MIN_SPAN_MS,
  PhoneDownSession,
  type PhoneDownSummary,
} from '@/game/phone-down-session';
import {
  buildPhasePlan,
  deriveSessionView,
  FOCUS_PRESETS,
  formatClock,
  numOr,
} from '@/game/session-view';

const KEEP_AWAKE_TAG = 'phone-down-session';

export default function FocusScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  // Setup state — one settings object, patched like web FocusSettings.
  const [settings, setSettings] = useState<FocusSetupSettings>(DEFAULT_SETUP_SETTINGS);
  const patch = (p: Partial<FocusSetupSettings>) => setSettings((s) => ({ ...s, ...p }));
  const { mode, phoneDown } = settings;

  // Session state
  const [session, setSession] = useState<GameSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<PhoneDownSummary | null>(null);
  const [pendingStopId, setPendingStopId] = useState<number | null>(null);
  /** Session recovered via getActive — sensors weren't armed for it. */
  const [restored, setRestored] = useState(false);
  const [pdState, setPdState] = useState<PhoneDownState>('idle');
  const [pdProviders, setPdProviders] = useState<string[]>([]);
  // pd.liveCovering / graceRemainingMs read mutable clocks — with the
  // React Compiler enabled, render-time reads could memoize-freeze (a
  // dead stream would keep showing "verified"). Mirrored into state and
  // refreshed on transitions AND the 1s tick instead.
  const [pdCovering, setPdCovering] = useState(false);
  const [pdGraceLeft, setPdGraceLeft] = useState<number | null>(null);
  /** Evidence events dead-lettered server-side — surfaced, never silent. */
  const [deadLetters, setDeadLetters] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Non-reactive singletons — lazy useState init keeps them off refs so the
  // React Compiler never sees a ref read during render.
  const [queue] = useState(() => createEventQueue());
  const [pd] = useState(
    () =>
      new PhoneDownSession({
        queue,
        onStateChange: (s) => {
          setPdState(s.state);
          setPdProviders(s.activeProviderNames);
          setPdCovering(s.liveCovering);
          setPdGraceLeft(s.state === 'grace' ? s.graceRemainingMs() : null);
        },
      }),
  );

  const history = usePhoneDownHistory(!!token, token);

  // Incomplete tasks for the optional link picker (same cache as the Tasks tab).
  const { data: tasks } = useQuery({
    // Distinct key from the Tasks tab's unfiltered ['tasks'] list — a
    // shared key would let either fetch clobber the other's cache.
    queryKey: ['tasks', 'linkable'],
    queryFn: () => tasksApi.list({ completed: false, limit: 10 }),
    enabled: !!token,
  });
  const linkableTasks = useMemo(
    () => (tasks ?? []).slice(0, 10).map((t) => ({ id: t.id, title: t.title })),
    [tasks],
  );

  const view = useMemo(() => (session ? deriveSessionView(session, now) : null), [session, now]);
  /** Phase-level pause — the session row stays 'active' throughout. */
  const paused = view?.status === 'paused';

  /** Server-clock offset — every response carries server_time; anchoring
   *  `now` to it keeps the countdown honest when the device clock skews. */
  const clockOffsetRef = useRef(0);
  const alignClock = (serverTime?: string) => {
    const t = serverTime ? Date.parse(serverTime) : NaN;
    if (Number.isFinite(t)) clockOffsetRef.current = t - Date.now();
  };
  const serverNow = () => Date.now() + clockOffsetRef.current;

  // A timed phase at 0:00 doesn't self-advance — phase transitions are
  // server-lazy, so poll getActive once the local clock reaches expiry
  // (throttled; a dead server can't spin the loop).
  const expiredPollRef = useRef(0);
  const livePhase = session?.phases.find((p) => p.status === 'running' || p.status === 'paused');
  useEffect(() => {
    if (
      !session ||
      !view ||
      view.status !== 'running' ||
      view.clockSeconds !== 0 ||
      livePhase?.kind === 'stopwatch'
    ) {
      return;
    }
    if (Date.now() - expiredPollRef.current < 5_000) return;
    expiredPollRef.current = Date.now();
    sessionsApi
      .getActive()
      .then((res) => {
        alignClock(res?.server_time);
        if (res?.session) setSession(res.session);
      })
      .catch(() => {});
  }, [session, view, livePhase]);

  // Tick for the running clock — also refreshes the pd liveness mirrors
  // (a dead stream fires no transition, so only the tick can catch it).
  useEffect(() => {
    if (!session || session.status !== 'active') return;
    const id = setInterval(() => {
      setNow(serverNow());
      setPdCovering(pd.liveCovering);
      setPdGraceLeft(pd.state === 'grace' ? pd.graceRemainingMs() : null);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pd is a stable singleton
  }, [session]);

  /** Set the instant a session is started locally — a late getActive
   *  response must not overwrite it with the pre-start server state. */
  const localStartRef = useRef(false);

  // Restore any server-live session on mount (e.g. after an app restart).
  useEffect(() => {
    let cancelled = false;
    sessionsApi
      .getActive()
      .then((res) => {
        alignClock(res?.server_time);
        if (!cancelled && res?.session && !localStartRef.current) {
          setSession(res.session);
          setRestored(true);
        }
      })
      .catch(() => {});
    void queue
      .hydrate()
      .then(() => queue.flush())
      .then(() => setDeadLetters(queue.deadLetterCount()))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [queue]);

  // Unmount safety: providers + keep-awake must not outlive the screen.
  // mountedRef guards in-flight arm() resolutions — one resolving after
  // unmount must not re-activate keep-awake the cleanup just released.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void pd.disarm();
      void KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pd identity is stable
  }, []);

  const activateKeepAwake = () => {
    void KeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  };
  const releaseKeepAwake = () => {
    void KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  };
  const syncDeadLetters = () => setDeadLetters(queue.deadLetterCount());

  const apiErr = (e: unknown, fallback: string) =>
    e instanceof ApiError
      ? e.status === 0
        ? 'Offline — cannot reach the server.'
        : e.message
      : fallback;

  const applyAction = async (
    action: () => Promise<{ session: GameSession; server_time?: string } | null>,
    verb: string,
  ) => {
    setBusy(verb);
    setError(null);
    try {
      const res = await action();
      alignClock(res?.server_time);
      if (res?.session) setSession(res.session);
    } catch (e) {
      setError(apiErr(e, `Could not ${verb} the session.`));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    localStartRef.current = true;
    setSummary(null);
    setRestored(false);
    setNotice(null);
    const durations =
      settings.presetId === 'custom'
        ? {
            focus: numOr(settings.customFocus, 25),
            short: numOr(settings.customBreak, 5),
            long: numOr(settings.customLong, 15),
          }
        : FOCUS_PRESETS[settings.presetId];
    await applyAction(
      () =>
        sessionsApi.start({
          mode,
          ...(mode === 'timer'
            ? { phases: buildPhasePlan(durations, numOr(settings.cycles, 4)) }
            : {}),
          // Server 400s phone_down on stopwatch — flat XP has nothing to gate.
          phone_down: phoneDown && mode === 'timer',
          task_id: settings.taskId,
          difficulty: settings.difficulty,
          auto_start_breaks: settings.autoBreaks,
          auto_start_focus: settings.autoFocus,
        }),
      'start',
    );
  };

  // Arm sensors once a phone-down session exists server-side — timer mode
  // only, while the derived status is RUNNING: a phase-level pause disarms
  // (intent kept) and this effect re-arms on resume. Sessions started
  // without phone_down can never gain it (no server blob → evidence would
  // record unscored), so the blob's presence gates the arm path too.
  useEffect(() => {
    if (
      session?.status === 'active' &&
      session.mode === 'timer' &&
      session.phone_down != null &&
      phoneDown &&
      !restored &&
      !paused &&
      // Stop-in-flight must not re-arm sensors mid-teardown — a slow
      // drain/flush can otherwise leave coverage running past the end.
      busy !== 'stop' &&
      // A resume landing while disarm() still holds the machine gets arm()
      // =false — pdState in the deps refires this effect when it frees.
      pdState === 'idle'
    ) {
      void pd
        .arm(session.id)
        .then((armed) => {
          if (armed && mountedRef.current) {
            activateKeepAwake();
          } else if (mountedRef.current) {
            // arm() returned false — no provider could start. A silent
            // refusal makes the toggle look broken on retry.
            setNotice('Phone-down unavailable — no orientation sensor could start.');
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arm on session id, resume, intent, or freed machine
  }, [session?.id, session?.status, paused, phoneDown, pdState, busy]);

  // A session leaving the running state without the Stop button (advance
  // past the last phase, server auto-abandon, phase-level pause) must
  // release the machine: a pickup during an explicit pause must not log a
  // violation. Pause keeps the phoneDown intent so resume re-arms;
  // terminal statuses clear it so it can't leak into the next session.
  useEffect(() => {
    if (!session) return;
    const terminal = session.status !== 'active';
    if (!paused && !terminal) return;
    releaseKeepAwake(); // idempotent
    void pd
      .disarm()
      .then((sum) => {
        setSummary((prev) => mergeSummary(prev, sum));
        syncDeadLetters();
        if (terminal) {
          patch({ phoneDown: false });
          // Fresh evidence just flushed — keep the history feed honest.
          void queryClient.invalidateQueries({ queryKey: ['game-events'] });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on status transitions only
  }, [session?.status, paused]);

  const togglePhoneDown = async (next: boolean) => {
    // Re-entrant guards: a double-tap while arm/disarm is still draining
    // must not fire a second teardown — and the pre-patch early return
    // keeps the switch honest (it snaps back instead of lying 'on').
    if (busy !== null) return;
    patch({ phoneDown: next });
    if (!session || session.status !== 'active' || restored || session.mode !== 'timer') return;
    setBusy('phonedown');
    try {
      if (next) {
        // Paused: keep intent only — the arm effect re-arms on resume.
        // No blob: started without phone-down; it can't be enabled now.
        if (paused || session.phone_down == null) return;
        if ((await pd.arm(session.id).catch(() => false)) && mountedRef.current) {
          activateKeepAwake();
        } else if (mountedRef.current) {
          setNotice('Phone-down unavailable — no orientation sensor could start.');
        }
      } else {
        releaseKeepAwake();
        const sum = await pd.disarm().catch(() => null);
        setSummary((prev) => mergeSummary(prev, sum));
        syncDeadLetters();
        const reported = sum
          ? sum.spans.filter((s) => s.end_ts - s.start_ts >= MIN_SPAN_MS).length
          : 0;
        if (reported > 0) {
          setNotice(
            sum?.syncFailed
              ? `Phone-down off — ${reported} span(s) queued — will sync when back online.`
              : `Phone-down off — ${reported} span(s) reported.`,
          );
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!session) return;
    setBusy('stop');
    setError(null);
    try {
      if (pd.state !== 'idle') {
        const sum = await pd.stop();
        setSummary((prev) => mergeSummary(prev, sum));
        releaseKeepAwake();
        patch({ phoneDown: false });
        syncDeadLetters();
        if (sum.syncFailed) {
          const reported = sum.spans.filter((s) => s.end_ts - s.start_ts >= MIN_SPAN_MS).length;
          setNotice(`${reported} span(s) queued — will sync when back online.`);
        }
      }
      const res = await sessionsApi.stop(session.id);
      alignClock(res.server_time);
      setSession(res.session);
      setPendingStopId(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Session stays open server-side — retry on the next foreground.
        setPendingStopId(session.id);
        setError('Offline — the session will be ended when you reconnect.');
      } else {
        setError(apiErr(e, 'Could not stop the session.'));
      }
    } finally {
      setBusy(null);
    }
  };

  // Retry a pending stop on a 15 s interval — only transient (network)
  // failures stay pending; a deterministic reject means the server already
  // ended or refused the session, so retrying would loop forever.
  useEffect(() => {
    if (pendingStopId === null) return;
    const id = setInterval(() => {
      sessionsApi
        .stop(pendingStopId)
        .then((res) => {
          alignClock(res.server_time);
          setSession(res.session);
          setPendingStopId(null);
          setError(null);
        })
        .catch((e) => {
          // Only status-0 (network) retries — a deterministic reject OR an
          // unexpected non-ApiError clears pending instead of looping.
          if (!(e instanceof ApiError && e.status === 0)) {
            setPendingStopId(null);
            setError(apiErr(e, 'Could not stop the session.'));
          }
        });
      void queue
        .flush()
        .then(syncDeadLetters)
        .catch(() => {});
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queue is a stable singleton
  }, [pendingStopId]);

  const dismissResult = () => {
    setSession(null);
    setSummary(null);
    setRestored(false);
    setNotice(null);
  };

  /* --- render --- */

  const running = session !== null && view !== null;
  const ended = view?.status === 'ended' || view?.status === 'abandoned';
  const pdActive = pdState !== 'idle';
  // Paused ⇒ disarmed ⇒ idle — the paused guard keeps even a one-render
  // lag from parking the overlay on top of the Resume button. 'awaiting'
  // means no phase clock is running — the overlay's pause-the-clock
  // contract has nothing to gate, so it must not trap the Start button.
  const pdBlocking =
    pdActive && pdState !== 'running' && !ended && !paused && view?.status === 'running';
  const graceLeft = pdGraceLeft;
  const pdBlob = session?.phone_down;
  const streak =
    pdBlob?.streak_count !== undefined && pdBlob?.xp_multiplier !== undefined
      ? { count: pdBlob.streak_count, mult: pdBlob.xp_multiplier }
      : null;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {!running ? (
          /* ---------- setup ---------- */
          <>
            <SessionSetup
              settings={settings}
              onChange={patch}
              onPhoneDown={(v) => void togglePhoneDown(v)}
              onStart={() => void start()}
              busy={busy !== null}
              tasks={linkableTasks}
            />
            <PhoneDownHistoryList rows={history} deadLetters={deadLetters} />
          </>
        ) : (
          /* ---------- running / ended ---------- */
          <View style={styles.runningView}>
            {!ended ? (
              <>
                <Text style={styles.clock}>{formatClock(view.clockSeconds)}</Text>
                <Text style={styles.kindLabel}>{view.kindLabel}</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { flex: view.progress }]} />
                  <View style={{ flex: Math.max(0, 1 - view.progress) }} />
                </View>

                {view.graceEndsInSec !== null ? (
                  <Text style={styles.metaText}>
                    Auto-ends in {formatClock(view.graceEndsInSec)} if not started
                  </Text>
                ) : null}
                {restored ? (
                  <Text style={styles.metaText}>
                    Session started elsewhere — phone-down unavailable for it.
                  </Text>
                ) : null}

                {/* Phone-down toggle row — arm/disarm mid-session. Timer only:
                  the server rejects phone_down evidence on stopwatch, and a
                  session started without it has no blob to write. */}
                {!restored && session.mode === 'timer' ? (
                  <PhoneDownToggle
                    subtitle={
                      pdActive
                        ? 'Face-down time is being verified — lifting starts grace.'
                        : 'Verify focus by keeping the phone face-down.'
                    }
                    value={phoneDown}
                    disabled={session.phone_down == null}
                    hint={
                      session.phone_down == null
                        ? "Started without phone-down — it can't be enabled mid-session."
                        : null
                    }
                    onChange={(v) => void togglePhoneDown(v)}
                  />
                ) : null}

                {pdActive ? (
                  <View style={styles.pdRow}>
                    {/* Honest in-session chip: verified only while a provider is
                      actually covering; proven pickup → violated; else the
                      span can't be proven yet → unverified. */}
                    {pdState === 'violated' ? (
                      <TierChip tier="violated" />
                    ) : pdState === 'running' && pdCovering ? (
                      <TierChip tier="verified" />
                    ) : (
                      <TierChip tier="unverified" />
                    )}
                    <Text style={styles.metaText}>
                      {pdProviders.join(' + ') || 'no live sensor'}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.controls}>
                  {view.status === 'awaiting' ? (
                    <Pressable
                      style={[styles.primaryButton, busy !== null && styles.disabled]}
                      disabled={busy !== null}
                      onPress={() =>
                        void applyAction(() => sessionsApi.advance(session.id), 'advance')
                      }
                    >
                      <Text style={styles.primaryButtonText}>
                        Start {view.pending?.kind ?? 'phase'} · {formatClock(view.clockSeconds)}
                      </Text>
                    </Pressable>
                  ) : paused ? (
                    <Pressable
                      style={[styles.primaryButton, busy !== null && styles.disabled]}
                      disabled={busy !== null}
                      onPress={() =>
                        void applyAction(() => sessionsApi.resume(session.id), 'resume')
                      }
                    >
                      <Text style={styles.primaryButtonText}>Resume</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[
                        styles.primaryButton,
                        (busy !== null || view.pausesLeft === 0) && styles.disabled,
                      ]}
                      disabled={busy !== null || view.pausesLeft === 0}
                      onPress={() => void applyAction(() => sessionsApi.pause(session.id), 'pause')}
                    >
                      <Text style={styles.primaryButtonText}>
                        {view.pausesLeft === null ? 'Pause' : `Pause (${view.pausesLeft} left)`}
                      </Text>
                    </Pressable>
                  )}
                  {view.live?.kind === 'break' ? (
                    <Pressable
                      style={[styles.secondaryButton, busy !== null && styles.disabled]}
                      disabled={busy !== null}
                      onPress={() =>
                        void applyAction(() => sessionsApi.advance(session.id), 'advance')
                      }
                    >
                      <Text style={styles.secondaryButtonText}>Skip break</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.stopButton, busy !== null && styles.disabled]}
                    disabled={busy !== null}
                    onPress={() => void stop()}
                  >
                    {busy === 'stop' ? (
                      <ActivityIndicator color={Colors.danger} />
                    ) : (
                      <Text style={styles.stopButtonText}>
                        {view.focusDone === 0 && session.mode !== 'stopwatch'
                          ? 'Stop → abandon (−HP)'
                          : 'End session'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              /* ---------- end card ---------- */
              <View style={styles.endCard}>
                <Text style={styles.endTitle}>
                  {view.status === 'abandoned' ? 'Session abandoned' : 'Session complete'}
                </Text>
                <Text style={styles.endSub}>
                  {view.status === 'abandoned'
                    ? 'HP lost — start a new run to win it back.'
                    : 'Finished phases already scored — totals updated.'}
                </Text>
                {streak !== null ? (
                  <Text style={styles.metaText}>
                    Verified streak {streak.count} · XP ×{streak.mult.toFixed(2)}
                  </Text>
                ) : null}
                {summary && (summary.spans.length > 0 || summary.violations.length > 0) ? (
                  <View style={styles.spansCard}>
                    <Text style={styles.sectionTitle}>Phone-down evidence</Text>
                    {/* Sub-2s flicks are filtered at enqueue — show only the
                        spans that were actually reported. */}
                    {summary.spans
                      .filter((s) => s.end_ts - s.start_ts >= MIN_SPAN_MS)
                      .map((s, i) => (
                        <SpanRow key={`${s.start_ts}-${i}`} span={s} />
                      ))}
                    {summary.violations.map((v, i) => (
                      <ViolationRow key={`${v.at_ts}-${i}`} violation={v} />
                    ))}
                    {summary.evidenceDropped > 0 ? (
                      <Text style={styles.metaText}>
                        {summary.evidenceDropped} evidence write(s) failed before queueing.
                      </Text>
                    ) : null}
                    {summary.syncFailed ? (
                      <Text style={styles.metaText}>Queued — syncs when back online.</Text>
                    ) : null}
                  </View>
                ) : null}
                <Pressable style={styles.primaryButton} onPress={dismissResult}>
                  <Text style={styles.primaryButtonText}>Close</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ---------- phone-down overlay ---------- */}
      {pdBlocking ? (
        <PhoneDownOverlay
          pdState={pdState}
          graceLeftMs={graceLeft}
          busy={busy !== null}
          onDisarm={() => void togglePhoneDown(false)}
          onStop={() => void stop()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four, flexGrow: 1 },
  error: { color: Colors.danger, fontSize: 14 },
  notice: { color: Colors.accent, fontSize: 14 },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
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
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  secondaryButtonText: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  stopButton: {
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
  },
  stopButtonText: { color: Colors.danger, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.5 },
  runningView: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  clock: { color: Colors.text, fontSize: 72, fontWeight: '200', fontVariant: ['tabular-nums'] },
  kindLabel: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  progressTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.backgroundSelected,
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: Colors.accent, borderRadius: 3 },
  metaText: { color: Colors.textSecondary, fontSize: 13 },
  pdRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  controls: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.four },
  endCard: { gap: Spacing.four, alignSelf: 'stretch' },
  endTitle: { color: Colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  endSub: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  spansCard: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: 10,
    padding: Spacing.four,
    gap: Spacing.two,
  },
});
