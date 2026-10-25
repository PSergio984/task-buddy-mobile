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
