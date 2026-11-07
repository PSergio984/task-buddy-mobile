# Phone-down focus sessions (#70)

Mobile-only overlay on top of the server-authoritative focus-session engine.
When a session is armed, the phone must stay face-down; every continuous
face-down interval becomes a **span**, and every pickup that outlasts grace
becomes a **violation**. Both reach the server as client ledger events
(`POST /api/v1/game/events`) and are adjudicated there — the client reports
facts, the server decides what they pay.

## The honesty rule

Nothing is ever labeled beyond what the sensors could prove:

| Tier         | Meaning                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified`   | Every instant of the span has live or retro sensor coverage.                                                                                                        |
| `unverified` | Part of the span is unproven (dead sensor, denied permission, gap with no retro verdict).                                                                           |
| `violated`   | A violation is associated with the span — an instant inside its window, its own `grace_expired` (stamped at the deadline it outlasted), or a retro `moved` verdict. |

A span that can't be proven is **always** `unverified` — never quietly
promoted. The in-session chip follows the same rule: it shows `verified`
only while a provider is actively covering, `violated` once a violation is
recorded, and `unverified` otherwise.

## State machine

`src/game/phone-down.ts` — pure, React-free, unit-tested exhaustively.

```
armed ──FACE_DOWN──▶ running ──PICKED_UP──▶ grace
                                      ▲          │FACE_DOWN (inside grace)
                   running ◀──────────┘          │GRACE_EXPIRED (≥ grace ms)
                                                 ▼
                                             violated ──FACE_DOWN──▶ running
```

- `STOP` from anywhere returns to `idle`, closing any open span.
- Grace is **10 s** and timestamp-checked: `GRACE_EXPIRED` fired early is
  ignored; fired at/after `graceStart + 10 s` it marks the pending span
  violated and records a `grace_expired` violation.
- `EXTERNAL_VIOLATION` (a retro provider proving the phone moved while the
  app was suspended) marks the span violated and records a `pickup`.

The classifier (`FaceDownClassifier`) turns gravity-z into debounced edges:
`|z| ≈ 1g` on the platform-dependent side (Android raw ≈ −1g, iOS ≈ +1g),
750 ms dwell both directions, ~10 Hz sampling. Calibration samples ~800 ms
at arm time — it can confirm the convention (`measured`), flag an already-
down/ambiguous reading (`already_down`), or fall back to the platform prior
(`assumed`). It never overrides the sign on ambiguous data, because `|z|`
alone cannot distinguish the two cases.

## Event payloads (server contract)

Spans are persisted to the local queue the moment they close and violations
the moment they are recorded — nothing waits for session end, so evidence
survives an app kill. Sub-2s spans are sensor flick and never leave the
device.

```jsonc
// phone_down_span
{ "session_id": 7, "start_ts": "…", "end_ts": "…",
  "claimed_tier": "verified|unverified|violated",
  "evidence": "live|retro|none" }

// phone_down_violation
{ "session_id": 7, "at_ts": "…", "kind": "pickup|grace_expired" }
```

`kind` must match the backend's `phone_down.VIOLATION_KINDS` exactly —
anything else is rejected at ingest (`invalid_kind`). The server re-
adjudicates `claimed_tier` (a violation instant inside the span window
forces `violated` regardless of the claim), dedupes on `client_event_id`,
and stores the result in `FocusSessionOut.phone_down`.

## Evidence flow

```
sensors → feedEdge → PhoneDownMachine → closed spans / violations
                                          │ CoverageTracker (live windows + gaps)
                                          ▼
                             resolveSpanTier (honest tier+evidence)
                                          ▼
                        EventQueue (AsyncStorage FIFO, ≤500/batch,
                                    backoff retry, dedupe-safe)
                                          ▼
                          POST /api/v1/game/events → sessionsApi.stop
```

Lifecycle REST calls (start/pause/resume/advance/stop) are **not** queued —
offline they fail honestly. Evidence is written to the persisted queue as
each span closes / each violation records, and flushes on stop, on next
mount, and on a 15 s retry while a pending stop is outstanding — so an app
kill mid-session still delivers what was recorded (the end-of-session
summary card is lost, the ledger rows are not). A batch the server rejects
deterministically (4xx, e.g. a schema 422) survives five flush cycles,
then is dead-lettered — counted in `deadLetterCount()`, not dropped
silently — so one poisoned batch can't wedge the FIFO.

## Provider stack

| Provider                  | Module                 | Covers suspension | Notes                                                                                                                                            |
| ------------------------- | ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accelerometer`           | `expo-sensors`         | no                | Expo-Go path; foreground only, ~10 Hz.                                                                                                           |
| `proximity`               | `expo-proximity`       | no                | Local module; foreground on iOS — enabling proximity monitoring blanks the screen, which is benign here (the overlay is already a black screen). |
| `focus-service`           | `expo-focus-service`   | **yes**           | Android-only `specialUse` FGS: wake lock + wake-up proximity buffer + 60s heartbeats; drained on resume/poll.                                    |
| `motion-recorder` (retro) | `expo-motion-recorder` | n/a               | iOS-only `CMSensorRecorder`; classifies suspended gaps `stayed_flat`/`moved`/`unknown`.                                                          |

Providers report `isAvailable()` honestly and are skipped when unavailable —
nothing crashes in Expo Go; the stack just degrades.

Coverage claims are bound to observed liveness, not provider intent:

- A continuous emitter (accelerometer) that goes silent >1.5 s while the
  app is foreground ends live coverage at its last sample — a dead stream
  can't keep claiming the window.
- The FGS buffer carries heartbeat rows and a drain-time stamp. A resumed
  interval is covered only when the drain proves the service alive;
  `START_NOT_STICKY` means alive-at-drain proves the whole gap. A service
  that died mid-gap leaves its last proof as the bound — the unproven tail
  lands `unverified`.
- iOS suspended gaps resolve through the retro query alone — real samples,
  no liveness inference needed.

## Expo Go vs dev build

| Capability                                   | Expo Go        | `eas build --profile development` |
| -------------------------------------------- | -------------- | --------------------------------- |
| Focus timer/stopwatch UI, pause/resume/stop  | ✅             | ✅                                |
| Phone-down overlay + state machine           | ✅             | ✅                                |
| Face-down detection (accelerometer, fg only) | ✅ degraded    | ✅                                |
| Proximity sensing                            | ❌ unavailable | ✅ Android + iOS                  |
| Background/Doze coverage (Android FGS)       | ❌ unavailable | ✅ Android                        |
| Suspended-gap retro proof (CMSensorRecorder) | ❌ unavailable | ✅ iOS 9+ / iPhone 7+             |
| Event queue, offline sync, history           | ✅             | ✅                                |

In Expo Go every suspended interval is an unproven gap → affected spans land
`unverified`. That is the intended degraded behaviour, not a bug.

Dev build:

```bash
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile development --platform ios
```

The local modules live under `modules/` and autolink through
`expo-module.config.json` (no `ios/`/`android/` dirs — CNG).

## Per-platform verification matrix

| Scenario                           | Android dev build                                             | iOS dev build                                                  |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Foreground face-down detect        | accelerometer (−1g z) + proximity                             | accelerometer (+1g z) + proximity                              |
| App backgrounded, phone stays down | FGS proximity buffer → `verified`                             | CMSensorRecorder `stayed_flat` → `verified` (evidence `retro`) |
| App backgrounded, phone picked up  | FGS buffered `picked_up` → grace/violation replayed on resume | CMSensorRecorder `moved` → `pickup` violation                  |
| Retro query returns nothing        | n/a (FGS covers)                                              | gap `unknown` → `unverified`                                   |
| Sensor denied/dead mid-session     | gap unproven → `unverified`                                   | gap unproven → `unverified`                                    |
| Expo Go                            | accelerometer only; suspensions → `unverified`                | same                                                           |

## Permissions / manifest

- Android: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`,
  `WAKE_LOCK`, `POST_NOTIFICATIONS` (declared in the
  `expo-focus-service` manifest; `specialUse` FGS subtype documented in the
  service's `<property>` tag). `POST_NOTIFICATIONS` also needs a **runtime**
  request on Android 13+ — done at phone-down arm time, or the FGS
  notification (the wake-lock transparency the user is owed) is silently
  suppressed. The FGS starts only while the app is foreground — API 31+
  rejects background starts — and Play submission needs the `specialUse`
  FGS declaration in the Play Console ("uses" declaration for
  `FOREGROUND_SERVICE_SPECIAL_USE`).
- iOS: `NSMotionUsageDescription` via the `expo-sensors` plugin's
  `motionPermission` in `app.json`. `CMSensorRecorder` requires iPhone 7+
  and records ≤ 12 h per call (session windows capped accordingly).
  Limitation: `CMSensorRecorder` exposes no pre-prompt API — the system
  motion-usage prompt fires on the first `recordAccelerometer` call
  itself. While authorization is still `notDetermined` (or was denied),
  recording yields no data and suspended gaps resolve `unknown` →
  `unverified`; the first granted session records normally thereafter.

## Known limits

- The accelerometer can't tell face-down-on-desk from face-down-on-lap —
  the contract is "face-down", not "on a desk".
- Proximity `near` also fires in a pocket — treated as face-down, matching
  the intent (phone stowed and unusable).
- A killed app loses the FGS buffer mid-flight; evidence already recorded
  survives in the persisted queue, and spans covering the lost interval
  resolve `unverified` rather than fabricating coverage.
- The FGS replay preserves real timestamps, so a buffered `face_down`
  inside a suspended grace DOES fire the corrected-inside-grace path on
  resume. The "corrected pickup resolves as violation" asymmetry holds
  only for the iOS retro path, where a 'moved' verdict can't say WHEN
  the pickup happened — it lands on the violated side.
- Android suspended-coverage proof is heartbeat-granular: the FGS emits a
  liveness row every 60s and a drain stamps it fresh — a proof counts for
  30s (COVERAGE_PROOF_FRESH_MS). If the service dies just after its last
  heartbeat and the app resumes inside that 30s window, up to ~30s of
  unmonitored tail at a suspension's end can be claimed covered. Bounded,
  disclosed, and the only direction the model errs is one freshness
  window of tail. The same bound governs a silent mid-foreground death:
  live coverage ends at the last proof once it is stale past one
  heartbeat (60s) plus the 30s freshness window.
- Speedrun mode is out of scope; phone-down is also rejected for stopwatch
  server-side (flat XP has nothing to gate), so the toggle is timer-only.
