# Workout Session Logging Implementation Plan

## Overview

Let a user launch a planned workout from their weekly plan, log sets (reps/duration + weight) for each exercise in real time via silent autosave, and finish the session — the product's north-star flow (roadmap S-03, GitHub issue #5, FR-008/FR-009/FR-010, US-02).

## Current State Analysis

The DB schema for this feature already exists and is unused: `workout_sessions` (status `active`/`completed`/`abandoned`, with a partial unique index enforcing one active session per workout) and `workout_sets` (reps/weight/duration per set, unique on `(workout_session_id, exercise_id, set_number)`) were created in F-01 but no code reads or writes them yet. `src/types.ts` already defines `WorkoutSessionWithSets` for exactly this purpose, but nothing constructs it.

The weekly plan is rendered read-only today: `src/pages/dashboard.astro` calls `getActivePlan()` (`src/lib/services/plan.ts:178-210`) and renders `PlanDisplay.astro`, which lists each workout's exercises with no way to act on them — no "start workout" affordance exists anywhere.

Two API conventions already exist to choose between: form-POST+redirect (`src/pages/api/profile.ts`) and fetch+JSON (`src/pages/api/plan.ts`). This feature needs real-time saves without page reloads, so it follows the fetch+JSON convention.

No automated test suite exists yet (`AGENTS.md`: "No automated test suite is configured"); CI (`​.github/workflows/ci.yml`) runs `lint` + `build` only.

## Desired End State

A user on the dashboard can tap "Start workout" on any plan item and land directly in an active logging session (auto-created server-side, no extra tap). They can enter reps/weight for any exercise's sets in any order; each set autosaves silently once both required fields are valid, pre-filled from their most recent past result for that exercise where available. Tapping "Finish workout" marks the session `completed` at any time, regardless of how many sets were logged. If they return to a workout that already has an unfinished session, they're asked whether to resume it or start over (which preserves already-logged data unless the session is empty, in which case it's simply replaced). The flow is covered by Vitest unit tests (validation + service response mapping) and one Playwright E2E happy-path test wired into CI.

Verification: `npm run lint`, `npm run build`, `npm run test` (Vitest), and `npm run test:e2e` (Playwright) all pass; a manual browser pass confirms the 2-tap launch, silent autosave-then-reload persistence, resume/restart choice, and finish flow.

### Key Discoveries:

- `idx_one_active_session_per_workout` (`supabase/migrations/20260612000000_active_session_uniqueness.sql:3-5`) is a partial unique index on `workout_sessions (user_id, workout_id) WHERE status = 'active'` — launching a session must check for and handle an existing active session, not blindly insert.
- `workout_exercises` already has a DB-level reps-XOR-duration `CHECK` (`supabase/migrations/20260714000001_workout_exercises_tracking_xor_check.sql`); `workout_sets` has no equivalent — same gap, same fix.
- Table GRANTs are required in addition to RLS (`context/foundation/lessons.md` — "Grant table privileges explicitly alongside RLS policies"; `supabase/migrations/20260716120000_grant_table_privileges_to_authenticated.sql`); `workout_sessions`/`workout_sets` are already covered by that migration's blanket grant, so no new grant migration is needed here — only new schema objects (the XOR check, the index, the new RPC) need to ship correctly scoped.
- `save_generated_training_plan` (`supabase/migrations/20260710120000_save_generated_training_plan_rpc.sql`, `20260714000000_add_advisory_lock_to_plan_rpc.sql`) is the existing precedent for wrapping a multi-statement write in a `SECURITY INVOKER` Postgres RPC so it executes as one transaction under RLS — the restart-session flow (delete-or-abandon existing session, then insert a new one) needs the same treatment.
- Service layer convention (`src/lib/services/plan.ts`, `profile.ts`): plain async functions, `supabase: SupabaseClient` as first arg, cast the Postgrest response, `if (error) throw error;`, return typed data. Validation lives separately in `src/lib/validation/*.ts` as schema factories + inferred types (`buildPlanSchema`, `onboardingSchema`).

## What We're NOT Doing

- No profile-editing or plan-regeneration UI (PRD Non-Goals; out of scope regardless).
- No visual "you beat your last result" indicator during logging — inputs pre-fill silently from the last logged set, but the improvement badge itself is FR-012, formally owned by S-05 (progress-indicators), which depends on S-04 (history) which depends on this slice.
- No explicit "Abandon" button as a first-class action separate from the resume/restart choice — abandonment only happens as a side effect of choosing "Start Over" on an already-active session.
- No workout history view (S-04) — finishing a session simply redirects to the dashboard.
- No rest timers, supersets, or any workout-structure UI beyond what `workout_exercises` already models.
- No offline support — autosave requires network connectivity; no service worker or local queue.

## Implementation Approach

Seven phases, each independently verifiable: (1) database migration for the XOR check, supporting index, and restart RPC; (2) service + validation layer; (3) Vitest setup and unit tests for that layer; (4) the three API routes; (5) the session page, middleware, and dashboard wiring; (6) the React islands (resume/restart modal, session logger, set rows) plus shadcn component installs; (7) Playwright E2E setup and CI wiring. DB and service/validation come first since everything else depends on their contracts; tests are pulled into their own phase per user request rather than bundled into the code that generates them, so each phase's automated criteria stay a clean "does the thing I just added work" check.

## Critical Implementation Details

### Timing & lifecycle: session get-or-create race

The session page's frontmatter does a read-then-write ("if no active session exists, create one") on every GET to `/session/[workoutId]`. Two near-simultaneous requests (double-click, two tabs) can both pass the "no active session" check before either insert commits, and the second insert will violate `idx_one_active_session_per_workout` (Postgres error code `23505`). The page/service must catch `23505` on that specific insert and re-fetch the now-existing active session as a fallback, rather than surfacing a 500.

### State sequencing: restart must be atomic

"Start Over" (Q6/Q7 decisions) requires: count existing sets → delete the session if zero, else mark it `abandoned` → insert a new active session — three dependent statements that must not partially apply (e.g., marking `abandoned` but failing to create the replacement would leave the user with no active session and no way to retry other than reloading). This is done in a single `SECURITY INVOKER` Postgres RPC (`restart_workout_session`), following the `save_generated_training_plan` precedent, so Postgres's implicit per-call transaction gives atomicity for free — no advisory lock is needed since a single user can only be restarting their own single workout's session at a time.

### User experience spec: navigate-away guard for unsaved sets

Silent autosave (Q8 decision) means the user gets no per-row feedback, so the highest-risk moment is leaving the page while a save is still pending (debounce armed but not yet fired, or a request in flight). `SessionLogger` tracks a pending-saves count across all `SetRow`s. On the browser's `beforeunload` event, if that count is nonzero: (1) fire a best-effort `navigator.sendBeacon` carrying the latest valid values for every pending row — `sendBeacon` only supports `POST`, so `sets.ts` exports a `POST` handler alongside `PUT` that performs the identical upsert, used exclusively as the beacon target; (2) call `event.preventDefault()` / set `event.returnValue` to trigger the browser's native "leave site?" confirmation, giving the user the option to stay and let the normal debounced save complete instead of relying solely on the beacon. This is a best-effort mitigation, not a guarantee — see Open Risks in the plan brief.

### Data integrity: clearing a field deletes the persisted set

A set row can transition from valid (both required fields filled, already autosaved) back to invalid if the user clears a field — e.g., they started typing into the wrong exercise's row by mistake. On that valid→invalid transition, the row's already-persisted `workout_sets` row must be deleted, not left stale with a value the user explicitly retracted. `SetRow` tracks whether it has ever successfully saved; on detecting the transition, it calls the new `DELETE` handler on `sets.ts` instead of silently doing nothing. A row that was never saved (always invalid) needs no API call when cleared.

## Phase 1: Database

### Overview

Close the `workout_sets` reps/duration integrity gap, add the index the pre-fill query needs, and add the atomic restart RPC.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260716130000_workout_session_logging_support.sql`

**Intent**: Add the same reps-XOR-duration invariant `workout_exercises` already has to `workout_sets`; add an index supporting "most recent set logged for exercise X, across sessions"; add the atomic restart RPC used by the "Start Over" flow.

**Contract**:
- `ALTER TABLE workout_sets ADD CONSTRAINT workout_sets_tracking_xor CHECK ((reps IS NOT NULL AND duration_seconds IS NULL) OR (reps IS NULL AND duration_seconds IS NOT NULL));` — mirrors `workout_exercises_tracking_xor`.
- `CREATE INDEX idx_workout_sets_exercise_logged ON workout_sets (exercise_id, logged_at DESC);` — supports the pre-fill lookup (most recent set for an exercise, filtered by the caller's RLS-scoped session join).
- `restart_workout_session(p_user_id uuid, p_existing_session_id uuid, p_workout_id uuid) RETURNS uuid` — `SECURITY INVOKER` function, callable via `supabase.rpc(...)`, that: verifies `p_existing_session_id` belongs to `p_user_id`/`p_workout_id` and is `active`; counts its sets; deletes it if the count is 0, otherwise sets its status to `abandoned`; inserts a new `workout_sessions` row (`user_id = p_user_id`, `workout_id = p_workout_id`, `status = 'active'`); returns the new row's `id`. Grant `EXECUTE` to `authenticated`, matching `save_generated_training_plan`'s grant pattern.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (or `supabase migration up` against the linked project)
- Table grants still cover `workout_sets`/`workout_sessions` for `authenticated` (per the lessons.md rule): `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee='authenticated' AND table_name IN ('workout_sessions','workout_sets');` returns full CRUD rows
- `npm run build` still passes (schema change doesn't break type generation/build)

#### Manual Verification:

- In Supabase Studio, manually insert a `workout_sets` row with both `reps` and `duration_seconds` set, and separately with neither — both attempts are rejected by the new CHECK
- Manually call `restart_workout_session` via the SQL editor against a seeded active session with 0 sets, then with >0 sets, and confirm the delete-vs-abandon branch and the new row's creation

---

## Phase 2: Service & Validation Layer

### Overview

Implement the pure/mockable logic other phases build on: Zod schemas for set input, and service functions wrapping every DB interaction this feature needs.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/validation/session.ts`

**Intent**: Validate a single set-logging request, branching on the exercise's `tracking_type` the same way `buildPlanSchema` branches per exercise in `src/lib/validation/plan.ts`.

**Contract**: Export `buildSetLogSchema(trackingType: TrackingType)` returning a `z.object` requiring `exercise_id` (uuid), `set_number` (positive int), `weight_kg` (nonnegative number, optional), and exactly one of `reps` (positive int) / `duration_seconds` (positive int) depending on `trackingType` — the other must be absent. Export the inferred type as `SetLogInput`.

#### 2. Types

**File**: `src/types.ts`

**Intent**: Add the one DTO shape this feature needs that isn't already covered by `WorkoutWithExercises`/`WorkoutSessionWithSets`.

**Contract**: Add `export type LastLoggedSets = Record<string, WorkoutSet | null>;` (keyed by `exercise_id`).

#### 3. Service functions

**File**: `src/lib/services/session.ts`

**Intent**: One function per DB interaction the API routes and session page need, following the existing service convention (plain functions, `supabase` first arg, typed return, raw thrown Postgrest errors).

**Contract**: Export:
- `getWorkoutWithExercises(supabase, userId, workoutId): Promise<WorkoutWithExercises | null>` — ownership-scoped fetch (mirrors the nested-select shape in `getActivePlan`), returns `null` if not found/not owned instead of throwing (route maps that to 404).
- `getActiveSessionForWorkout(supabase, userId, workoutId): Promise<WorkoutSession | null>`.
- `createSession(supabase, userId, workoutId): Promise<WorkoutSession>` — on a `23505` conflict (the race described in Critical Implementation Details), catches it and returns the result of `getActiveSessionForWorkout` instead of re-throwing.
- `getSessionWithSets(supabase, sessionId): Promise<WorkoutSessionWithSets>`.
- `getLastLoggedSets(supabase, userId, exerciseIds, excludeSessionId): Promise<LastLoggedSets>` — for each exercise id, the most recent `workout_sets` row (by `logged_at`) belonging to a session owned by `userId`, excluding `excludeSessionId`; missing exercises map to `null`.
- `upsertSet(supabase, sessionId, input: SetLogInput): Promise<WorkoutSet>` — `.upsert()` targeting the `(workout_session_id, exercise_id, set_number)` unique constraint.
- `deleteSet(supabase, sessionId, exerciseId, setNumber): Promise<void>` — deletes the `workout_sets` row matching `(workout_session_id, exercise_id, set_number)`, used when a previously-saved row is cleared back to invalid (see Critical Implementation Details); a no-op (not an error) if no matching row exists, since the client can't always know whether its clear raced with an in-flight save.
- `completeSession(supabase, sessionId): Promise<WorkoutSession>` — sets `status='completed'`, `completed_at=now()`.
- `restartSession(supabase, userId, existingSessionId, workoutId): Promise<string>` — thin wrapper around `supabase.rpc("restart_workout_session", {...})`, returns the new session id.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` / `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- N/A — this phase has no user-facing surface; correctness is covered by Phase 3's unit tests

---

## Phase 3: Vitest Setup & Unit Tests

### Overview

Introduce Vitest (new to this repo) and cover the pure/mockable logic from Phase 2: validation schemas fully, service functions via a mocked `SupabaseClient`.

### Changes Required:

#### 1. Vitest config and scripts

**File**: `vitest.config.ts`, `package.json`

**Intent**: Wire Vitest into the existing Astro/Vite setup so path aliases (`@/*`) resolve identically to the app build.

**Contract**: Use Astro's `getViteConfig` helper (`astro/config`) to build the Vitest config, matching how Astro itself recommends testing setup for v6 — this reuses the app's existing `tsconfig.json` path mapping rather than duplicating it. Add `"test": "vitest run"` to `package.json` scripts (used by CI in Phase 7); `vitest` and `@vitest/coverage-v8` (or equivalent) as new devDependencies.

#### 2. Validation tests

**File**: `src/lib/validation/session.test.ts`

**Intent**: Exercise every branch of `buildSetLogSchema`.

**Contract**: Cases: valid reps-tracked input accepted; valid duration-tracked input accepted; reps-tracked input with `duration_seconds` set rejected; reps-tracked input missing `reps` rejected; negative `weight_kg` rejected; missing `exercise_id`/`set_number` rejected.

#### 3. Service tests

**File**: `src/lib/services/session.test.ts`

**Intent**: Verify each service function builds the correct Supabase query/payload and maps the response correctly, without hitting a real database.

**Contract**: Mock `SupabaseClient` with `vi.fn()`-based chainable stubs (`from().select()...`, `.upsert()`, `.delete()`, `.rpc()`). Cover: `upsertSet` calls `.upsert()` with the correct `onConflict` target; `deleteSet` calls `.delete()` filtered by all three key columns and does not throw when zero rows matched; `getLastLoggedSets` maps a list of rows into the `exercise_id → WorkoutSet` record shape, including exercises with no rows mapping to `null`; `createSession` catches a `23505` error object and falls back to calling `getActiveSessionForWorkout`; `restartSession` calls `.rpc("restart_workout_session", ...)` with the three expected params and returns the new id from the response.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run build`

#### Manual Verification:

- N/A — this phase is itself the verification layer

---

## Phase 4: API Routes

### Overview

Three fetch+JSON endpoints (following `src/pages/api/plan.ts`'s convention) that the React islands in Phase 6 call.

### Changes Required:

#### 1. Set upsert route

**File**: `src/pages/api/sessions/[sessionId]/sets.ts`

**Intent**: Validate and persist one set, scoped to the calling user's own session; also delete a set that's been cleared back to invalid, and offer a `sendBeacon`-compatible save path for the navigate-away guard.

**Contract**: `export const prerender = false; export const PUT: APIRoute`. 401 JSON if no `locals.user`. Loads the session via `getSessionWithSets`/an ownership-scoped lookup — 404 JSON if missing or not owned. Looks up the target exercise's `tracking_type` (from the session's workout exercises) to select the right `buildSetLogSchema` variant — 400 JSON with Zod error details on validation failure. Calls `upsertSet`; 200 JSON with the saved `WorkoutSet` on success; 500 JSON on DB error (logged via `console.error` with userId + cause, matching `plan.ts`'s error-logging convention).

Also exports:
- `export const DELETE: APIRoute` — same auth/ownership/validation-of-identifying-fields (`exercise_id`, `set_number`) as `PUT`, calls `deleteSet`, returns 204 regardless of whether a row existed (idempotent).
- `export const POST: APIRoute` — identical body/behavior to `PUT` (same validation, same `upsertSet` call). Exists only because `navigator.sendBeacon` cannot issue `PUT` requests; the navigate-away guard (Critical Implementation Details) targets this handler. Since a beacon request can't read a JSON error response, this handler still returns proper status codes for normal `fetch` callers but the beacon caller ignores the response.

#### 2. Complete route

**File**: `src/pages/api/sessions/[sessionId]/complete.ts`

**Intent**: Mark the session finished.

**Contract**: `export const POST: APIRoute`. Same auth/ownership checks as above; 409 JSON if the session is not currently `active`. Calls `completeSession`; 200 JSON with the updated `WorkoutSession`.

#### 3. Restart route

**File**: `src/pages/api/sessions/[sessionId]/restart.ts`

**Intent**: Back the "Start Over" choice in the resume/restart modal.

**Contract**: `export const POST: APIRoute`. Same auth/ownership checks (the `sessionId` in the URL is the *existing* session being replaced). Calls `restartSession`, then `getSessionWithSets` + `getLastLoggedSets` for the new session; 200 JSON returning `{ session: WorkoutSessionWithSets; lastLoggedSets: LastLoggedSets }` — the full bundle the client needs to hydrate `SessionLogger` without a page reload.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Using a browser dev console or REST client while signed in: `PUT` a valid set, confirm 200 + row appears in Supabase Studio; `PUT` an invalid set (both reps and duration), confirm 400; `POST complete` on someone else's session id, confirm 404 (RLS/ownership check holds); `POST restart` on a session with sets, confirm the old row becomes `abandoned` and a new active row exists
- `DELETE` a previously-saved set, confirm the row disappears in Supabase Studio and a second `DELETE` of the same set (already gone) still returns 204, not an error
- `POST` the same payload as a valid `PUT` call, confirm identical 200 behavior (beacon-path handler parity)

---

## Phase 5: Session Page & Wiring

### Overview

The page that ties everything together, reachable from the dashboard.

### Changes Required:

#### 1. Session page

**File**: `src/pages/session/[workoutId].astro`

**Intent**: SSR get-or-create entry point — resolve the workout and its active session (creating one if none exists), then hand off to the client for any user-decision (resume/restart) or straight into logging.

**Contract**: Frontmatter: auth-check (middleware already covers this once `/session` is added to `PROTECTED_ROUTES`, but the page still needs `Astro.locals.user`/a configured Supabase client to proceed); `getWorkoutWithExercises` — redirect/404 if not found or not owned; `getActiveSessionForWorkout` — if `null`, call `createSession` (`needsChoice = false`); if present, use it as-is (`needsChoice = true`, client shows the resume/restart modal); `getSessionWithSets(session.id)`; `getLastLoggedSets(...)` for all exercise ids in the workout, excluding the current session. Renders `SessionLogger` (`client:load`) with `workout`, `session`, `lastLoggedSets` as props, wrapped by `ResumeRestartModal` when `needsChoice` is true (modal blocks interaction with the logger underneath until resolved).

#### 2. Middleware

**File**: `src/middleware.ts`

**Intent**: Protect the new route the same way `/dashboard` and `/onboarding` are protected.

**Contract**: Add `"/session"` to `PROTECTED_ROUTES` (`src/middleware.ts:5`) and to `PROFILE_REQUIRED_ROUTES` (`src/middleware.ts:6`) — a session can't meaningfully exist without a profile-driven plan.

#### 3. Dashboard plan display

**File**: `src/components/plan/PlanDisplay.astro`

**Intent**: Add the "Start workout" affordance that's been missing since S-02 — the only entry point into this whole feature.

**Contract**: Per workout card, add a link to `/session/${workout.id}` styled as the existing shadcn `Button` (`src/components/ui/button.tsx`), placed so it's reachable in one tap from the dashboard (satisfies the roadmap's 2-tap risk note in combination with the page's own get-or-create landing directly in the logger).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Signed in with an active plan, tapping "Start workout" lands directly in the logging UI with zero intermediate screens (first-launch case)
- Visiting the same URL again (session still active) shows the resume/restart modal instead of silently creating a duplicate
- Signing out and requesting `/session/<any-id>` directly redirects to `/auth/signin`
- Requesting another user's workout id returns a 404/redirect, not their data

---

## Phase 6: React Islands

### Overview

The interactive logging UI: resume/restart choice, per-exercise set rows with debounced autosave, and the finish action.

### Changes Required:

#### 1. shadcn components

**Intent**: This feature's forms need inputs, labels, and card layout, and only `Button` exists today.

**Contract**: `npx shadcn@latest add input card label`, landing in `src/components/ui/` per the new-york variant already configured (per `AGENTS.md`).

#### 2. Resume/restart modal

**File**: `src/components/session/ResumeRestartModal.tsx`

**Intent**: Block interaction with an already-active session until the user explicitly chooses to resume or start over.

**Contract**: React island, `client:load`. Props: workout name, existing session summary (`started_at`, count of already-logged sets), `onResume: () => void`, and enough context to call `POST /api/sessions/[sessionId]/restart`. "Resume" calls `onResume` (parent reveals the logger with the existing session, no network call needed). "Start Over" calls the restart endpoint, then passes the response's `{session, lastLoggedSets}` up to replace the parent's state before revealing the logger.

#### 3. Session logger

**File**: `src/components/session/SessionLogger.tsx`

**Intent**: Own the session-level state: which sets exist per exercise, the finish action, and the total-autosave-failure banner (per the Q8 decision — silent per-set autosave, banner only on repeated failure).

**Contract**: Renders one card per `workout.exercises` entry (ordered by `position`), each containing its already-logged `SetRow`s plus one open row for the next `set_number`. Holds a `failedSaves` counter/set surfaced as a dismissible page-level banner when a `SetRow` reports an exhausted retry (see Phase 6.4). Also owns the navigate-away guard from Critical Implementation Details: a shared `pendingSaves` counter (incremented when any `SetRow` arms its debounce timer or has a request in flight, decremented on settle) read by a `beforeunload` listener registered once at this level — on unload with `pendingSaves > 0`, fires a `sendBeacon` to `POST /api/sessions/[sessionId]/sets` for every currently-pending row's latest values, and triggers the native "leave site?" confirmation. "Finish workout" button always enabled; calls `POST /api/sessions/[sessionId]/complete`, then `Astro.navigate`/`window.location` redirect to `/dashboard`.

#### 4. Set row

**File**: `src/components/session/SetRow.tsx`

**Intent**: The autosave unit — the component most directly implementing the Q2/Q7/Q3 decisions (debounced autosave once both fields are valid, pre-filled from last session, silent on success) plus the clear-to-delete behavior from Critical Implementation Details.

**Contract**: Controlled inputs for `reps`-or-`duration_seconds` (per the exercise's `tracking_type`) and `weight_kg`, initialized from `lastLoggedSets[exercise_id]` when this is a not-yet-logged row. Debounces ~600ms after the last keystroke; fires `PUT /api/sessions/[sessionId]/sets` only once both required fields hold valid values (partial input does not save, per the Q7 decision); further edits re-fire the same debounce as an upsert (same `set_number`); reports pending/settled state to `SessionLogger`'s `pendingSaves` counter for the navigate-away guard. On failure, retries automatically up to 3 times with exponential backoff (increased from the original single-retry design specifically to shrink the silent-autosave data-loss window, since there's no per-row error UI to fall back on); if all retries are exhausted, keeps the typed values in place (never clears user input) and calls a parent-supplied `onSaveFailed` callback (feeds `SessionLogger`'s banner) rather than showing per-row error UI, per the Q8 decision. Tracks a `hasSaved` flag; if the row transitions from valid (has saved at least once) to invalid (a required field cleared), calls `DELETE /api/sessions/[sessionId]/sets` for that `(exercise_id, set_number)` instead of doing nothing — a row that was cleared before ever reaching a valid, saved state makes no API call.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Unit tests (debounce/upsert-trigger logic, if extracted into a testable helper) pass: `npm run test`

#### Manual Verification:

- Log a set (enter reps + weight), wait past the debounce, reload the page — the value persists (confirms real autosave, not just local state)
- Edit an already-logged set's weight — the row upserts (same `set_number`, updated value) rather than creating a duplicate row
- Start a fresh workout with no prior history for its exercises — inputs start blank, not pre-filled
- Start a workout for an exercise logged before — inputs pre-fill with the last logged reps/weight
- Disconnect network (devtools offline), attempt a save, confirm the banner appears only after all 3 retries are exhausted and the typed values are still visible in the input
- Log a valid set, then clear its weight field back to empty — the previously-saved row is deleted (confirm via reload: the field is blank, not stale)
- Fill a set's fields partway (never valid), then clear them — confirm no DELETE call fires (nothing was ever saved)
- Log a set, then attempt to close/reload the tab while a debounced save is still pending (type a value and immediately try to navigate away within the debounce window) — confirm the native "leave site?" prompt appears
- Tap "Finish workout" with zero sets logged — session completes without error, redirects to dashboard
- Confirm the full launch → log → finish path takes at most two taps from the dashboard to the first set input (NFR from roadmap S-03 risk note)

---

## Phase 7: Playwright E2E & CI Wiring

### Overview

One end-to-end happy-path test proving the whole flow works against a real (local) Supabase instance, running in CI.

### Changes Required:

#### 1. Playwright setup

**File**: `playwright.config.ts`, `package.json`

**Intent**: Install and configure Playwright against the local dev server.

**Contract**: `@playwright/test` as a new devDependency; config points `baseURL` at `npm run dev`'s local address, launches the dev server as part of the test run (`webServer` option). Add `"test:e2e": "playwright test"` to `package.json` scripts.

#### 2. Seed fixture

**File**: `tests/e2e/fixtures/seed.ts`

**Intent**: Get a known user + profile + plan into the local Supabase instance without going through the full signup/onboarding/AI-generation UI (out of scope to re-drive here; those flows have their own coverage from S-01/S-02).

**Contract**: Uses the Supabase service-role key (local dev key only, read from an env var never used by app code) to directly insert: one `auth.users` row (or use the Supabase admin API's user-creation call), one `user_profiles` row, one `workouts` + `workout_exercises` + `user_plan` row set. Run before the E2E spec via Playwright's `globalSetup`.

#### 3. Happy-path spec

**File**: `tests/e2e/workout-session.spec.ts`

**Intent**: Drive the actual north-star flow through the browser.

**Contract**: Log in as the seeded user → land on dashboard → tap "Start workout" → confirm the session page loads directly into the logger (no intermediate screen, since no active session exists yet) → log a set for the first exercise → reload the page → assert the logged value is still shown (proves autosave persisted, not just local state) → tap "Finish workout" → assert redirect to dashboard.

#### 4. CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Run the new test suites on every push/PR, matching the existing job's structure.

**Contract**: In the `ci` job, after `npm run lint` and before `npm run build`: add `npm run test` (Vitest — no external services needed). Add a new step sequence for E2E: `supabase/setup-cli@v1`, `supabase start` (spins up local Postgres + auth + PostgREST in Docker, applies all migrations automatically), run the seed fixture, `npx playwright install --with-deps`, `npm run test:e2e`, then `supabase stop` in an `if: always()` cleanup step. E2E env vars (`SUPABASE_URL`/`SUPABASE_KEY`/service-role key) point at the local instance `supabase start` prints, not the `secrets.SUPABASE_URL`/`SUPABASE_KEY` used by the `build` step (those remain the hosted-project secrets).

### Success Criteria:

#### Automated Verification:

- Vitest suite passes in CI: `npm run test`
- Playwright E2E suite passes in CI: `npm run test:e2e`
- Full CI job (lint, test, build) is green on the PR

#### Manual Verification:

- Run `npm run test:e2e` locally against a freshly-started `npx supabase start` and confirm it passes before relying on CI alone
- Intentionally break the autosave endpoint locally, confirm the E2E test fails (proves the test isn't a false positive)

---

## Testing Strategy

### Unit Tests:

- Every branch of `buildSetLogSchema` (Phase 3.2)
- Service function query construction and response mapping against a mocked Supabase client (Phase 3.3), especially the `23505` race-fallback in `createSession`, the record-mapping in `getLastLoggedSets`, and `deleteSet`'s no-op-on-missing-row behavior

### Integration Tests:

- The `restart_workout_session` RPC's delete-vs-abandon branching is exercised indirectly by the Playwright E2E setup/fixtures hitting a real Postgres instance — no separate pgTAP suite is introduced for this MVP slice

### Manual Testing Steps:

1. Full happy path: dashboard → start workout → log several sets across multiple exercises → finish → confirm redirect
2. Resume path: start a workout, log one set, navigate away without finishing, return to the same workout → confirm the resume/restart modal appears, "Resume" shows the previously-logged set
3. Restart path: from the same modal, "Start Over" on a session with a logged set → confirm the old session is preserved (visible only via direct DB inspection, no history UI yet) and a fresh empty logger appears
4. Restart-with-no-sets path: start a workout, immediately trigger a second launch (e.g. duplicate tab) before logging anything, choose "Start Over" → confirm the empty session was deleted, not left as an orphaned `abandoned` row
5. Cross-user isolation: attempt to reach another user's session URL directly → confirm rejection
6. Clear-to-delete: log a valid set, clear a required field back to empty → confirm the persisted row is deleted, not left stale
7. Navigate-away guard: start typing a set, try to close the tab before the debounce fires → confirm the native "leave site?" prompt appears

## Performance Considerations

`idx_workout_sets_exercise_logged` keeps the pre-fill lookup (Phase 1) cheap even as sets accumulate. All other queries in this feature are single-row or small-set lookups scoped by primary/foreign keys already indexed by F-01 — no additional indexing is expected to be needed at the PRD's stated "small" target scale.

## Migration Notes

Purely additive: a new CHECK constraint (only rejects rows that were already invalid per the app-layer contract — no existing `workout_sets` rows exist yet since this table has never been written to), a new index, and a new RPC function. No backfill needed.

## References

- Related roadmap entry: `context/foundation/roadmap.md` (S-03, "workout-session-logging")
- Related GitHub issue: `#5` (`context/foundation/tasks-github.md`)
- Prior slice conventions: `context/archive/2026-07-10-ai-plan-generation/plan.md`, `context/archive/2026-07-08-onboarding-survey/plan.md`
- Similar fetch+JSON API route: `src/pages/api/plan.ts:1-61`
- Similar nested-select service query: `src/lib/services/plan.ts:178-210`
- Similar atomic-RPC precedent: `supabase/migrations/20260710120000_save_generated_training_plan_rpc.sql`, `supabase/migrations/20260714000000_add_advisory_lock_to_plan_rpc.sql`
- Similar DB-level XOR check precedent: `supabase/migrations/20260714000001_workout_exercises_tracking_xor_check.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database

#### Automated

- [x] 1.1 Migration applies cleanly — 93299e6
- [x] 1.2 Table grants still cover workout_sets/workout_sessions for authenticated — 93299e6
- [x] 1.3 npm run build still passes — 93299e6

#### Manual

- [x] 1.4 CHECK constraint rejects both-set and neither-set workout_sets rows — db68d44
- [x] 1.5 restart_workout_session RPC delete-vs-abandon branching verified manually — db68d44

### Phase 2: Service & Validation Layer

#### Automated

- [x] 2.1 Type checking passes — 93c70c5
- [x] 2.2 Linting passes — 93c70c5

### Phase 3: Vitest Setup & Unit Tests

#### Automated

- [x] 3.1 Unit tests pass — 00ede65
- [x] 3.2 Linting passes — 00ede65
- [x] 3.3 Type checking passes — 00ede65

### Phase 4: API Routes

#### Automated

- [x] 4.1 Type checking passes — 4f88d4c
- [x] 4.2 Linting passes — 4f88d4c

#### Manual

- [x] 4.3 PUT set endpoint: valid set 200s, invalid set 400s
- [x] 4.4 Complete endpoint: cross-user access returns 404
- [x] 4.5 Restart endpoint: old session abandoned, new active session created
- [x] 4.6 DELETE set endpoint: removes row, idempotent on repeat
- [x] 4.7 POST beacon-alias handler: parity with PUT

### Phase 5: Session Page & Wiring

#### Automated

- [x] 5.1 Type checking passes — 3f569fe
- [x] 5.2 Linting passes — 3f569fe

#### Manual

- [x] 5.3 First launch lands directly in logging UI (zero intermediate screens)
- [x] 5.4 Second visit to an active session shows resume/restart modal
- [x] 5.5 Signed-out access to /session/* redirects to signin
- [x] 5.6 Cross-user workout id access rejected

### Phase 6: React Islands

#### Automated

- [x] 6.1 Type checking passes — 7c43f40
- [x] 6.2 Linting passes — 7c43f40
- [x] 6.3 Unit tests pass (if debounce logic is extracted) — N/A (kept inline in SetRow.tsx; no component-testing harness in this repo)

#### Manual

- [x] 6.4 Logged set persists after reload (real autosave, not local state)
- [x] 6.5 Editing a logged set upserts rather than duplicating
- [x] 6.6 Fresh exercise starts blank; previously-logged exercise pre-fills
- [x] 6.7 Offline save failure shows banner only after all 3 retries exhausted, input values preserved
- [x] 6.8 Clearing a saved field deletes the persisted row; clearing a never-saved field makes no API call
- [x] 6.9 Native "leave site?" prompt appears when navigating away with a pending debounced save
- [x] 6.10 Finish with zero sets logged succeeds and redirects
- [x] 6.11 Full dashboard-to-first-input path confirmed at most two taps

### Phase 7: Playwright E2E & CI Wiring

#### Automated

- [x] 7.1 Vitest suite passes in CI
- [x] 7.2 Playwright E2E suite passes in CI
- [x] 7.3 Full CI job green on the PR

#### Manual

- [x] 7.4 test:e2e passes locally against a fresh supabase start — db68d44
- [x] 7.5 Intentionally broken autosave endpoint causes the E2E test to fail (not a false positive) — db68d44
