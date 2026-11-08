/**
 * Wire types mirroring the Task Buddy FastAPI schemas
 * (app/schemas/{task,plan,user,tag}.py). Datetimes are ISO strings on the wire.
 */

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/** DeadlineType enum serializes by value: 'soft' | 'hard'. */
export type DeadlineType = 'soft' | 'hard';

export interface Tag {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
  position: number;
  user_id: number;
  created_at: string;
}

export interface Subtask {
  id: number;
  task_id: number;
  user_id: number;
  title: string;
  description?: string | null;
  completed: boolean;
  due_date?: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** TaskCreateResponse — returned by GET/POST/PUT /api/v1/tasks. */
export interface Task {
  id: number;
  title: string;
  description?: string | null;
  due_date?: string | null;
  proposed_deadline?: string | null;
  deadline_type?: DeadlineType | null;
  completed: boolean;
  priority: TaskPriority;
  project_id?: number | null;
  user_id: number;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  subtasks: Subtask[];
}

/** TaskCreateRequest — POST /api/v1/tasks/. */
export interface TaskCreateData {
  title: string;
  description?: string;
  due_date?: string;
  estimated_effort_minutes?: number;
  completed?: boolean;
  priority?: TaskPriority;
  project_id?: number;
  tags?: string[];
  subtasks?: {
    title: string;
    description?: string;
    due_date?: string;
    completed?: boolean;
    position?: number;
  }[];
}

export interface TaskListParams {
  completed?: boolean;
  project_id?: number;
  tag_id?: number;
  limit?: number;
  offset?: number;
}

/* --- Plan (POST /api/v1/plan) --- */

export interface PlanRequest {
  available_minutes?: number;
  limit?: number;
}

export interface PlanTaskRow {
  task_id: number;
  reason: string;
  effort_minutes?: number | null;
}

export type PlanPeriod = 'tonight' | 'tomorrow' | 'later';

export interface PlanBucket {
  period: PlanPeriod;
  tasks: PlanTaskRow[];
}

export interface PlanResponse {
  buckets: PlanBucket[];
  reason?: string | null;
  plan_id?: number | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  response_time_ms: number;
  pool_size: number;
  available_minutes: number;
}

/* --- Game layer (mirrors app/schemas/game.py on the backend) --- */

export type SessionMode = 'timer' | 'stopwatch';
export type SessionDifficulty = 'trivial' | 'easy' | 'medium' | 'hard';

/** Phone-down verification tier — server blob vocabulary. */
export type PhoneDownTier = 'verified' | 'unverified' | 'violated';
/** Where a span's proof came from. */
export type PhoneDownEvidence = 'live' | 'retro' | 'none';

/** Blob-side span (ISO strings) — distinct from the epoch-ms PhoneDownSpan
 *  the game machine uses; the Blob prefix keeps a wrong import loud. */
export interface PhoneDownBlobSpan {
  start_ts: string;
  end_ts: string;
  tier: PhoneDownTier;
  evidence: PhoneDownEvidence;
}

/** Phone-down violation kinds — phone_down.VIOLATION_KINDS server-side. */
export type PhoneDownViolationKind = 'pickup' | 'grace_expired';

/** FocusSessionOut.phone_down — populated by the backend after the
 *  phone_down_span / phone_down_violation ledger events land. Mirrors
 *  phone_down.new_blob(): violations is a COUNT, not a list of markers;
 *  penalized_violation_ats records which violation instants already
 *  cost HP (backend rename of violations_penalized). */
export interface PhoneDownBlob {
  enabled: boolean;
  spans: PhoneDownBlobSpan[];
  violations: number;
  penalized_violation_ats?: string[];
  reported_client_event_ids?: string[];
  /** Adjudicated at score time — present once a phase's scoring ran. */
  streak_count?: number;
  xp_multiplier?: number;
}

export interface SessionPhaseIn {
  kind: 'focus' | 'break';
  minutes: number;
}

/** SessionStartIn — POST /api/v1/game/sessions. mode=stopwatch ignores phases. */
export interface SessionStartRequest {
  mode?: SessionMode;
  phases?: SessionPhaseIn[];
  task_id?: number | null;
  tag_id?: number | null;
  activity_label?: string | null;
  difficulty?: SessionDifficulty;
  auto_start_breaks?: boolean;
  auto_start_focus?: boolean;
  pause_budget_count?: number;
  pause_budget_seconds?: number;
  /** Arm phone-down verification for the session (#70). */
  phone_down?: boolean;
}

export interface SessionPhaseOut {
  seq: number;
  kind: string;
  status: string;
  planned_seconds: number;
  actual_seconds: number | null;
  pause_count: number;
  paused_seconds: number;
  pause_started_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

/** FocusSessionOut. */
export interface GameSession {
  id: number;
  mode: string;
  status: string;
  task_id: number | null;
  activity_label: string | null;
  preset: {
    difficulty?: string;
    auto_start_breaks?: boolean;
    auto_start_focus?: boolean;
    tag_id?: number;
  } | null;
  pause_budget_count: number;
  pause_budget_seconds: number;
  started_at: string;
  ended_at: string | null;
  /** Speedrun variant blob — always null on mobile (speedrun is web-only). */
  speedrun?: Record<string, unknown> | null;
  phases: SessionPhaseOut[];
  /** Non-null iff the session started with phone_down:true (new_blob at
   *  creation); spans/violations fill in as the ledger events land. */
  phone_down?: PhoneDownBlob | null;
}

export interface GameProfile {
  level: number;
  xp: number;
  xp_to_next_level: number;
  hp: number;
  max_hp: number;
  gold: number;
  str_stat: number;
  int_stat: number;
  con_stat: number;
  per_stat: number;
  unspent_stat_points: number;
  game_class: string | null;
  class_unlocked: boolean;
  auto_allocate: boolean;
  avatar_config: Record<string, unknown>;
  xp_today: number;
  gold_today: number;
  retention: string;
  server_time?: string;
}

export interface SessionActionResponse {
  session: GameSession;
  profile: GameProfile | null;
  server_time: string;
}

/** GameEventIn — one queued client event, idempotent per client_event_id. */
export interface GameEventIn {
  client_event_id: string;
  type: string;
  client_ts: string;
  payload: Record<string, unknown>;
}

export interface GameEventResult {
  client_event_id: string;
  status: 'applied' | 'duplicate';
}

export interface GameSyncResponse {
  profile: GameProfile;
  results: GameEventResult[];
  applied: number;
  duplicates: number;
  server_time: string;
}

/** GameEventRead — a ledger row from GET /api/v1/game/events?since=. */
export interface GameEventRead {
  id: number;
  client_event_id: string;
  type: string;
  payload: Record<string, unknown>;
  client_ts: string;
  server_ts: string;
}

export interface GameEventsFeedResponse {
  events: GameEventRead[];
  server_time: string;
}

/** Payload for a closed phone_down_span ledger event (#70 contract). */
export interface PhoneDownSpanPayload {
  session_id: number;
  start_ts: string;
  end_ts: string;
  claimed_tier: PhoneDownTier;
  evidence: PhoneDownEvidence;
}

/** Payload for a phone_down_violation ledger event (#70 contract). */
export interface PhoneDownViolationPayload {
  session_id: number;
  at_ts: string;
  kind: PhoneDownViolationKind;
}

/* --- Game UI parity surfaces (#71) — all mirror app/schemas/game*.py --- */

/** Diary/timeline read horizon — RetentionIn on the backend. */
export type RetentionPreference = '90d' | '1y' | 'forever';

export type GameClass = 'warrior' | 'mage' | 'healer' | 'rogue';

/** Allocatable stat keys — engine.STAT_KEYS; values index <stat>_stat. */
export type StatKey = 'str' | 'int' | 'con' | 'per';

/** GearItemRead — one catalog row merged with the viewer's flags. */
export interface GearItem {
  key: string;
  name: string;
  /** "weapon" | "armor" | "head" | "shield" | "body" | "back" | "eyewear". */
  slot: string;
  /** Class lock — "all" or a GameClass. */
  klass: string;
  tier: number;
  stats: Record<string, number>;
  cost: number;
  losable: boolean;
  owned: boolean;
  equipped: boolean;
  costume?: boolean;
}

export interface GearListResponse {
  items: GearItem[];
  profile: GameProfile;
}

export interface Achievement {
  key: string;
  name: string;
  description: string | null;
  gold_reward: number;
  /** null until the badge is granted. */
  earned_at: string | null;
}

/** Habits — Habit* contracts. Scoring rides the offline event queue
 *  (`habit_click` {habit_id, direction}); the REST endpoints are for CRUD
 *  and the online fast-path click. */
export type HabitDirection = 'positive' | 'negative' | 'both';
export type HabitClickDirection = 'positive' | 'negative';

export interface Habit {
  id: number;
  title: string;
  notes: string | null;
  direction: HabitDirection;
  difficulty: SessionDifficulty;
  /** Engine-owned drift state, clamped [-47.27, +21.27] on the backend. */
  value: number;
  /** Net +clicks minus −clicks. */
  counter: number;
  /** Auto-+click per completed focus phase. */
  bind_focus: boolean;
  reminder_times: string[];
  created_at: string;
  updated_at: string;
}

export interface HabitInput {
  title: string;
  notes?: string | null;
  direction?: HabitDirection;
  difficulty?: SessionDifficulty;
  reminder_times?: string[];
  bind_focus?: boolean;
}

export type HabitPatch = Partial<HabitInput>;

export interface HabitClickResponse {
  habit: Habit;
  profile: GameProfile;
  status: 'applied' | 'duplicate';
  server_time: string;
}

/** Dailies — Daily and Recurrence contracts. */
export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekdays'; days: number[] }
  | { kind: 'every_n_days'; interval: number; anchor?: string | null }
  | { kind: 'times_per_week'; count: number };

export interface DailyItem {
  id: number;
  title: string;
  position: number;
  done_today: boolean;
}

export interface Daily {
  id: number;
  title: string;
  notes: string | null;
  difficulty: SessionDifficulty;
  recurrence: Recurrence;
  streak: number;
  active: boolean;
  reminder_times: string[];
  items: DailyItem[];
  /** The day's whole-daily mark; item checks can complete it implicitly. */
  completed_today: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailyItemInput {
  title: string;
  position?: number;
}

export interface DailyInput {
  title: string;
  notes?: string | null;
  difficulty?: SessionDifficulty;
  recurrence?: Recurrence;
  /** On update the provided list fully replaces the checklist. */
  items?: DailyItemInput[];
  reminder_times?: string[];
  /** Engine-owned on create; only meaningful on update (pause/resume). */
  active?: boolean;
}

/** `active` is engine-owned on create — splitting it out keeps the PATCH
 *  contract honest about which writes can pause/resume a daily. */
export type DailyPatch = Partial<Omit<DailyInput, 'active'>> & {
  active?: boolean;
};

export interface DailyCheckInput {
  /** Omit to check the whole daily (pays the items' remaining share). */
  daily_item_id?: number | null;
  /** false un-marks without clawing back already-paid rewards. */
  done?: boolean;
}

export interface DailyCheckResponse {
  daily: Daily;
  profile: GameProfile;
  status: 'applied' | 'duplicate';
  server_time: string;
}

/** Activity tracking — game_tracking contracts (contribution grid + stats). */
export interface ActivityDay {
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  score: number;
  focus_minutes: number;
  /** Score-eligible per-type counts — not raw ledger activity. */
  events: Record<string, number>;
  /** Server-computed intensity bucket (index into tier_thresholds). */
  tier: number;
}

export interface ActivityGrid {
  start: string;
  end: string;
  /** One row per UTC day in [start, end] — the server fills empty days. */
  days: ActivityDay[];
  /** Sorted score cutoffs: tier n applies when score >= tier_thresholds[n-1]. */
  tier_thresholds: number[];
  server_time: string;
}

export interface ActivityStats {
  start: string;
  end: string;
  avg_hours_per_day: number;
  total_hours: number;
  current_streak: number;
  longest_streak: number;
  best_day: { date: string; score: number } | null;
  /** Score sum over the 7 days ending at server-today, clipped to the window. */
  weekly_total: number;
  /** Per-activity-label speedrun personal bests (#69). */
  speedrun_pbs: SpeedrunPB[];
  server_time: string;
}

/** One beat-your-best record row — speedrun_pbs[] in ActivityStats. */
export interface SpeedrunPB {
  activity_label: string;
  best_seconds: number;
  attempts: number;
  set_at: string;
  /** Sub-60s runs don't make the board; absent on older backends (?? []). */
  recent_attempts?: { seconds: number; ended_at: string }[];
}

/** Diary — Diary* contracts. */
export type DiaryEntryKind = 'standup' | 'freeform';

export interface DiaryEntry {
  id: number;
  kind: DiaryEntryKind;
  /** UTC calendar day, "YYYY-MM-DD". */
  entry_date: string;
  good: string | null;
  bad: string | null;
  next: string | null;
  freeform: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiaryEntryInput {
  kind: DiaryEntryKind;
  /** Missing → today (UTC). Client may backfill a missed day. */
  entry_date?: string;
  good?: string | null;
  bad?: string | null;
  next?: string | null;
  freeform?: string | null;
}

export type DiaryEntryPatch = Partial<Pick<DiaryEntry, 'good' | 'bad' | 'next' | 'freeform'>>;

export interface DiaryListResponse {
  entries: DiaryEntry[];
  has_more: boolean;
}

/** Timeline — TimelineDayResponse contracts. */
export interface TimelinePhase {
  seq: number;
  kind: string;
  status: string;
  planned_seconds: number;
  actual_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface TimelineSessionBlock {
  id: number;
  mode: string;
  status: string;
  task_id: number | null;
  activity_label: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  phases: TimelinePhase[];
}

export interface TimelineMarker {
  id: number;
  type: string;
  ts: string;
  outcome: Record<string, unknown> | null;
}

export interface TimelineDayResponse {
  date: string;
  sessions: TimelineSessionBlock[];
  markers: TimelineMarker[];
  diary: DiaryEntry[];
  server_time: string;
}

/* --- Auth --- */

export interface AuthUser {
  id: number;
  username: string;
  email: string;
}

/** POST /api/v1/users/token (OAuth2 password form). */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

/** POST /api/v1/users/register — also returns a usable token. */
export interface RegisterResponse {
  detail: string;
  access_token: string;
  user: AuthUser;
}
