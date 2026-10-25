# Task Buddy Mobile

Expo (React Native + TypeScript) mobile client for the Task Buddy app — talks to the
FastAPI backend at [task-buddy-backend](../task-buddy-backend).

## Run it

```bash
npm install
cp .env.example .env        # set EXPO_PUBLIC_API_URL
npx expo start              # then press 'a' for Android, 'i' for iOS
```

`EXPO_PUBLIC_API_URL` must point at a reachable backend (default port 8000):

- **Android emulator**: `http://10.0.2.2:8000` (10.0.2.2 is the host's localhost)
- **iOS simulator**: `http://localhost:8000`
- **Physical device**: `http://<your-LAN-IP>:8000`

## Stack

- Expo SDK 58, expo-router (file-based routes in `src/app/`), TypeScript strict
- `@tanstack/react-query` for server state
- `expo-secure-store` for the Bearer token (no cookies/CSRF needed — the backend
  accepts `Authorization: Bearer` on every endpoint)
- Plain `StyleSheet`, dark theme matching the web app (#0F172A / slate / #C2A388)

## What's wired

| Screen / file           | Endpoint                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `src/app/login.tsx`     | `POST /api/v1/users/token` (login) · `POST /api/v1/users/register`                        |
| `src/app/(tabs)/index`  | `GET /api/v1/tasks/` (list, pull-to-refresh) · `POST /api/v1/tasks/` (quick add by title) |
| `src/app/task/[id].tsx` | `GET /api/v1/tasks/{id}` (detail + subtasks + tags)                                       |
| `src/app/(tabs)/plan`   | `POST /api/v1/plan` → tonight / tomorrow / later buckets                                  |
| Sign out (Tasks header) | `POST /api/v1/users/logout` + local token clear                                           |

Auth token is persisted in `expo-secure-store`; the root layout
(`src/app/_layout.tsx`) redirects to `/login` when no token is found and back to
`/` after login. A 401 on any authed request clears the token, which bounces
back to `/login` via the same gate. The API layer is `src/api/client.ts`
(fetch + Bearer injection + `{detail}` error unwrapping), `src/api/auth.ts`
(token storage + `useAuth()`), and `src/api/types.ts` (wire types mirrored
from `app/schemas/`).

Registration is email-confirmed: `register` returns a token but the backend
403s every endpoint until confirmed, so the app shows a "check your email"
state (with resend via `POST /api/v1/users/resend-confirmation`) instead of
storing the token.

No web target — `expo-secure-store` is a no-op on web and the backend's
origin-check middleware only allows its configured `ALLOWED_ORIGINS` anyway.
Use the Next.js frontend for browsers.

## Stubbed / TODO

- POSTs don't send `X-Idempotency-Key` (optional — the middleware passes requests
  without it; the web client sends a UUID for double-submit protection).
- Plan rows only carry `task_id` — titles are resolved client-side from the
  cached task list; a task not in the first page of results shows as `Task #id`.
- No offline support, push notifications, or realtime sync (the web client has
  them via `/api/v1/realtime` + `/api/v1/sync`).
- Projects, tags, subtasks, knowledge/notes, stats, and breakdown endpoints are
  not surfaced in the UI yet.
- Register requires a username (3–50 chars) — the backend schema requires it
  even though login only uses email + password.
- Task list uses the backend default page (`limit=100`, no offset) — no
  pagination UI yet; `available_minutes` input is clamped to the backend's
  1440-minute cap.
