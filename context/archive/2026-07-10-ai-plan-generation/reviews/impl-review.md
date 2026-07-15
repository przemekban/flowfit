<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI-Generated Weekly Training Plan (S-02)

- **Plan**: context/changes/ai-plan-generation/plan.md
- **Scope**: Full plan review, Phases 1-5
- **Date**: 2026-07-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Concurrent plan generation can leave orphaned, non-archived workout rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260710120000_save_generated_training_plan_rpc.sql:27-57`, `src/components/plan/PlanGenerator.tsx`
- **Detail**: The only duplicate-generation guard is the client-side `hasFiredRef` in `PlanGenerator.tsx`, which prevents a second POST from the *same* mounted island (e.g. dev fast-refresh) but does nothing for two genuinely concurrent requests — a second browser tab, a flaky-network client retry, or any future caller. If two `save_generated_training_plan` transactions overlap, each archives whatever is "currently active" and inserts its own new `workouts` rows. Depending on commit ordering, the loser's newly-inserted workouts can end up neither archived nor referenced by `user_plan` — orphaned `is_archived = false` rows that no longer represent the active plan but would still surface if anything later queries "non-archived workouts" assuming that equals the active plan. The plan's own "Critical Implementation Details" section anticipated a fully-archived outcome for this race; the actual failure mode (unarchived orphans) is worse than what was reasoned through.
- **Fix A ⭐ Recommended**: Serialize with a Postgres advisory lock inside the RPC (`pg_advisory_xact_lock(hashtext(p_user_id::text))` as the first statement).
  - Strength: Closes the race at the source regardless of client behavior (multi-tab, retries, future callers); the lock auto-releases at transaction end, no cleanup needed.
  - Tradeoff: A second concurrent call now blocks until the first commits, adding latency to that overlapping request rather than corrupting state.
  - Confidence: HIGH — advisory locks are the standard Postgres pattern for this exact per-user-serialize problem.
  - Blind spot: Haven't load-tested actual overlap frequency in production; this is a defensive fix for a rare-in-practice MVP scenario.
- **Fix B**: Add a server-side in-flight check in `/api/plan` (e.g. reject if a generation for this user started in the last N seconds without settling).
  - Strength: No migration needed, pure application-layer change.
  - Tradeoff: Needs new state to track "in flight" (a column, KV entry, or similar) and a TTL/cleanup story for crashed requests — more moving parts than a DB-native lock.
  - Confidence: MEDIUM — workable, but more surface area than Fix A.
  - Blind spot: Cloudflare Workers' stateless-per-request model makes in-memory tracking unreliable; would need an external store.
- **Decision**: FIXED (Fix A) — `supabase/migrations/20260714000000_add_advisory_lock_to_plan_rpc.sql` adds `pg_advisory_xact_lock(hashtext(p_user_id::text))` as the RPC's first statement, serializing per-user generation.

### F2 — RPC has no guard against an empty/malformed `workouts` payload

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260710120000_save_generated_training_plan_rpc.sql:27-40`
- **Detail**: `jsonb_array_elements` on a missing/malformed `p_workouts->'workouts'` key just runs the `FOR` loop zero times — no exception is raised. The preceding archive (`UPDATE workouts SET is_archived = true`) and `DELETE FROM user_plan` still commit, so a call with an empty/wrong-shaped payload silently wipes the caller's active plan and inserts nothing. The app's own call path is safe today (Zod's `buildPlanSchema` guarantees a non-empty, correctly-shaped `workouts` array before the RPC is ever called), but the function is `GRANT EXECUTE TO authenticated` and directly reachable via `supabase.rpc()`, bypassing that validation entirely. Blast radius is limited to the calling user's own data (the `auth.uid()` guard prevents cross-user impact).
- **Fix**: Add `IF NOT (p_workouts ? 'workouts') OR jsonb_array_length(p_workouts->'workouts') = 0 THEN RAISE EXCEPTION 'workouts payload is empty'; END IF;` immediately after the `auth.uid()` check, before the archive/delete statements.
- **Decision**: FIXED — added to the same `supabase/migrations/20260714000000_add_advisory_lock_to_plan_rpc.sql` migration as F1.

### F3 — `cancelledRef`/`hasFiredRef` pair is fragile under React StrictMode double-invoke

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/plan/PlanGenerator.tsx`
- **Detail**: `cancelledRef` is set `true` on cleanup and never reset; `hasFiredRef` only resets via `handleRetry`. Not triggered today (StrictMode isn't enabled in this app), but if a future remount ever invoked the effect twice without a full unmount/dispose, the original in-flight fetch's `.then()` would see `cancelledRef.current === true` and silently discard a successful response, stranding the UI on a stopped spinner.
- **Fix**: Replace the boolean-ref pair with a per-mount `AbortController` so cancellation is scoped to a single effect invocation instead of shared mutable state.
- **Decision**: FIXED — `src/components/plan/PlanGenerator.tsx` now creates an `AbortController` per `fireGeneration()` call, passes its signal to `fetch`, aborts it on effect cleanup, and ignores `AbortError` in the `.catch` handler. `cancelledRef` removed.

### F4 — All Gemini/validation failures collapse into one generic 502 message

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/plan.ts:42-46`, `src/lib/services/plan.ts:69-131`
- **Detail**: Network failure, Gemini 429/5xx, malformed JSON, and schema mismatch all surface as the same `502 ai_error`. Acceptable for MVP (matches the plan's stated error-handling decision — user sees one generic retry message either way) but gives the user no signal that a rate-limited failure might succeed on immediate retry versus a persistent misconfiguration.
- **Fix**: If this becomes user-visible friction post-launch, distinguish transient (429/5xx, network) from permanent (schema/config) failures in the logged `cause` — already partially there via `console.error` — and consider a short client-side backoff-then-retry for the transient case.
- **Decision**: FIXED (partial) — `src/pages/api/plan.ts` now tags the `console.error` log line with `kind: "validation"` (our own Zod/referential-integrity rejection) vs `kind: "gemini_call"` (SDK/network failure), so operators can distinguish the two in logs. Client-facing response and message remain unchanged, per the plan's original one-generic-message decision — no backoff-retry added.

### F5 — RPC's business-rule enforcement (exercise-count bounds, tracking-type exclusivity) lives only in TypeScript, not the database

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260710120000_save_generated_training_plan_rpc.sql`
- **Detail**: `save_generated_training_plan` is granted to all `authenticated` users and only checks `auth.uid()` + FK integrity — the exercises-per-workout range (4-8), sets/reps/duration ranges, and reps-XOR-duration rule are Zod-only. A user could call the RPC directly with a payload that violates those business rules (still only affecting their own data, since RLS and the `auth.uid()` guard hold). This is a defense-in-depth gap, not an exploitable cross-user issue.
- **Fix**: Optional — add `CHECK` constraints on `workout_exercises` (e.g. `target_reps` XOR `target_duration_seconds`) if this table is ever written to from another code path.
- **Decision**: FIXED — `supabase/migrations/20260714000001_workout_exercises_tracking_xor_check.sql` adds `workout_exercises_tracking_xor` CHECK constraint. Not verified against a live DB (Docker/local Supabase stack unavailable in this session — `npx supabase db reset` failed with "Docker Desktop is a prerequisite"); syntax is a standard `ALTER TABLE ... ADD CONSTRAINT ... CHECK`, run `npx supabase db reset` before this ships to confirm it applies cleanly against existing data.

### F6 — Production deployment secrets still pending

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/ai-plan-generation/plan.md` Progress, items 1.5/1.6
- **Detail**: Phase 1 manual items correctly remain unchecked, not rubber-stamped: `GEMINI_API_KEY` is confirmed in local `.dev.vars` but `npx wrangler secret put GEMINI_API_KEY` has not yet been run against the Cloudflare production environment, and no GitHub Actions secret has been added. Code is complete and builds cleanly with the key unset (`createGeminiClient()` returns `null`, and `/api/plan` degrades to a clean `502 ai_error` rather than crashing — verified in `src/pages/api/plan.ts:31-35`), so this is a deployment gate, not a code defect.
- **Fix**: Run `npx wrangler secret put GEMINI_API_KEY` for the Cloudflare production environment before this feature is expected to work in production; add a GitHub Actions secret only if a future CI step needs it.
- **Decision**: SKIPPED — deployment action for the user to run manually, not a code change.
