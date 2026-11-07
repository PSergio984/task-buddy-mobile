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
