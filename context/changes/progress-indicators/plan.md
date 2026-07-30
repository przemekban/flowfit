# Progress Indicators (FR-012 / S-05) Implementation Plan

## Overview

Implement FR-012: an inline "Improved" signal per exercise, comparing the current best result against the most recent previous session containing that exercise. The signal appears in two places — the history screen (newest session only) and the active workout session screen (live, as sets are logged) — backed by a single new Postgres RPC and a pure, tracking-type-aware comparison function shared by both screens.

## Current State Analysis

Both target screens are SSR-first Astro pages with no client-facing read API. `history.astro` renders a flat, non-grouped list of sets per session (`src/pages/history.astro:105-113`). `session/[workoutId].astro` hydrates a single React island, `SessionLogger`, which owns session-level state but does not currently track live per-row saved values — `SetRow` keeps its typed weight/reps locally and only reports upward via a one-shot `onSaved()` callback (used solely to reveal the next empty row) and a transient `onPendingChange()` used only for the `beforeunload` flush.

The existing `getLastLoggedSets`/`latest_workout_sets` view (`src/lib/services/session.ts:225-256`) is a single globally-latest-set lookup used for placeholder pre-fill text; it does not aggregate a session's best value and does not generalize to "the session before an arbitrary reference session," so it cannot be reused for this feature.

## Desired End State

- On `/history`, page 1's topmost (most recent) session shows an "Improved" badge next to any exercise whose best value in that session strictly exceeds its best value in the most recent prior session (completed or abandoned) containing that exercise. Older sessions (page 2+) never show this badge.
- On `/session/[workoutId]`, each exercise card shows the same badge, updating live (no reload) as the user logs sets, comparing the current session's best-so-far against the most recent prior finished session for that exercise.
- Weight-tracked (`reps`) exercises compare best `weight_kg`; duration-tracked exercises compare best `duration_seconds`. A tie, or a missing value on either side (first-time exercise, all-null weight), shows no badge — never a false positive.
- Verified by: automated unit tests (comparison logic), an integration test (the new RPC, real Postgres), and manual/e2e click-through of both screens.

### Key Discoveries:

- `core_schema.sql:160-161` — `idx_workout_sessions_user_status (user_id, status)` and `idx_workout_sessions_user_completed (user_id, completed_at DESC)` already cover the new RPC's filter (`user_id` + `status IN (...)`); no new index needed.
- `workout_sets_tracking_xor` (`20260724110000_workout_session_logging_support.sql:12-16`) only constrains `reps` XOR `duration_seconds` — `weight_kg` is independent and nullable regardless of `tracking_type`, so a duration-tracked exercise can have a non-null `weight_kg` (e.g. a weighted carry). The comparison must select the metric by `tracking_type`, never by "which field happens to be non-null."
- `restart_workout_session` (`20260724130000_restart_workout_session_race_fix.sql`) is the RPC precedent: `SECURITY INVOKER`, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated`.
- `SetRow.tsx:93-96` — `onSaved()` fires only once per row (`hasFiredOnSavedRef`), by design, to drive "reveal next row." It cannot be reused for live aggregation; a new callback is needed that fires on every successful save and on delete.
- `playwright.config.ts:6-13` documents that all e2e specs share one seeded workout/session serially by design ("cost×signal call is a single north-star flow, not a suite that needs isolation") — a third spec must not add a second implicit dependency on that same shared workout; it needs its own seeded workout.
- `test-plan.md` §6.1/§6.2/§6.6 — exact unit/integration test conventions (hand-mocked query builder, `two-users` fixture, `seedSession`/`seedSet` helpers) to extend rather than reinvent.

## What We're NOT Doing

- No badge on history sessions other than the single newest one (page 1, first item) — older sessions never show a comparison, by explicit decision.
- No live update of the *previous*-session baseline during an active session — `previousBests` is fetched once at page load; only the current session's own aggregate updates live.
- No new shadcn/ui `Badge` component — reuses the existing inline pill `<span>` convention already used for Completed/Abandoned.
- No "New exercise" / first-time indicator — exercises with no valid prior comparison render nothing.
- No volume-based or rep-normalized ("estimated 1RM") comparison metric — single best value only (`MAX(weight_kg)` or `MAX(duration_seconds)`), selected by `tracking_type`.
- No changes to `latest_workout_sets` or `getLastLoggedSets` — the pre-fill placeholder feature is untouched.
- No backfill or recomputation of historical pages beyond the newest session.

## Implementation Approach

A single Postgres RPC (`get_previous_exercise_bests`) returns, per exercise, the aggregated best value from the most recent prior completed/abandoned session, given a reference session to exclude — reused identically by both screens (history passes the newest session's id; the active session page passes its own, still-active, session id). A pure `computeImprovements` function (tracking-type-aware, strict `>`, null-safe) is the single source of truth for "improved," unit-tested once and consumed by both an SSR code path (history) and a client-side live code path (active session).

## Critical Implementation Details

- **State sequencing (Phase 4)**: `SetRow`'s existing `onSaved()` is a one-shot flag gated by `hasFiredOnSavedRef` and cannot double as the live-aggregation signal. The new `onValueSaved` callback must fire unconditionally on every successful `persist()` (with the payload) and on every successful `deletePersisted()` (with `null`), so `SessionLogger`'s live aggregate never goes stale after an edit or a cleared row.
- **User experience spec (Phase 3)**: `history.astro`'s set list is flat and not grouped by exercise (`session.sets.map(...)`, ordered by `set_number`, not by exercise). Track already-badged exercise ids per session while rendering so the badge appears once, on that exercise's first row, not once per set.
- **Timing & lifecycle (Phase 4 e2e test)**: because all existing e2e specs deliberately share one seeded workout/session serially (`playwright.config.ts:6-13`), the new spec must seed its own second, independent workout (with its own prior completed session) in `tests/e2e/fixtures/seed.ts`, rather than depending on run order relative to the other two specs.

## Phase 1: Database — cross-session exercise-bests RPC

### Overview

Add a Postgres RPC that returns each exercise's best aggregated value from the most recent prior completed/abandoned session, excluding a given reference session. This is the single data source both screens will use.

### Changes Required:

#### 1. New RPC migration

**File**: `supabase/migrations/20260730120000_exercise_progress_rpc.sql`

**Intent**: Given a set of exercise ids and a session id to exclude, return one row per exercise for the most recent completed/abandoned session (other than the excluded one) that logged it, with that session's best `weight_kg` and best `duration_seconds`. Exercises with no qualifying prior session are simply absent from the result (matches the existing `getLastLoggedSets` convention of a null-filled map built by the service layer).

**Contract**: `get_previous_exercise_bests(p_exercise_ids uuid[], p_before_session_id uuid) RETURNS TABLE (exercise_id uuid, best_weight_kg decimal(6,2), best_duration_seconds smallint)`. Filters by `auth.uid()` directly instead of taking a `p_user_id` parameter — there is no caller-supplied user id to mismatch, so this has no IDOR surface to guard (unlike `restart_workout_session`, a write RPC that must verify `p_user_id = auth.uid()`). `LANGUAGE sql STABLE` (a single query, no control flow — unlike the `plpgsql` write RPCs), `SECURITY INVOKER`, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated` matching the `restart_workout_session` precedent. Ranking uses a window function per the query-shape decision:

```sql
CREATE OR REPLACE FUNCTION get_previous_exercise_bests(p_exercise_ids uuid[], p_before_session_id uuid)
RETURNS TABLE (exercise_id uuid, best_weight_kg decimal(6,2), best_duration_seconds smallint)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH ranked AS (
    SELECT
      ws.exercise_id,
      s.id AS session_id,
      MAX(ws.weight_kg) AS best_weight_kg,
      MAX(ws.duration_seconds) AS best_duration_seconds,
      ROW_NUMBER() OVER (
        PARTITION BY ws.exercise_id
        ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
      ) AS rn
    FROM workout_sets ws
    JOIN workout_sessions s ON s.id = ws.workout_session_id
    WHERE s.user_id = auth.uid()
      AND s.status IN ('completed', 'abandoned')
      AND s.id <> p_before_session_id
      AND ws.exercise_id = ANY(p_exercise_ids)
    GROUP BY ws.exercise_id, s.id, s.completed_at, s.started_at
  )
  SELECT exercise_id, best_weight_kg, best_duration_seconds
  FROM ranked
  WHERE rn = 1;
$$;

REVOKE ALL ON FUNCTION get_previous_exercise_bests(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_previous_exercise_bests(uuid[], uuid) TO authenticated;
```

The `s.id <> p_before_session_id` exclusion means the same function serves both call sites: history passes the newest session's own id (excluding itself so only strictly-earlier sessions rank); the active session page passes its own (not-yet-completed) session id, which is a no-op exclusion since an active session never matches `status IN ('completed','abandoned')` anyway.

#### 2. Integration test extending the `two-users` fixture

**File**: `tests/integration/exercise-progress-rpc.test.ts`

**Intent**: Prove the RPC's correctness against a real Postgres instance, per `test-plan.md`'s rule that logic living inside a SQL function body can't be hermetically mocked. Extend `tests/integration/fixtures/two-users.ts`'s `SeedSetParams`/`seedSet` with an optional `durationSeconds` field so duration-tracked fixtures can be seeded; look up a `tracking_type = 'duration'` exercise id directly via the admin client within the test (no change to `seedUser` needed).

**Contract**: One `describe` block, mirroring `workout-history-rls.test.ts`'s structure. Cases: returns the previous session's best weight for a reps-tracked exercise; returns nothing for an exercise with no prior completed/abandoned session; excludes the `p_before_session_id` session from consideration; picks the most recent of several qualifying prior sessions; returns best duration for a duration-tracked exercise; includes abandoned (not just completed) sessions in the comparison pool; a control case proving the RPC only ever reads the calling user's own sessions regardless of the arguments passed (since filtering is via `auth.uid()`, not a caller-supplied id).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase migration up`
- Integration tests pass: `npm run test:integration`
- Linting passes: `npm run lint`

#### Manual Verification:

- Run the RPC directly against the local Supabase instance (Studio SQL editor or `psql`) for a manually-verified scenario and confirm the returned best values match hand-calculation.

---

## Phase 2: Comparison logic & service layer

### Overview

Add the pure, tracking-type-aware comparison logic and the service-layer wrapper around the new RPC, fully unit-tested with no database dependency. Both screens (Phase 3, Phase 4) consume these functions rather than each re-implementing the comparison.

### Changes Required:

#### 1. New types

**File**: `src/types.ts`

**Intent**: Name the shapes shared between the RPC wrapper, the pure aggregation/comparison functions, and both UI call sites.

**Contract**: Add `PreviousExerciseBest = { best_weight_kg: number | null; best_duration_seconds: number | null }`, `ExerciseBestsMap = Record<string, PreviousExerciseBest | null>` (used for both "previous" and "current" bests — same shape), and `ExerciseImprovementMap = Record<string, boolean>`.

#### 2. New service module

**File**: `src/lib/services/exercise-progress.ts`

**Intent**: Separate this feature's pure logic from its one I/O call, following the project's existing split between pure business-rule files (`plan.ts`) and I/O-bound service files (`session.ts`, `profile.ts`) noted in `test-plan.md` §6.6.

**Contract**:
- `getPreviousExerciseBests(supabase, exerciseIds: string[], beforeSessionId: string): Promise<ExerciseBestsMap>` — calls `supabase.rpc("get_previous_exercise_bests", { p_exercise_ids: exerciseIds, p_before_session_id: beforeSessionId })`, builds a null-filled record keyed by every id in `exerciseIds` before overwriting with returned rows, exactly mirroring `getLastLoggedSets`'s existing convention (`src/lib/services/session.ts:225-256`). Empty `exerciseIds` short-circuits to `{}` without calling the RPC, also mirroring `getLastLoggedSets`.
- `aggregateSessionBests(sets: { exercise_id: string; weight_kg: number | null; duration_seconds: number | null }[]): ExerciseBestsMap` — pure, groups by `exercise_id`, taking `MAX` of each field independently (both fields are computed regardless of tracking type; the caller selects which one matters). Works identically for a full session's `WorkoutSet[]` (history) and a client-accumulated live array (active session), since both satisfy the same minimal shape.
- `computeImprovements(currentBests: ExerciseBestsMap, previousBests: ExerciseBestsMap, trackingByExercise: Record<string, TrackingType>): ExerciseImprovementMap` — pure. For each exercise present in `trackingByExercise`, selects `best_weight_kg` when `tracking_type === "reps"` or `best_duration_seconds` when `"duration"` from both maps; result is `true` only when both values are non-null and `current > previous` (strict, per the tie-handling decision); otherwise `false`/absent. This is the single place the "weight_kg can be non-null on a duration-tracked exercise" gotcha (see Critical Implementation Details) is resolved — by keying off `trackingByExercise`, never off which field happens to be populated.

#### 3. Unit tests

**File**: `src/lib/services/exercise-progress.test.ts`

**Intent**: Cover the pure functions with hand-built fixtures (no Supabase mock needed) per the `plan.test.ts` cookbook pattern, and the RPC wrapper with the existing direct-`rpc`-mock convention from `session.test.ts`.

**Contract**: Cases include — `getPreviousExerciseBests` returns `{}` without calling `.rpc()` for an empty id list; maps returned rows into a null-filled record for ids with no match. `aggregateSessionBests` picks the max across multiple sets of the same exercise (weight and duration independently); an all-null-weight (bodyweight) exercise yields `best_weight_kg: null`; empty input yields `{}`. `computeImprovements`: strictly-greater weight → `true`; equal weight (tie) → `false`; lower weight → `false`; either side `null` → `false`; a duration-tracked exercise compares `best_duration_seconds` only, ignoring a populated `best_weight_kg` on either side (the weighted-duration-exercise edge case).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Linting (type-checked) passes: `npm run lint`

---

## Phase 3: History screen integration

### Overview

Show the "Improved" badge on `/history`'s newest session only (page 1, first item), computed server-side and rendered inline.

### Changes Required:

#### 1. `history.astro` — compute and render badges for the newest session

**File**: `src/pages/history.astro`

**Intent**: When rendering page 1 (`offset === 0`) and at least one session exists, compute improvements for `sessions[0]` using Phase 2's functions and render the existing pill-badge convention next to that exercise's first set row.

**Contract**: After the existing `getWorkoutSessionHistory` call, when `offset === 0 && sessions.length > 0`: derive `exerciseIds` and a `trackingByExercise` map from `sessions[0].sets` (each set already carries its joined `exercise`), call `getPreviousExerciseBests(supabase, exerciseIds, sessions[0].id)`, compute `currentBests = aggregateSessionBests(sessions[0].sets)`, then `improvements = computeImprovements(currentBests, previousBests, trackingByExercise)`. In the template, only for `sessions[0]` (compare by `session.id === sessions[0]?.id`, itself gated on `offset === 0`), track already-badged exercise ids while iterating `session.sets` so the badge renders once, on the first row for that exercise (see Critical Implementation Details — User experience spec). Badge markup reuses the 3-part pill recipe with a color distinct from the existing green "Completed" / amber "Abandoned" badges (e.g. sky), labeled "Improved".

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- With a seeded exercise whose best value improved between the two most recent sessions, visit `/history` page 1 — confirm the badge appears exactly once, on that exercise's first row.
- Visit `/history` page 2 (older sessions) — confirm no badge appears anywhere on that page.
- Confirm an exercise appearing for the first time in the newest session (no prior session) shows no badge.
- Confirm an exercise whose value tied its prior best shows no badge (strict `>` rule).

---

## Phase 4: Active session integration (live)

### Overview

Show the same badge on the active workout session screen, updating live as the user logs sets, by lifting per-row saved values up into `SessionLogger` and comparing against the previous session's bests fetched once at page load.

### Changes Required:

#### 1. Fetch `previousBests` at session page load

**File**: `src/pages/session/[workoutId].astro`

**Intent**: Fetch the comparison baseline once, alongside the existing `lastLoggedSets` fetch, and pass it down as a prop.

**Contract**: After the existing `exerciseIds` computation, add `const previousBests = await getPreviousExerciseBests(supabase, exerciseIds, session.id);` and pass `previousBests={previousBests}` to `<SessionLogger />`.

#### 2. `SetRow` reports every save/delete, not just the first

**File**: `src/components/session/SetRow.tsx`

**Intent**: Add the callback `SessionLogger` needs to keep a live, accurate aggregate — see Critical Implementation Details (State sequencing) for why the existing `onSaved` cannot be reused.

**Contract**: New prop `onValueSaved: (rowKey: string, exerciseId: string, payload: PendingSetPayload | null) => void`. Called with `payload` immediately after every successful `persist()` (unconditionally, unlike the once-only `onSaved()`), and called with `null` from `deletePersisted()` after a successful delete.

#### 3. `SessionLogger` lifts saved values and derives live improvements

**File**: `src/components/session/SessionLogger.tsx`

**Intent**: Maintain a live map of each row's last-saved weight/duration, derive the current session's per-exercise bests from it, and compute improvements against the `previousBests` prop — recomputed on every save/delete, reset on restart.

**Contract**: New prop `previousBests: ExerciseBestsMap`. New state `savedValues: Record<rowKey, { exerciseId: string; weightKg: number | null; durationSeconds: number | null }>`, initialized from `session.sets` (so a resumed session shows correct badges immediately, not only after a new save) via an `initialSavedValues(session)` helper mirroring the existing `initialOpenCounts` pattern, and cleared/reinitialized in `handleRestarted` alongside `pendingRef`/`failedSaves`. `handleValueSaved` (passed to each `SetRow` as `onValueSaved`) updates or deletes the row's entry. `currentBests` and `improvements` are derived via `useMemo` using Phase 2's `aggregateSessionBests`/`computeImprovements`, keyed by a `trackingByExercise` map built from `workout.exercises`. Render the badge in each exercise's `CardHeader`, next to `CardTitle`, when `improvements[we.exercise_id]` is `true` — same pill styling as Phase 3.

#### 4. E2e test with an isolated seeded workout

**File**: `tests/e2e/fixtures/seed.ts`, `tests/e2e/progress-indicator.spec.ts`

**Intent**: Prove the live badge end-to-end without depending on the other two specs' shared workout/session (see Critical Implementation Details — Timing & lifecycle).

**Contract**: Extend `seed.ts`'s global setup to also create a second workout (its own `workout_exercises` entry and `user_plan` row at `position: 2`) for the same seeded test user, plus one prior `completed` `workout_sessions` row with a known logged best value for that workout's exercise. The new spec signs in as the shared test user, locates and starts this second workout specifically (by name), logs a value above the seeded prior best for the relevant set, and asserts the "Improved" badge becomes visible without a page reload.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`
- E2e test passes: `npx playwright test progress-indicator`

#### Manual Verification:

- Start a fresh session for a workout with a prior completed session; log a value at or below the prior best — confirm no badge appears.
- Log a value above the prior best — confirm the badge appears immediately, without reloading.
- Edit that value back down below the prior best — confirm the badge disappears live.
- Reload and resume mid-session — confirm badge state is correctly restored from already-saved sets (`initialSavedValues`), not only from sets saved after the reload.

---

## Testing Strategy

### Unit Tests:

- `src/lib/services/exercise-progress.test.ts` — pure aggregation/comparison logic (Phase 2), plus the RPC-wrapper mapping behavior with a mocked `.rpc()` call.

### Integration Tests:

- `tests/integration/exercise-progress-rpc.test.ts` — the new RPC against real Postgres: correctness across tracking types, session-exclusion, most-recent-of-several selection, completed+abandoned inclusion, and the auth.uid()-scoping control case (Phase 1).

### Manual Testing Steps:

1. Seed or manually create two completed sessions for the same workout/exercise with an increasing weight; confirm the history badge appears once on the newer session (page 1 only).
2. Start a new session for that workout; log a value above the prior best; confirm the live badge appears without reload.
3. Page through to `/history?page=2`; confirm no badges appear there.
4. Confirm a duration-tracked exercise's badge is driven by `duration_seconds`, not by any stray `weight_kg` value.

## Performance Considerations

The RPC's `WHERE` clause (`user_id` + `status IN (...)` + `exercise_id = ANY(...)`) is fully covered by existing indices (`idx_workout_sessions_user_status`, `idx_workout_sets_session`, `idx_workout_sets_exercise_logged`); no new index is added. Both call sites invoke the RPC once per page load (history: only on page 1; session: once at session start) — no N+1 pattern, and no per-set-save network call, since live updates on the active session screen are computed entirely client-side from data already fetched.

## Migration Notes

Purely additive — one new RPC, no table/column changes, no backfill required. Existing rows are unaffected; the RPC computes its result on demand from existing `workout_sessions`/`workout_sets` data.

## References

- Research: `context/changes/progress-indicators/research.md`
- RPC precedent: `supabase/migrations/20260724130000_restart_workout_session_race_fix.sql`
- Null-filled-map precedent: `src/lib/services/session.ts:225-256` (`getLastLoggedSets`)
- History query precedent: `src/lib/services/session.ts:186-223` (`getWorkoutSessionHistory`)
- Integration fixture: `tests/integration/fixtures/two-users.ts`, `tests/integration/workout-history-rls.test.ts`
- e2e fixture/spec precedent: `tests/e2e/fixtures/seed.ts`, `tests/e2e/workout-session.spec.ts`, `playwright.config.ts:6-13`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — cross-session exercise-bests RPC

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase migration up` — 9951649
- [x] 1.2 Integration tests pass: `npm run test:integration` — 9951649
- [x] 1.3 Linting passes: `npm run lint` — 9951649

#### Manual

- [ ] 1.4 RPC verified directly against local Supabase for a hand-verified scenario

### Phase 2: Comparison logic & service layer

#### Automated

- [x] 2.1 Unit tests pass: `npm run test` — 91f5581
- [x] 2.2 Linting (type-checked) passes: `npm run lint` — 91f5581

### Phase 3: History screen integration

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`

#### Manual

- [ ] 3.3 Badge appears once, on the newest session's improved exercise's first row
- [ ] 3.4 No badge on page 2 (older sessions)
- [ ] 3.5 First-time exercise (no prior session) shows no badge
- [ ] 3.6 Tied value shows no badge

### Phase 4: Active session integration (live)

#### Automated

- [ ] 4.1 Linting passes: `npm run lint`
- [ ] 4.2 Build passes: `npm run build`
- [ ] 4.3 E2e test passes: `npx playwright test progress-indicator`

#### Manual

- [ ] 4.4 No badge when logged value is at or below the prior best
- [ ] 4.5 Badge appears immediately (no reload) when value exceeds the prior best
- [ ] 4.6 Badge disappears live when the value is edited back down
- [ ] 4.7 Badge state correctly restored on reload/resume mid-session
