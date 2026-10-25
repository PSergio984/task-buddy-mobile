/**
 * Fetch wrapper for the Task Buddy FastAPI backend.
 * Injects `Authorization: Bearer <token>` from SecureStore and unwraps
 * FastAPI's `{detail: ...}` error shape into ApiError.
 *
 * Leaf module: auth.ts builds on this — do not import auth.ts here.
 */
import * as SecureStore from 'expo-secure-store';

import type { PlanRequest, PlanResponse, Task, TaskCreateData, TaskListParams } from './types';

export const TOKEN_STORAGE_KEY = 'task-buddy.access-token';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

let onUnauthorized: (() => void) | null = null;
/** Called when an authed request 401s — auth.ts registers the token-clear hook. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serializable body. */
  json?: unknown;
  /** application/x-www-form-urlencoded body (OAuth2 token endpoint). */
  form?: Record<string, string>;
  /** Skip the Bearer header (login/register). */
  auth?: boolean;
}

function extractDetail(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.length > 0) return detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: unknown } | undefined;
      if (typeof first?.msg === 'string') return first.msg;
    }
  }
  return `Request failed (${status})`;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', json, form, auth = true } = options;

  const headers: Record<string, string> = {};
  if (auth) {
    const token = await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let body: string | undefined;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { method, headers, body });
  } catch {
    throw new ApiError(0, `Cannot reach the server at ${API_URL}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null; // non-JSON error body (proxy HTML, etc.)
  }
  if (!response.ok) {
    if (response.status === 401 && auth) onUnauthorized?.();
    throw new ApiError(response.status, extractDetail(data, response.status));
  }
  return data as T;
}

/* --- Typed endpoint wrappers --- */

export const tasksApi = {
  list: (params: TaskListParams = {}) => {
    const query = new URLSearchParams();
    if (params.completed !== undefined) query.set('completed', String(params.completed));
    if (params.project_id !== undefined) query.set('project_id', String(params.project_id));
    if (params.tag_id !== undefined) query.set('tag_id', String(params.tag_id));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return apiFetch<Task[]>(`/api/v1/tasks/${qs ? `?${qs}` : ''}`);
  },
  get: (id: number) => apiFetch<Task>(`/api/v1/tasks/${id}`),
  create: (task: TaskCreateData) =>
    apiFetch<Task>('/api/v1/tasks/', { method: 'POST', json: task }),
};

export const planApi = {
  generate: (request: PlanRequest = {}) =>
    apiFetch<PlanResponse>('/api/v1/plan', { method: 'POST', json: request }),
};
