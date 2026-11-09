/**
 * Editable-preview state for the Smart Import flow (#3): one DraftProposal
 * per extracted ImportTaskProposal. Pure mapping/payload logic lives here —
 * no RN imports — so include/exclude + TaskCreateData building is
 * unit-testable without a renderer.
 */
import type { ImportTaskProposal, TaskCreateData, TaskPriority } from '@/api/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DraftProposal {
  /** Stable key across edits/removals (extraction order is unique). */
  id: number;
  included: boolean;
  /** True once POST /api/v1/tasks succeeded — created cards are immutable
   *  and skipped by every later commit attempt. */
  created: boolean;
  /** Assigned lazily on the first commit attempt and REUSED on retries —
   *  the backend's idempotency middleware replays the first response
   *  instead of double-creating the task. */
  idempotencyKey: string | null;
  /** Per-card create error from the last commit attempt. */
  error: string | null;
  title: string;
  /** Editable YYYY-MM-DD ('' = no deadline) — mobile has no time picker,
   *  so the proposal's ISO deadline is kept at day granularity. */
  deadline: string;
  priority: TaskPriority;
  description: string | null;
  /** Passed through from suggested_project_id — the repo has no project
   *  picker to edit it with, so it is preserved, not offered. */
  projectId: number | null;
  subtasks: string[];
}

export function toDrafts(proposals: ImportTaskProposal[]): DraftProposal[] {
  return proposals.map((p, i) => ({
    id: i,
    included: true,
    created: false,
    idempotencyKey: null,
    error: null,
    title: p.title,
    deadline: p.proposed_deadline?.slice(0, 10) ?? '',
    priority: p.priority,
    description: p.description,
    projectId: p.suggested_project_id,
    subtasks: p.subtasks.map((s) => s.title),
  }));
}

/** null = valid. Only YYYY-MM-DD accepted — matches the stored slice. */
export function deadlineError(deadline: string): string | null {
  if (deadline === '') return null;
  if (!DATE_RE.test(deadline) || Number.isNaN(Date.parse(`${deadline}T00:00:00Z`))) {
    return 'Use YYYY-MM-DD';
  }
  return null;
}

/** Drafts the next commit would POST: included, not yet created, and
 *  valid (non-empty title, parseable deadline). */
export function committable(drafts: DraftProposal[]): DraftProposal[] {
  return drafts.filter(
    (d) => d.included && !d.created && d.title.trim() !== '' && deadlineError(d.deadline) === null,
  );
}

/** TaskCreateRequest payload for one card. Callers must gate on
 *  `committable` first — an invalid deadline would go out verbatim.
 *  Read-only fields are clipped to the backend limits (description ≤
 *  2000 chars, subtask title ≤ 80) — an oversized AI value can't be
 *  fixed in-app and would 422. */
export function toTaskCreate(d: DraftProposal): TaskCreateData {
  return {
    title: d.title.trim().slice(0, 100),
    ...(d.description?.trim() ? { description: d.description.trim().slice(0, 2000) } : {}),
    ...(d.deadline ? { due_date: `${d.deadline}T00:00:00Z` } : {}),
    priority: d.priority,
    ...(d.projectId !== null ? { project_id: d.projectId } : {}),
    ...(d.subtasks.length > 0
      ? { subtasks: d.subtasks.map((title) => ({ title: title.slice(0, 80) })) }
      : {}),
  };
}

export interface CommitJob {
  /** Draft id — correlates the job back to its card for status updates. */
  id: number;
  /** X-Idempotency-Key for the create POST — the draft's stored key on a
   *  retry, else minted via `uuid` ONCE (the caller stores it back on the
   *  draft before posting, so a later retry replays instead of
   *  double-creating). */
  key: string;
  payload: TaskCreateData;
}

/** Frozen per-card create jobs for one commit pass — payloads and keys
 *  are captured up front so card edits can't change a request mid-flight
 *  and every retry of the same card reuses the same key. */
export function planJobs(drafts: DraftProposal[], uuid: () => string): CommitJob[] {
  return committable(drafts).map((d) => ({
    id: d.id,
    key: d.idempotencyKey ?? uuid(),
    payload: toTaskCreate(d),
  }));
}
