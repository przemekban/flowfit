# Critical-Path Data Integrity Test Rollout (Phase 2) Implementation Plan

## Overview

This is rollout Phase 2 of `context/foundation/test-plan.md` §3, covering Risk #3 (session-logging autosave data loss) and Risk #5 (`profile.ts`/`plan.ts` regressions). Research (`research.md`) already resolved the oracle for both risks: the DB write path is atomic for both areas, so the real risk surface is (a) client-side retry/debounce/silent-failure UX for Risk #3, and (b) a handful of zero-coverage pure functions and edge-case branches for Risk #5. This plan closes those gaps with the cheapest test that gives a real signal, per the project's cost×signal principle, and does not chase full coverage.

## Current State Analysis

- **Risk #3 (autosave)**: `SetRow.tsx` → `PUT /api/sessions/[sessionId]/sets` → `upsertSet` → `workout_sets` (single upsert, no partial-write branch). Existing coverage: `session.test.ts` covers `upsertSet`'s happy path only (no error branch); `sets.test.ts` covers only `401`/`400` (non-UUID) for `PUT`/`DELETE`; one e2e happy-path spec. No component-testing tooling exists (`vitest.config.ts` runs `environment: "node"`, no `@testing-library/react`). Two CRITICAL/high-severity races were found and fixed during Phase 1 impl-review with zero regression coverage: the `opQueueRef` client-side save/delete race (`SetRow.tsx:54,58-60`) and the `restart_workout_session` double-click race (fixed entirely inside the RPC, `20260724130000_restart_workout_session_race_fix.sql`).
- **Risk #5 (profile/plan)**: `profile.ts` (`src/lib/services/profile.ts`) is 100% I/O-bound — three thin Supabase wrappers, zero test coverage. `plan.ts` has two pure, business-rule-bearing functions with zero coverage: the narrow-equipment guard (`plan.ts:74-78`, throws before any Gemini call) and `validatePlanAgainstCandidates` (`plan.ts:133-169`). The mid-flow-reset race (a concurrent profile reset invalidating an in-flight plan generation) is mitigated by `save_generated_training_plan`'s own re-check (`reset_rpc_hardening.sql:100-102`, raises `profile_missing`, mapped to a `409` in `api/plan.ts:61-68`) — currently unverified by any test. API-route tests for `plan.ts`/`profile.ts`/`profile/reset.ts` each cover only the `401`/unauthenticated-redirect branch.

## Desired End State

- `plan.ts`'s two pure business-rule functions and `profile.ts`'s three service functions have unit tests deriving expected behavior from the PRD/roadmap oracle (narrow-equipment message, duplicate-exercise rejection, `23505` duplicate-profile handling), not from mirroring the implementation.
- Every branch of `PUT`/`POST`/`DELETE /api/sessions/[sessionId]/sets`, `POST /api/plan`, `POST /api/profile`, and `POST /api/profile/reset` has a hermetic route test, closing the gaps research identified.
- The `restart_workout_session` double-click race has a real regression test: two genuinely concurrent RPC calls against local Supabase resolve to the same session id, and exactly one active session survives.
- A new Playwright spec proves the autosave failure UX end-to-end: after `MAX_RETRIES` exhausts, the input value is preserved and the session-wide failure banner appears.
- `context/foundation/test-plan.md` §5 reflects that `e2e on critical flows` is `required (already wired)`, and §6's cookbook sections have notes for this phase's patterns.
- **Verify via**: `npm run test`, `npm run lint`, `npx supabase start && npm run test:integration`, `npm run test:e2e`, `npm run build` all pass locally and in CI.

### Key Discoveries:

- `generateTrainingPlan`'s narrow-equipment guard (`plan.ts:74-78`) evaluates and throws *before* touching the Gemini client — it can be unit-tested by passing a stub `{} as GoogleGenAI` as the first argument, no AI mocking needed.
- The `restart_workout_session` race fix (`20260724130000_restart_workout_session_race_fix.sql:49-57`) lives entirely inside the Postgres function body (`EXCEPTION WHEN unique_violation`) — the TS wrapper `restartSession` (`session.ts:278-301`) has no branching logic of its own to mock, so only a real concurrent-call integration test exercises the fix.
- `save_generated_training_plan` raises `RAISE EXCEPTION 'profile_missing'` (`reset_rpc_hardening.sql:100-102`), and `api/plan.ts:61` checks `rpcError.message === "profile_missing"` — the hermetic mock needs a real `Error` instance (`Object.assign(new Error("profile_missing"), { code: ... })`), not a plain `{ message }` object, to satisfy this and the `err instanceof Error` check in `api/profile/reset.ts:37`.
- `tests/integration/fixtures/two-users.ts`'s `seedUser` (`:64-69`) already creates a `workouts` row per identity but discards its id — it needs one additive field (`workoutId`) to support the new restart-race test, without touching `session-ownership-rls.test.ts`'s existing usage.
- `SetRow.tsx`'s retry logic (`MAX_RETRIES = 3`, `RETRY_BASE_DELAY_MS = 500`, exponential backoff) means the new e2e failure-sim spec has a real minimum wall-clock wait of ~3.5s before the banner appears — this is expected, not a flake.

## What We're NOT Doing

- **No new client-side component-testing tooling** (`jsdom`/`@testing-library/react`). `SetRow.tsx`'s retry/backoff logic is verified only via the new e2e failure-simulation spec, not component-level unit tests. Matches `test-plan.md` §4, which lists component testing as "none yet, not in scope unless a later refresh raises it."
- **No regression test for the `opQueueRef` client-side save/delete race** (Phase 1 impl-review finding F1, CRITICAL, already fixed). It is pure client JS sequencing logic with no service/API-layer surface to assert against; closing this gap would require either the tooling above or extracting production logic into a new testable module, both out of scope for a test-only rollout. This is an explicit, accepted residual risk — consistent with the archived Phase 1 (workout-session) plan's own framing of Risk #3 as "mitigated, not eliminated."
- **No live-interleaving integration test for the mid-flow-reset (`profile_missing`) race.** A hermetic route-level test (mocked RPC error) is the cost-appropriate layer — reproducing the real race would require actually delaying a Gemini call, which is expensive and flaky for the signal gained. This mirrors the explicit recommendation in `research.md`'s Open Questions.
- **Risk #4** (protected-route list for workout-history) and **Risk #6** (malformed Gemini output / index-remap) — explicitly scoped to rollout Phase 3, not touched here.
- Astro static/layout pages, `shadcn/ui` component internals, exercise seed data — standing exclusions per `test-plan.md` §7.
- `hasActiveWorkoutSession`'s own service-layer unit test — the route-level fast-path branch is covered instead; the function itself is documented in-code as a non-authoritative fast path, with the RPC's advisory lock as the real (untested-by-this-phase, per the point above) enforcement.

## Implementation Approach

Ship Risk #5 first (Phase 1): it is entirely unit/hermetic, has no dependency on Risk #3's work, and validates the mocking conventions (RPC-exception mocking, route-test scaffolding) that Phase 2 reuses. Ship Risk #3 second (Phase 2): it has the larger surface (full route-branch coverage, a new integration test, a new e2e spec) and closes with the `test-plan.md` sync now that the north-star flow has real regression coverage backing the `e2e on critical flows` gate.

## Critical Implementation Details

**Postgres RPC exception mocking convention**: Mock `RAISE EXCEPTION` errors as real `Error` instances via `Object.assign(new Error(message), { code })`, matching the existing convention in `session.test.ts`'s `loadOwnedSession` `PGRST116` case — not a plain `{ message }` object. Both `api/plan.ts:61` (`rpcError.message === "profile_missing"`) and `api/profile/reset.ts:37` (`err instanceof Error ? err.message : undefined`) depend on the mocked error actually being an `Error` instance; a plain object mock passes type-checking but silently produces a false negative (falls through to the generic-error branch instead of the mapped one).

**True concurrency for the restart-race test**: The new integration test must issue both `restartSession` calls via `Promise.all` on the same client, not sequentially with a simulated delay — supabase-js opens one HTTP/DB round-trip per call, so two concurrent calls genuinely race at the Postgres statement level without needing to fake timing.

## Phase 1: Risk #5 — profile.ts/plan.ts service-layer safety net

### Overview

Close every zero-coverage branch research identified in `profile.ts`/`plan.ts` and their API routes, deriving expected behavior from the PRD/roadmap oracle (the S-02 narrow-equipment incident, the profile-reset hardening migration's documented intent) rather than from the current implementation's output.

### Changes Required:

#### 1. `plan.ts` pure-function unit tests

**File**: `src/lib/services/plan.test.ts` (new)

**Intent**: Prove the narrow-equipment guard and the duplicate-exercise/tracking-type re-validation behave per the documented S-02 oracle — "fail clearly before calling Gemini," not silently or with a generic error.

**Contract**: `describe("generateTrainingPlan")` — asserts it rejects with `PlanValidationError` (and never touches the passed-in Gemini client stub) when `candidates.length < MIN_EXERCISES_PER_WORKOUT`, for a boundary case (`length === MIN_EXERCISES_PER_WORKOUT - 1`) and an empty-candidates case. `describe("validatePlanAgainstCandidates")` — table of cases: valid plan passes through unchanged; an `exercise_id` not in the candidate set throws; a duplicate `exercise_id` within one workout throws; a reps-tracked exercise setting `target_duration_seconds` (or vice versa) throws. Follow the existing hand-built-fixture style (no query-builder mock needed — both functions are pure).

#### 2. `profile.ts` service-layer unit tests

**File**: `src/lib/services/profile.test.ts` (new)

**Intent**: Close the zero-coverage gap on all three service functions, mirroring the `createQueryBuilder`/direct-`rpc`-mock patterns from `session.test.ts`.

**Contract**: `getUserProfile` — asserts `.select("*").eq("id", userId).maybeSingle()` shape, returns the row or `null`. `createUserProfile` — asserts `.insert({ id: userId, ...input })` shape on success, and rethrows a `23505`-coded error unchanged (mirrors `loadOwnedSession`'s non-`PGRST116` rethrow test). `resetUserProfile` — asserts `.rpc("reset_user_profile", { p_user_id: userId })` call shape and rethrows on RPC error.

#### 3. `api/plan.ts` route tests

**File**: `src/pages/api/plan.test.ts` (extend)

**Intent**: Close the profile-missing pre-check, mid-flow-reset race, and narrow-equipment-surfaced-as-502 branches — all currently zero-coverage.

**Contract**: Add cases (alongside the existing `401` test): `getUserProfile` resolves `null` → `409 { error: "profile_missing" }` (pre-check, before any Gemini/candidate work). `save_generated_training_plan`'s RPC rejects with an `Error("profile_missing")` (per the mocking convention above) → `409` with the user-facing "profile was reset" message from `api/plan.ts:64`. `generateTrainingPlan` (mocked via `vi.mock("@/lib/services/plan", ...)`) rejects with a `PlanValidationError` → `502 { error: "ai_error", message }` echoing the guard's message — the API-level manifestation of the narrow-equipment oracle reaching the user as a clear failure, not a crash.

#### 4. `api/profile.ts` route tests

**File**: `src/pages/api/profile.test.ts` (extend)

**Intent**: Close validation-failure, duplicate-submit, and success branches — currently only `401` is covered.

**Contract**: Add cases (alongside the existing unauthenticated test): malformed `FormData` (e.g. missing `training_goal`) → redirect to `/onboarding?error=...`. `createUserProfile` rejects with a `23505`-coded error → redirect to `/dashboard` (benign double-submit handling, `api/profile.ts:47-50`). `createUserProfile` rejects with an unrelated error → redirect to `/onboarding?error=...` carrying that message. Valid submission → redirect to `/dashboard?saved=1`.

#### 5. `api/profile/reset.ts` route tests

**File**: `src/pages/api/profile/reset.test.ts` (extend)

**Intent**: Close the active-session fast-path guard, RPC error-mapping, and success branches.

**Contract**: Add cases (alongside the existing unauthenticated test): `vi.mock("@/lib/services/workout-sessions", ...)`'s `hasActiveWorkoutSession` resolves `true` → redirect to `/onboarding?error=...` with `ACTIVE_SESSION_MESSAGE`, without calling `resetUserProfile`. `resetUserProfile` rejects with `Error("active_workout_session")` → same mapped message via `KNOWN_ERROR_MESSAGES`. `resetUserProfile` rejects with an unrecognized error → generic fallback message. Success → redirect to `/onboarding`.

#### 6. Cookbook + progress sync

**File**: `context/foundation/test-plan.md`

**Intent**: Record Phase 1's landed patterns so future contributors extending Risk #5-adjacent code have a reference.

**Contract**: Add a §6.6 note for this phase pointing at `plan.test.ts`/`profile.test.ts` as the pure-function and I/O-service-layer reference tests respectively.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the new/extended files above
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- In local dev, complete onboarding with a minimal/restrictive equipment selection and confirm the plan-generation page surfaces the narrow-equipment message clearly (not a crash or silent hang)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Risk #3 — session-logging autosave safety net + gate sync

### Overview

Close the route/service-layer coverage gaps for the autosave path, add a real regression test for the previously-fixed `restart_workout_session` race, prove the failure UX end-to-end via a new e2e spec, and sync `test-plan.md` to reflect that the north-star flow now has regression coverage backing the `e2e on critical flows` gate.

### Changes Required:

#### 1. `session.ts` service-layer error-branch test

**File**: `src/lib/services/session.test.ts` (extend)

**Intent**: Close the one missing branch on `upsertSet` — the DB-write failure path, which is literally half of Risk #3's atomicity claim.

**Contract**: Add a case to `describe("upsertSet")`: query builder resolves `{ data: null, error: <PostgrestError> }` → `upsertSet` rejects with that error unchanged.

#### 2. `api/sessions/[sessionId]/sets.ts` full route-branch coverage

**File**: `src/pages/api/sessions/[sessionId]/sets.test.ts` (extend)

**Intent**: Close every branch research identified as untested for both `PUT`/`POST` and `DELETE`.

**Contract**: For `PUT`: valid request → `200` with the saved row (mock `upsertSet` success). Session not owned/missing (`loadOwnedSession` resolves `null`) → `404 { error: "not_found" }`. Session `status !== "active"` → `409 { error: "conflict" }`. `exercise_id` not part of the workout → `400 { error: "validation_error" }`. Unparseable JSON body → `400 { error: "invalid_json" }`. `upsertSet` rejects → `500 { error: "db_error" }`. For `DELETE`: valid request → `204` with an empty body. Same `404`/`409` ownership/status branches. `deleteSet` rejects → `500 { error: "db_error" }`.

#### 3. `tests/integration/fixtures/two-users.ts` — add `workoutId`

**File**: `tests/integration/fixtures/two-users.ts` (extend)

**Intent**: Expose each seeded identity's workout id so the new restart-race test can call `restartSession(client, id, sessionId, workoutId)` with real values, without touching `session-ownership-rls.test.ts`'s existing usage of `TestIdentity`.

**Contract**: Add `workoutId: string` to the `TestIdentity` interface; return `workout.id` (already fetched at `two-users.ts:64-69`, currently discarded) from `seedUser`.

#### 4. Restart-session race integration test

**File**: `tests/integration/restart-session-race.test.ts` (new)

**Intent**: Prove the `restart_workout_session` double-click fix (`20260724130000_restart_workout_session_race_fix.sql`) actually holds under real concurrent calls — a hermetic mock cannot exercise the RPC's own `EXCEPTION WHEN unique_violation` branch, since the fix lives entirely inside the SQL function body.

**Contract**: Using one seeded identity (`setupTwoUsers()`'s `userA`, its pre-seeded active session/workout), fire `Promise.all([restartSession(userA.client, userA.id, userA.sessionId, userA.workoutId), restartSession(userA.client, userA.id, userA.sessionId, userA.workoutId)])`. Assert both calls resolve (neither throws) and resolve to the same session id. Follow up with a direct read (`.eq("workout_id", userA.workoutId).eq("status", "active")`) asserting exactly one active session row exists.

#### 5. E2E autosave-failure spec

**File**: `tests/e2e/workout-session-save-failure.spec.ts` (new)

**Intent**: Prove the documented failure UX end-to-end — the input value is preserved and the session-wide banner appears only after all retries exhaust — formalizing what the archived Phase 1 plan recorded as manually verified only (commit `8506b46`).

**Contract**: Sign in, start a workout, then register a route interceptor before filling the set inputs:

```ts
await page.route("**/sets", (route) => {
  if (route.request().method() === "PUT" || route.request().method() === "POST") {
    return route.fulfill({ status: 500, body: JSON.stringify({ error: "db_error" }) });
  }
  return route.continue();
});
```

Fill Set 1, then assert: the input value stays as typed (not reverted) even after the debounce fires and retries exhaust; the failure banner text (from `SessionLogger.tsx`) becomes visible. Budget real wall-clock time for the 600ms debounce plus 500+1000+2000ms backoff (~4-5s total) — do not fake timers in an e2e context.

#### 6. Gate + cookbook sync

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that `e2e on critical flows` is now backed by real regression coverage of the north-star flow, and record this phase's new testing patterns for future contributors.

**Contract**: §5 — change the `e2e on critical flows` row's `Required?` cell from `required after §3 Phase 2` to `required (already wired)` (CI already runs and blocks on `npm run test:e2e`; this only corrects the documentation). §6.2 — note `restart-session-race.test.ts` as the second reference for the "DB constraint/race a mock would lie about" integration-test pattern. §6.3 — note the new failure-sim spec as the reference for route-interception-based e2e failure simulation. §6.6 — Phase 2 landing note. §3 — update this rollout phase's `Status` cell to `complete`.

#### 7. Change identity sync

**File**: `context/changes/testing-critical-path-data-integrity/change.md`

**Intent**: Reflect that implementation is complete.

**Contract**: Set `status: complete`, `updated: <today>`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the extended `session.test.ts` and `sets.test.ts`
- `npx supabase start` then `npm run test:integration` passes, including the new `restart-session-race.test.ts`
- `npm run test:e2e` passes, including the existing happy-path spec and the new failure-sim spec
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- In local dev, use browser devtools to block/fail the `PUT .../sets` request and confirm the banner appears only after all 3 retries, and the typed value is not reverted (spot-check parity with the new e2e spec)
- Manually double-click "Start Over" on an active session and confirm exactly one session results, not zero
- Confirm `test-plan.md` §5's `e2e on critical flows` row reads `required (already wired)` and CI is green end-to-end on the PR

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- Pure-function table tests for `plan.ts`'s narrow-equipment guard and re-validation logic (edge case: exactly `MIN_EXERCISES_PER_WORKOUT - 1` candidates; empty candidates; duplicate exercise; reps/duration mismatch).
- Service-layer I/O-shape tests for `profile.ts`'s three functions and `upsertSet`'s error branch, following the `createQueryBuilder`/direct-`rpc`-mock conventions from `session.test.ts`.
- Full route-branch coverage (every 2xx/4xx/5xx) for `api/plan.ts`, `api/profile.ts`, `api/profile/reset.ts`, and `api/sessions/[sessionId]/sets.ts`.

### Integration Tests:

- `restart-session-race.test.ts`: two genuinely concurrent RPC calls against local Supabase, proving the unique-constraint race fix holds.

### Manual Testing Steps:

1. Complete onboarding with minimal equipment; confirm the narrow-equipment failure message is clear, not a crash.
2. Block the autosave `PUT` request via devtools; confirm the banner appears only after retries exhaust and the typed value survives.
3. Double-click "Start Over" on an active session; confirm exactly one resulting session.

## Performance Considerations

The new e2e failure-sim spec has a real ~4-5s wall-clock floor (debounce + exponential backoff) — expected, not a flake; do not attempt to fake timers in the Playwright context, since the browser's real `setTimeout` is what's under test.

## Migration Notes

N/A — no schema or data migration in this phase; the one new fixture field (`workoutId` on `TestIdentity`) is test-only and additive.

## References

- Research: `context/changes/testing-critical-path-data-integrity/research.md`
- Prior rollout phase (conventions this phase extends): `context/archive/2026-07-24-testing-api-authorization-safety-net/`
- `src/lib/services/session.test.ts` — mocking convention reference
- `tests/integration/session-ownership-rls.test.ts` — integration-test convention reference
- `supabase/migrations/20260724130000_restart_workout_session_race_fix.sql` — restart-race fix under test
- `supabase/migrations/20260723000000_reset_rpc_hardening.sql:100-102` — `profile_missing` re-check under test

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #5 — profile.ts/plan.ts service-layer safety net

#### Automated

- [ ] 1.1 `npm run test` passes
- [ ] 1.2 `npm run lint` passes
- [ ] 1.3 `npm run build` passes

#### Manual

- [ ] 1.4 Narrow-equipment onboarding smoke test in dev shows a clear failure message

### Phase 2: Risk #3 — session-logging autosave safety net + gate sync

#### Automated

- [ ] 2.1 `npm run test` passes
- [ ] 2.2 `npx supabase start && npm run test:integration` passes
- [ ] 2.3 `npm run test:e2e` passes
- [ ] 2.4 `npm run lint` passes
- [ ] 2.5 `npm run build` passes

#### Manual

- [ ] 2.6 Devtools-blocked autosave shows banner after retries exhaust, value preserved
- [ ] 2.7 Double-click "Start Over" results in exactly one session
- [ ] 2.8 `test-plan.md` §5 e2e row reads `required (already wired)`, CI green end-to-end
