---
date: 2026-07-29T19:04:39+02:00
researcher: Przemysław Bańkowski
git_commit: 710a55401b9a9500b4fe231dbbfb9b2c6efb8d72
branch: testing-api-authorization-safety-net
repository: przemekban/flowfit
topic: "Critical-path data integrity test rollout (Phase 2) — Risks #3 and #5"
tags: [research, codebase, session-logging, autosave, profile, plan, data-integrity, testing]
status: complete
last_updated: 2026-07-29
last_updated_by: Przemysław Bańkowski
---

# Research: Critical-path data integrity test rollout (Phase 2)

**Date**: 2026-07-29T19:04:39+02:00
**Researcher**: Przemysław Bańkowski
**Git Commit**: 710a55401b9a9500b4fe231dbbfb9b2c6efb8d72
**Branch**: testing-api-authorization-safety-net
**Repository**: przemekban/flowfit

## Research Question

`context/foundation/test-plan.md` §3 names rollout Phase 2, "Critical-path data integrity," covering two risks:

- **Risk #3**: During a workout session, a logged set (reps/weight) appears to save in the UI but the autosave request fails silently, and the data is gone on reload or session resume.
- **Risk #5**: A change to `profile.ts` or `plan.ts` regresses onboarding-profile persistence or plan-generation input mapping without anyone noticing.

What is the actual call path, atomicity, and existing test baseline for each risk, and what does the PRD/roadmap/archive record say the correct (oracle) behavior should be?

## Summary

**Risk #3 (autosave data loss)**: The DB write itself is atomic — one `upsert()` per set, on `(workout_session_id, exercise_id, set_number)`. There is no partial-write branch inside the save sequence. The actual risk surface is almost entirely in the **client layer**: `SetRow.tsx` debounces 600ms, retries 3× with exponential backoff, then gives up and shows only a session-level dismissible banner — no per-row indicator, no rollback of the input value, no way to tell the user *which* set failed. A `sendBeacon`/`keepalive` best-effort flush covers the tab-close case but can itself fail silently. The team's own Phase 1 (S-03) design docs call this a **residual, accepted risk, not a closed one**. Two related concurrency bugs (a save/delete race, and a duplicate-active-session race) were already found and fixed during that phase's review — with zero automated regression coverage today. Component-level testing of `SetRow.tsx`/`SessionLogger.tsx` is blocked by tooling: `vitest.config.ts` runs in `environment: "node"` and no `@testing-library/react`/`jsdom` is installed. API-route-level branches (success/404/409/400/500 on `PUT`/`DELETE /sets`) are cheap, hermetic, and entirely untested today.

**Risk #5 (profile.ts/plan.ts regression)**: `profile.ts` is 100% I/O-bound (three thin Supabase wrappers; no business logic lives there — validation is a separate zod schema, branching lives in the API route). `plan.ts` contains exactly two genuinely pure, business-rule-bearing units with zero existing test coverage: the narrow-equipment guard in `generateTrainingPlan` (`plan.ts:74-78`, throws before any Gemini call) and the duplicate-exercise/tracking-type re-validation in `validatePlanAgainstCandidates` (`plan.ts:133-169`). Both are drawn directly from a documented Phase-S-02 incident (an equipment-too-narrow selection produced a broken plan) and are the cheapest, highest-signal unit tests available in this whole risk area — no DB, no Gemini client needed. The "mid-flow reset" scenario named in the test-plan's Risk Response Guidance is a real, already-mitigated race (a `profile_missing` 409 raised by the `save_generated_training_plan` RPC when a reset commits mid-generation) that is currently unverified by any test at any layer. `user_profiles.id` is PK = FK to `auth.users.id`, making "two profiles for one user" structurally impossible at the DB level — the closest live edge case is a duplicate-insert `23505`, silently treated as a no-op redirect to `/dashboard` by the API route.

Both risks' oracle behavior is well-documented outside the implementation (PRD guardrails, roadmap known-limitations, and two archived change plans that already discovered and fixed the exact failure classes these risks describe) — there is no ambiguity requiring a stop-and-ask; sources resolve expected behavior unambiguously for both risks.

## Detailed Findings

### Risk #3 — Session-logging autosave (client → API → DB)

**Call path**: `SetRow.tsx` → `PUT /api/sessions/[sessionId]/sets` (`src/pages/api/sessions/[sessionId]/sets.ts`) → `upsertSet` (`src/lib/services/session.ts:219-237`) → `workout_sets` table.

**Client layer** (`src/components/session/SetRow.tsx`):
- Constants: `DEBOUNCE_MS = 600`, `MAX_RETRIES = 3`, `RETRY_BASE_DELAY_MS = 500` (`SetRow.tsx:7-9`).
- Every keystroke → `scheduleSave` (`:130-162`) validates locally, arms a 600ms debounce timer (a `requestIdRef` guard discards stale timers).
- `persist` (`:82-111`): `fetch(PUT .../sets)`. Success → marks saved, fires `onSaved()` once. Failure with retries remaining → exponential backoff (500ms/1000ms/2000ms) and recurse. Failure after 3 retries → clears pending state, calls `onSaveFailed()` — **the only failure signal**. The typed input value is never reverted regardless of outcome.
- Clearing an already-saved field triggers a **fire-and-forget DELETE** (`deletePersisted`, `:113-128`) with `keepalive: true`; errors are swallowed entirely by design ("best-effort; the row is already visibly cleared client-side") — a stale DB row can survive an invisible-to-the-user delete failure.
- `opQueueRef` (`:54,58-60`) serializes persist/delete ops per row — this exists specifically because an earlier version had a save/delete race (see Historical Context).
- No row-level spinner/checkmark/error UI exists in `SetRow.tsx`.

**Session layer** (`src/components/session/SessionLogger.tsx`):
- `failedSaves: Set<string>` (`:29`) drives one dismissible session-wide red banner: *"Some sets couldn't be saved after several attempts. Your entered values are still shown."* Per-session, not per-row — user isn't told which set to re-enter.
- `beforeunload` handler (`:38-54`): for every still-pending save, fires `navigator.sendBeacon` and calls `event.preventDefault()` to trigger the browser's native "leave site?" prompt. This is why the API route also accepts `POST` as an alias for `PUT` — `sendBeacon` cannot issue `PUT`.

**API route** (`src/pages/api/sessions/[sessionId]/sets.ts`, `handleSetWrite` backs both `PUT`/`POST`):
1. `401` unauthenticated.
2. `400 validation_error` non-UUID `sessionId`.
3. `500 db_error` if Supabase misconfigured.
4. Session ownership check → `404 not_found` if missing/not-owned, `500` on unexpected DB error.
5. **`409 conflict` if `session.status !== "active"`** — a session completed/abandoned in another tab, or a stale in-flight retry after "Finish workout" was tapped, hits this branch; the client's retry loop treats it identically to any other failure (exhausts retries, generic banner).
6. `400 invalid_json` on unparseable body.
7. `400` missing/wrong-type `exercise_id`.
8. Loads workout, checks `exercise_id` belongs to it → `400` if not.
9. Dynamic zod schema by `tracking_type` (`buildSetLogSchema`, `src/lib/validation/session.ts:4-26`) — reps XOR duration, `.strict()`.
10. `upsertSet` → `500 db_error` on failure, else `200` with saved row.

**No partial-failure branch inside a single save** — the write is one Postgres statement; every prior step is a read that fails independently before the write is attempted.

**DB schema** (`supabase/migrations/20260529000000_core_schema.sql` + later migrations):
- `workout_sessions`: FK `user_id → auth.users ON DELETE CASCADE`; composite FK `(user_id, workout_id) → workouts(user_id, id) ON DELETE RESTRICT`. Partial unique index `idx_one_active_session_per_workout` (`20260612000000_active_session_uniqueness.sql`) — at most one active session per workout per user, DB-enforced.
- `workout_sets`: FK `workout_session_id → workout_sessions ON DELETE CASCADE`, FK `exercise_id → exercises ON DELETE RESTRICT`. `UNIQUE (workout_session_id, exercise_id, set_number)` — the upsert conflict target. CHECK constraints on `set_number > 0`, `reps >= 0`, `weight_kg >= 0`, `duration_seconds > 0`. `workout_sets_tracking_xor` CHECK added in `20260724110000_workout_session_logging_support.sql:12-16` (exactly one of `reps`/`duration_seconds` non-null) — DB-level defense-in-depth behind the zod rule, added because a direct RPC call could otherwise bypass zod.
- `latest_workout_sets` view (`20260729183800_latest_workout_sets_view.sql`) backs the pre-fill lookup (`getLastLoggedSets`).

**Existing test coverage**:
- `src/lib/services/session.test.ts` (hand-mocked chainable query builder, the `createQueryBuilder` pattern the cookbook §6.1 references): covers `upsertSet` happy path (asserts payload/conflict target), `deleteSet` (idempotent zero-row match), `getLastLoggedSets`, `createSession`'s `23505` fallback, `loadOwnedSession` (own/not-own/`PGRST116`/other-error), `restartSession` RPC shape. **No test for `upsertSet`'s `error` branch** (DB write failure — literally half of Risk #3 at the service layer).
- `src/pages/api/sessions/[sessionId]/sets.test.ts`: only `401` and `400` (non-UUID) cases for both `PUT` and `DELETE`. **Not covered**: success `200`, `404`/`409` ownership/status branches, `exercise_id`-not-in-workout `400`, dynamic-schema validation branch, `upsertSet`-throws `500` branch.
- `tests/e2e/workout-session.spec.ts` (45 lines): one happy-path spec — sign in → start → fill Set 1 → wait for real `PUT` → reload → assert resumed → finish. Proves persistence only under a successful first-try save; does not simulate slow network, retry exhaustion, the failure banner, `sendBeacon`, or the native unload prompt.
- **No component-level tests exist for `SetRow.tsx`/`SessionLogger.tsx`, and the tooling cannot currently support them**: `vitest.config.ts:20` sets `environment: "node"` (no `jsdom`/`happy-dom`); `package.json` has no `@testing-library/react`. The archived Phase 1 plan itself recorded this gap explicitly (see Historical Context).

### Risk #5 — `profile.ts` / `plan.ts` service layer

**`src/lib/services/profile.ts`** (49 lines, 3 exported functions, **100% I/O-bound**, no pure logic in this file):

| Function | Lines | Behavior |
|---|---|---|
| `getUserProfile` | `:5-16` | `SELECT ... .maybeSingle()`; throws on `PostgrestError`, returns `null` if no row. |
| `createUserProfile` | `:18-40` | `INSERT ... .single()`; throws on `PostgrestError` (notably `23505` unique-violation — `id` is PK/FK to `auth.users`, so a duplicate insert means the user already has a profile). |
| `resetUserProfile` | `:42-48` | `supabase.rpc("reset_user_profile", ...)`; throws on RPC error including the `active_workout_session` exception. |

Validation lives one layer up in `src/lib/validation/profile.ts:16-22` (`onboardingSchema`, zod); `createUserProfile` trusts an already-validated `OnboardingInput`. The actual branching for onboarding persistence lives in the **API route** `src/pages/api/profile.ts` (POST handler, `:13-56`): auth gate → Supabase-not-configured → form-parse failure → zod failure → `createUserProfile` `23505` (duplicate submit / double-tab) treated as benign, redirects straight to `/dashboard` → any other error → generic redirect with message → success `/dashboard?saved=1`.

**`src/lib/services/plan.ts`** (211 lines, 5 exported + 2 private functions):

| Function | Pure vs I/O | Notes |
|---|---|---|
| `getCandidateExercises` | I/O | Filters `exercises` by `profile.equipment` + `experience_level` (enum ordinal comparison, not alphabetical — declared order `beginner < intermediate < advanced`). |
| `buildSystemPrompt` (private) | Pure | Static string. |
| `buildUserPrompt` (private) | Pure | Formats prompt using array **index** as ephemeral candidate id — the same index later remapped to a real UUID. |
| `generateTrainingPlan` | Mixed | **`:74-78` is the key pure, business-rule-bearing branch** — see narrow-equipment guard below. Rest of the function is the Gemini I/O call. |
| `validatePlanAgainstCandidates` | **Pure** | Deterministic input→output/throw; re-validation gate ahead of persistence. |
| `getActivePlan` | I/O | Reads active plan with nested joins, ordered by position. |

**Narrow-equipment guard — exact trace** (the PRD/roadmap S-02 known limitation):
- `MIN_EXERCISES_PER_WORKOUT = 4` (`src/lib/validation/plan.ts:3`) is the single source of truth.
- `generateTrainingPlan`'s first statement (`plan.ts:74-78`): `if (candidates.length < MIN_EXERCISES_PER_WORKOUT) throw new PlanValidationError(...)`. Pure, synchronous, evaluated **before** the Gemini client is invoked — added specifically (per `context/archive/2026-07-10-ai-plan-generation/research.md:143-149`) so a hopeless equipment combination doesn't burn a free-tier API call. This is the cheapest, purest, highest-signal unit test in the whole risk area: no mocks needed beyond a `candidates` array and a `profile` stub.
- `validatePlanAgainstCandidates` (`:145-150`) independently guards against **repeated exercises within one workout** — the second face of the same "candidate pool too small" failure for pools that clear 4 but are still tight (4-7 candidates).
- Route `src/pages/api/plan.ts:37-48` catches both `PlanValidationError` and any other error uniformly as `502 { error: "ai_error", message }` — distinguished only in the server log, not the HTTP response.
- Index→UUID remap (`plan.ts:116-122`, bounded by `buildPlanGenerationSchema`'s `.max(candidateCount - 1, 0)` in `src/lib/validation/plan.ts:37`) is Risk #6 territory (Phase 3), not Risk #5 — flagged here only for scope discipline; it cannot actually misfire when `candidates` is empty because the narrow-equipment guard already throws first.

**Profile-reset flow** (mid-flow-reset race — the concrete scenario the test-plan names):
1. `POST /api/profile/reset` → auth gate → app-layer `hasActiveWorkoutSession` fast-path guard (explicitly documented in-code as *not* the real enforcement, racy on its own) → `resetUserProfile` → RPC `reset_user_profile`.
2. The RPC (`supabase/migrations/20260723000000_reset_rpc_hardening.sql:49-75`) is the **real** enforcement: advisory lock on `hashtext(userId)`, re-checks for an active session (raises `active_workout_session`), deletes the `user_profiles` row, calls shared `archive_active_plan(p_user_id)` (archives `workouts`, deletes `user_plan` rows) — all in one transaction.
3. `user_plan`/`workouts` have **no FK to `user_profiles`**, so a plain profile delete would not cascade-clear them — this is exactly the bug Phase 4 of the profile-reset rollout found manually (stale plan left visible after reset, no regen path) and fixed by folding archival into the RPC.
4. The interleaving race: a concurrent `POST /api/plan` that passed its own `getUserProfile` check before a reset commits would otherwise insert a plan for a profile-less user. Mitigated by `save_generated_training_plan`'s own re-check (`reset_rpc_hardening.sql:100-102`, raises `profile_missing`), surfaced as a `409` in `src/pages/api/plan.ts:61-68` with a user-facing message. **This exact race is currently unverified by any test at any layer.**

**DB schema** (Risk #5-relevant, `20260529000000_core_schema.sql`):
- `user_profiles`: `id` PK = FK `auth.users(id) ON DELETE CASCADE` — **one profile per user by construction** (PK, not merely a unique constraint). `equipment TEXT[] NOT NULL DEFAULT '{}'` with `CHECK (equipment <@ ARRAY[...])` allowlist (DB-level defense-in-depth behind the zod enum). `sessions_per_week SMALLINT CHECK (BETWEEN 1 AND 7)`. RLS owner-only SELECT/INSERT/UPDATE from core schema; DELETE policy added later (`20260717000000_add_user_profiles_delete_policy.sql`).
- `user_plan`: composite FK `(user_id, workout_id) → workouts(user_id, id) ON DELETE CASCADE`; `UNIQUE(user_id, position) DEFERRABLE INITIALLY DEFERRED` (deferred because clear-then-reinsert within one transaction would otherwise transiently violate position-uniqueness) and `UNIQUE(user_id, workout_id)`.
- `workouts`: `UNIQUE(user_id, id)` — a self-referential composite unique used as the FK target for `user_plan`/`workout_sessions`, making cross-user workout references impossible at the schema level, not just via RLS.

**Existing test coverage**: **No `profile.test.ts` or `plan.test.ts` exists under `src/lib/services/`.** API-route tests (`src/pages/api/profile.test.ts`, `plan.test.ts`, `profile/reset.test.ts`) each cover exactly one case — the unauthenticated-redirect/`401` branch — and nothing else (no duplicate-profile path, no validation failure, no narrow-equipment path, no `profile_missing` 409, no active-session-guard, no RPC error-mapping, no happy path). The reusable mock pattern to mirror is `session.test.ts`'s `createQueryBuilder` helper plus its direct `{ rpc: vi.fn(...) }` style (used for `restartSession`, directly analogous to `resetUserProfile`).

**Coverage gaps ranked by test-plan Response Guidance fit**:
1. Narrow-equipment guard (`plan.ts:74-78`) — zero coverage, cheapest/purest/highest-signal.
2. Duplicate-exercise/tracking-type re-validation (`plan.ts:133-169`) — zero coverage, also pure.
3. `createUserProfile`'s `23505` duplicate-insert handling at the service layer — zero coverage.
4. `resetUserProfile`/`getUserProfile` RPC/query-shape assertions — zero coverage.
5. The mid-flow-reset race (`profile_missing` 409) — zero coverage; a hermetic route-level test (mock the RPC returning a `profile_missing`-shaped error) is the cost-appropriate layer per §1 cost×signal, not a live-interleaving integration test.

### CI / test-runner wiring (both risks)

- `vitest.config.ts` (unit, `environment: "node"`, `src/**/*.test.ts`) and `vitest.integration.config.ts` (`tests/integration/**/*.test.ts`) both exist and are **both wired into CI** (`.github/workflows/ci.yml:21-48`): `npm ci` → `astro sync` → lint → `npm run test` → `supabase start` → `npm run test:integration` → `playwright install` → `npm run test:e2e` → `supabase stop` → `npm run build`. This confirms test-plan.md §5's "required after §3 Phase 1" gate for unit+integration is **already live**, not still pending.
- The `e2e on critical flows` gate in test-plan.md §5 still reads "required after §3 Phase 2" — since the current Phase 2 *is* the session-logging north-star flow's data-integrity phase, whether to flip that gate to required is a live decision for `/10x-plan`, not something already resolved.
- No CI step or dependency exists yet for a React component-testing tool. Adding one (if `SetRow.tsx` client logic is to be tested directly rather than only at the API/service boundary) is new tooling, not just a new test file — a decision point for planning, not research.

## Code References

- `src/components/session/SetRow.tsx:7-9,54,58-60,82-111,113-128,130-162,164-174` — debounce/retry/persist/delete-on-clear/queue logic (Risk #3)
- `src/components/session/SessionLogger.tsx:29,38-54,125-138` — failure banner + `beforeunload`/`sendBeacon` flush
- `src/pages/api/sessions/[sessionId]/sets.ts:29-103` — `PUT`/`POST` write path; `:105-155` — `DELETE`
- `src/lib/services/session.ts:219-237` (`upsertSet`), `:239-255` (`deleteSet`), `:278-301` (`restartSession`), `:130-148,115-128` (ownership)
- `src/lib/validation/session.ts:4-26` — dynamic reps/duration zod schema
- `supabase/migrations/20260529000000_core_schema.sql:133-154` — `workout_sessions`/`workout_sets` schema
- `supabase/migrations/20260612000000_active_session_uniqueness.sql` — one-active-session-per-workout partial unique index
- `supabase/migrations/20260724110000_workout_session_logging_support.sql:12-16` — `workout_sets_tracking_xor` CHECK
- `src/lib/services/profile.ts:5-48` — `getUserProfile`/`createUserProfile`/`resetUserProfile`
- `src/pages/api/profile.ts:13-56` — onboarding POST handler branches, incl. `23505` handling
- `src/lib/services/plan.ts:21-39,41-67,69-131,133-169,178-210` — candidate query, prompt builders, `generateTrainingPlan` (incl. narrow-equipment guard at `:74-78`), `validatePlanAgainstCandidates`, `getActivePlan`
- `src/lib/validation/plan.ts:3,31-52` — `MIN_EXERCISES_PER_WORKOUT`, `buildPlanGenerationSchema`
- `src/pages/api/plan.ts:26-29,37-48,61-69` — plan-generation route, error mapping incl. `profile_missing` 409
- `src/pages/api/profile/reset.ts:14-16,18-44` — reset route
- `supabase/migrations/20260723000000_reset_rpc_hardening.sql:49-75,100-102` — `reset_user_profile` RPC hardening, `archive_active_plan`, `profile_missing` re-check
- `src/lib/services/session.test.ts:26-44` — `createQueryBuilder` hand-mock pattern (cookbook reference)
- `src/pages/api/sessions/[sessionId]/sets.test.ts:18-60` — existing hermetic route coverage (401/400 only)
- `.github/workflows/ci.yml:21-48` — full CI test-gate wiring
- `vitest.config.ts:6-10,20` — `environment: "node"`, no jsdom, deliberate avoidance of `getViteConfig`

## Architecture Insights

- **Atomicity is pushed to the DB layer via RPCs, not application-level transactions.** Every place a multi-step sequence needs to be atomic (`restart_workout_session`, `save_generated_training_plan`, `reset_user_profile`) is implemented as a single Postgres function call with an advisory lock, not as multiple sequential Supabase client calls from TypeScript. This means Risk #3's and Risk #5's "partial write" framing doesn't materialize as a literal partial-DB-write bug in either area researched — the actual risk surface is client-side (retry/debounce/silent-failure UX) for Risk #3, and pure-function edge cases plus one already-mitigated cross-request race for Risk #5.
- **Defense-in-depth pattern repeats**: zod schema + matching DB CHECK constraint appears twice independently (`workout_exercises` reps/duration XOR, then `workout_sets` reps/duration XOR) — each added after the team recognized a direct-RPC-call bypass path for the app-layer-only zod rule. Future schema-adjacent test cases should assert both layers where this pattern exists.
- **The team already found and fixed the exact failure classes both risks describe, during manual code review, with no automated regression test surviving the fix**: the `SetRow.tsx` save/delete race (Phase 1 impl-review F1), the `restart_workout_session` double-click race (F2), and the profile-reset active-session-guard/plan-generation race (profile-reset Phase 5). This is the single strongest argument for this rollout phase's existence — Phase 2 is not hunting for hypothetical bugs, it's writing regression tests for concrete, previously-shipped near-misses.
- **Toolchain gap**: no React component-testing harness exists (`environment: "node"`, no `@testing-library/react`/`jsdom`). This was already noted as a known gap in the S-03 archived plan's own progress log. Planning must explicitly decide whether Risk #3 coverage targets the API/service boundary only, or whether new test infrastructure is added to reach `SetRow.tsx`'s retry/backoff logic directly.

## Historical Context (from prior changes)

- `context/archive/2026-07-16-workout-session/plan-brief.md:19-32` — Key Decisions table: autosave feedback is explicitly "Silent, banner only on total failure," the team's own call, "mitigated (not eliminated)." Also documents the pre-fill-value design change (F4) made specifically to avoid a silent-non-autosave trap.
- `context/archive/2026-07-16-workout-session/plan.md` (Open Risks & Assumptions section) — verbatim: "None of these are a hard guarantee — a beacon can still fail silently, and a user can still dismiss the unload prompt — so this remains a residual, accepted risk, not a closed one." Direct oracle statement for Risk #3.
- `context/archive/2026-07-16-workout-session/plan.md:519,526` — Progress log recording "no component-testing harness in this repo" (item 6.3) and "8506b46: offline save failure shows banner only after all 3 retries, input preserved" verified **manually**, not automated (item 6.7).
- Impl-review findings from the same phase: F1 (CRITICAL, save/delete race, fixed via `opQueueRef`), F2 (restart-session double-click race, fixed via `unique_violation` handler in `20260724130000_restart_workout_session_race_fix.sql`), F5 (unmount guard / keepalive delete, fixed) — all fixed, none regression-tested.
- `context/archive/2026-07-10-ai-plan-generation/research.md:139-149` — the manual-test discovery that produced the narrow-equipment and duplicate-exercise guards; direct evidentiary source and oracle for Risk #5's "narrow equipment selection" language. Confirms intended behavior is "fail clearly before calling Gemini," not any kind of auto-recovery.
- `context/foundation/roadmap.md:98` (S-02 known limitation) — confirms product-level consequence: originally no recovery path beyond an identically-failing retry button; later resolved by the separate profile-reset feature, not by changing plan-generation's failure behavior. A test plan should not expect `generateTrainingPlan` to "fix" a narrow-equipment situation.
- `context/archive/2026-07-16-profile-reset/plan.md:13,28,183-249,346-359` — documents (a) `user_plan`/`workouts` have no FK to `user_profiles` so nothing cascades automatically, (b) a real regression found manually in Phase 4 (stale plan after reset), (c) Phase 5 hardening that closed the active-session-guard race and the plan-generation/reset interleaving race — both currently unverified by any automated test.
- `context/archive/2026-07-24-testing-api-authorization-safety-net/` (Phase 1 of this same rollout) — established the reusable conventions this phase should extend: hand-mocked Supabase query-builder for unit tests, `vi.mock` + dynamic-import hermetic route tests, `tests/integration/fixtures/two-users.ts` for RLS/ownership integration tests, and the `lessons.md` rules (GRANT alongside RLS; exact-identifier-scoped fixture cleanup). Confirms unit+integration are now real, required CI gates (not still pending, contrary to what a literal reading of the test-plan.md §5 date might suggest).

## Related Research

- `context/archive/2026-07-24-testing-api-authorization-safety-net/research.md` — Phase 1 research (Risks #1/#2), establishes the testing conventions this phase extends.
- `context/archive/2026-07-16-workout-session/research.md` (if present) and `plan.md` — S-03 implementation record, primary source for Risk #3's design tradeoffs.
- `context/archive/2026-07-10-ai-plan-generation/research.md` — S-02 implementation record, primary source for Risk #5's narrow-equipment oracle.
- `context/archive/2026-07-16-profile-reset/plan.md` — OQ-001 resolution, primary source for the mid-flow-reset race relevant to Risk #5.

## Open Questions

- **e2e gate timing**: test-plan.md §5 ties "e2e on critical flows" to "required after §3 Phase 2" — since this phase covers the north-star session-logging flow, `/10x-plan` should explicitly decide whether this phase also flips that CI gate to required, or defers it.
- **Component-testing tooling decision**: does Phase 2 add `@testing-library/react`/`jsdom` to reach `SetRow.tsx`'s retry/debounce logic directly, or does it accept API/service-boundary coverage as sufficient signal for Risk #3 and treat the client retry logic as e2e-only (via Playwright route interception to simulate a failed request)? Research surfaced the tradeoff; the decision belongs to planning.
- **Depth of the mid-flow-reset race test**: a hermetic route-level test (mocking the RPC's `profile_missing` error) is the cost-appropriate layer per §1's cost×signal principle — confirm during planning that a live-interleaving integration test is explicitly rejected as over-cost for the signal gained, rather than silently skipped.
