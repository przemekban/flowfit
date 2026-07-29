<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: API + Authorization Safety Net

- **Plan**: context/changes/testing-api-authorization-safety-net/plan.md
- **Scope**: Phase 1 to 5
- **Date**: 2026-07-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 6 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Interactive Prompts in CI Deployment Workflow

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:67
- **Detail**: The deploy job executes `supabase link --project-ref $SUPABASE_PROJECT_ID` which requires interactive password entry in a non-TTY environment, causing the CI deploy step to hang or fail.
- **Fix A ⭐ Recommended**: Pass the database password using the `SUPABASE_DB_PASSWORD` environment variable.
  - Strength: Simple, preserves the existing linking workflow.
  - Tradeoff: Requires creating a new secret `SUPABASE_DB_PASSWORD` in the GitHub repository.
  - Confidence: HIGH — standard Supabase CLI headless linking pattern.
  - Blind spot: None significant.
- **Fix B**: Push schema updates directly using connection string `supabase db push --db-url`.
  - Strength: Eliminates the need to link the project in CI.
  - Tradeoff: Requires managing a full connection string secret.
  - Confidence: HIGH.
  - Blind spot: None.
- **Decision**: SKIPPED

### F2 — Potential Request Crash on Deleted/Missing Workouts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/sessions/[sessionId]/sets.ts:79
- **Detail**: If the workout associated with the session is not found or has been deleted, `workout = await getWorkoutWithExercises(...)` returns `null`. The call `workout?.exercises.find(...)` will evaluate to `undefined.find(...)` which throws a runtime `TypeError` and crashes the request with a 500 error.
- **Fix**: Check if `workout` is null/undefined and return a clean 404 Response.
  - Strength: Prevents server-side crash, provides clean API response diagnostics.
  - Tradeoff: None.
  - Confidence: HIGH — straightforward validation check.
  - Blind spot: None.
- **Decision**: SKIPPED

### F3 — Unnecessary Heavy Database Joins on Simple Metadata Checks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/sessions/[sessionId]/complete.ts:28
- **Detail**: `complete.ts` and `restart.ts` call `getSessionWithSets` to verify session ownership and status. This does heavy SQL joins on the `workouts`, `workout_sets`, and `exercises` tables even though the routes only inspect `status` and `workout_id`.
- **Fix**: Replace `getSessionWithSets` with `getSessionOwnership` when validating session metadata.
  - Strength: Removes unnecessary joins and reduces DB memory/network/CPU load.
  - Tradeoff: None.
  - Confidence: HIGH — `getSessionOwnership` already exists and selects all required columns.
  - Blind spot: None.
- **Decision**: FIXED

### F4 — Sequential Network Waterfall during Workout Session Restart

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/sessions/[sessionId]/restart.ts:47
- **Detail**: `restart.ts` runs a sequential waterfall: first waits for `restartSession`, then runs `getSessionWithSets` and `getWorkoutWithExercises` in parallel, then runs `getLastLoggedSets`.
- **Fix**: Pull the `getWorkoutWithExercises` fetch out of the downstream dependency block to run in parallel with the restart operation.
  - Strength: Shaves off a full database network roundtrip from the critical path.
  - Tradeoff: Minor promise logic restructuring.
  - Confidence: HIGH.
  - Blind spot: None.
- **Decision**: FIXED

### F5 — Unsupported Request Body in HTTP DELETE Method

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/sessions/[sessionId]/sets.ts:136
- **Detail**: The `DELETE` endpoint expects a JSON request body. HTTP standards discourage DELETE bodies, and various proxies, CDNs, or API gateways (like Cloudflare) may strip it.
- **Fix A ⭐ Recommended**: Pass parameters as URL query parameters (e.g. `DELETE /api/sessions/[sessionId]/sets?exercise_id=...&set_number=...`).
  - Strength: Fully spec-compliant and universally supported.
  - Tradeoff: Requires corresponding frontend fetch change.
  - Confidence: HIGH.
  - Blind spot: None.
- **Fix B**: Encode parameters into path routes (e.g. `/api/sessions/[sessionId]/sets/[exerciseId]/[setNumber]`).
  - Strength: Highly RESTful.
  - Tradeoff: Requires restructuring Astro routes.
  - Confidence: HIGH.
  - Blind spot: None.
- **Decision**: SKIPPED

### F6 — Large Historical Data Scan on Client Prefills

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/session.ts:186
- **Detail**: `getLastLoggedSets` fetches all historical logged sets for matching exercise IDs, filtering down in Javascript memory. This scales linearly with user history.
- **Fix A ⭐ Recommended**: Use a custom view or RPC function in Postgres using `DISTINCT ON` to return only the single latest record for each exercise.
  - Strength: Scales O(1) regardless of history size.
  - Tradeoff: Requires database schema migration.
  - Confidence: HIGH.
  - Blind spot: None.
- **Fix B**: Fetch in parallel with limit 1 per exercise.
  - Strength: Keep change in application code.
  - Tradeoff: Increases database query count.
  - Confidence: MEDIUM.
  - Blind spot: None.
- **Decision**: FIXED

### F7 — Missing Success Cases in Route Unit Tests

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/\*.test.ts
- **Detail**: New route unit tests only cover error cases (401/400 unauthenticated/malformed params checks) instead of success/happy paths, unlike auth endpoint tests.
- **Fix**: Expand test files to cover successful service resolution paths with mocked database states.
- **Decision**: FIXED

### F8 — Unplanned Database Migration and Lessons Learned

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260724110000_workout_session_logging_support.sql
- **Detail**: A database migration and `lessons.md` updates were included. Though technically outside the files list of the plan, they were necessary additions (migration for RPC `restart_workout_session`, and `lessons.md` for registering learnings).
- **Fix**: Update the implementation plan to log these files as addenda.
- **Decision**: FIXED
