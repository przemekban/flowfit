---
date: 2026-07-30T17:49:15+02:00
researcher: Claude Code
git_commit: fef26cd1d888ada0cea93b2f969eca3add69f5d2
branch: worktree-progress-indicators
repository: flowfit
topic: "Progress indicators (FR-012 / S-05) — per-exercise improvement signal"
tags: [research, codebase, workout-history, workout-session-logging, progress-indicators, schema]
status: complete
last_updated: 2026-07-30
last_updated_by: Claude Code
---

# Research: Progress indicators (FR-012 / S-05)

**Date**: 2026-07-30T17:49:15+02:00
**Researcher**: Claude Code
**Git Commit**: fef26cd1d888ada0cea93b2f969eca3add69f5d2
**Branch**: worktree-progress-indicators
**Repository**: flowfit

## Research Question

How should FlowFit implement "progress indicators" (PRD FR-012 / roadmap S-05): an inline signal on the workout and/or history screen showing which exercises the user improved on compared to the most recent previous session containing that exercise? Scope (per user decision): cover **both** the active workout screen and the history screen. Definition of "improved": **surface candidate definitions with tradeoffs rather than assume one** — this is an oracle question for `/10x-plan` (or a follow-up user decision), not something research should resolve unilaterally.

## Summary

FR-012 is a nice-to-have (PRD priority), prerequisite S-04 (workout-history, done), and the roadmap already flags its cross-session query as the main risk item likely to slip past MVP if capacity is tight. The feature was **explicitly deferred**, by name, when S-03 (workout-session-logging) shipped — its plan states the improvement badge is "formally owned by S-05 (progress-indicators)."

The codebase already contains a partial building block — `getLastLoggedSets()` / the `latest_workout_sets` DB view — but it solves a different problem (pre-filling input placeholders with the single globally-latest set) and **does not generalize** to "most recent previous session before an arbitrary session Y," which is what both target screens need. Reusing it as-is would produce wrong results once a session has partially logged an exercise (mid-session, the lookup nulls out) or when comparing a historical session in the paginated history list (not just the newest).

Both target screens currently have **no client-facing API/hook layer for reads** — history is 100% SSR-rendered Astro with a direct service-function call in the frontmatter; the active session screen fetches everything at page load via SSR too, with only writes (`PUT`/`DELETE` sets) going over HTTP client-side. This significantly shapes implementation options: a comparison feature is more naturally computed server-side and passed down as props/HTML than fetched via a new client API, absent other requirements.

The schema supports the comparison in principle (`exercise_id` is a stable FK, not a per-session copy, so cross-session matching is exact-match, not fuzzy), but no single index makes an arbitrary "session-before-session" lookup an index-only scan — it's either N+1 PostgREST queries (using existing indices, acceptable at MVP's declared "small" data volume) or a new RPC using window functions (matches existing precedent for multi-statement Postgres functions in this codebase). "Improved" itself is genuinely ambiguous at the schema level — four candidate definitions are viable, each with real edge cases (bodyweight exercises with null weight, duration-tracked exercises with no reps, non-overlapping rep ranges, skipped exercises, tie semantics that conflict between PRD wording and FR-012 wording).

## Detailed Findings

### History screen (S-04, shipped) — current implementation

- `src/pages/history.astro` (144 lines) is the **entire** feature — no API route, no React component, no hook exists for history. It's plain SSR Astro with `?page=N` query-string pagination via anchor tags (no client JS at all).
- Data comes from `getWorkoutSessionHistory(supabase, userId, limit, offset)` in `src/lib/services/session.ts:186-223` — a single Supabase query joining `workout_sessions` → `workouts` → `workout_sets` → `exercises`, filtered to `completed`/`abandoned` (excludes the in-progress session), ordered `started_at DESC` / `set_number ASC`, paginated via the "fetch limit+1, trim, infer hasMore" pattern (`.range(offset, offset + limit)`, no `count: "exact"`).
- **No per-exercise grouping across sessions happens in this query today.** Sets come back flat per session, in set-number order, not grouped by exercise.
- DTO shape: `WorkoutSessionWithSets = WorkoutSession & { workout: Workout; sets: (WorkoutSet & { exercise: Exercise })[] }` (`src/types.ts:124-127`) — used for both history rows and the active session.
- UI convention (glassmorphism cards, colored pill badges) is well-established and gives a natural insertion point: `history.astro:105-113` renders a `<ul>` of set rows (`"{exercise.name} · Set {set_number}"` left, formatted value right) — an "improved" badge would append naturally after the exercise name or value on this row, reusing the existing 3-part pill recipe (`border-{color}-500/30 bg-{color}-900/30 text-{color}-300`, seen at `history.astro:93-101` for Completed/Abandoned badges).
- No `Badge` shadcn/ui component exists yet; would either add one or inline a `<span>` matching the existing pattern.

### Active workout session screen (S-03, shipped) — current implementation

- Entry: `src/pages/dashboard.astro` → plain `<a>` link (no client JS) → `src/pages/session/[workoutId].astro` (SSR) loads workout, gets-or-creates the active session, calls `getSessionWithSets` and `getLastLoggedSets`, and hydrates a single React island: `<SessionLogger client:load .../>`.
- `SessionLogger.tsx` owns session-level client state (`currentSession`, `currentLastLoggedSets`, `openCounts`, `failedSaves`, a `pendingRef` for `beforeunload` flush via `sendBeacon`). Per-row numeric state (typed weight/reps) lives inside `SetRow.tsx` itself and is **not lifted up** — `SessionLogger` has no live view of "current value for exercise X, set N" beyond what was true at initial page load, since saved values stay in `SetRow`'s own state rather than being pushed back to the parent.
- `SetRow.tsx` debounces (600ms) and `PUT`s to `src/pages/api/sessions/[sessionId]/sets.ts` (upsert keyed on `(workout_session_id, exercise_id, set_number)`), with retry (3x, exponential backoff).
- The **only** prior-result data the client already has is `LastLoggedSets` (`Record<exercise_id, WorkoutSet | null>`), used exclusively as low-visibility `placeholder=` text on the first unsaved row — not a real value, and it disappears once any set is typed. This is a much weaker signal than an "improved/not" comparison and was explicitly never meant to serve that role (see Historical Context below).
- No toast library is wired up; feedback conventions are inline dismissible banners (errors) and button-label swaps (loading state) — there's no existing "prominent live badge" pattern on this screen to copy verbatim; the history screen's pill-badge convention is the closer precedent even for this screen.

### Data model and query feasibility

- `exercise_id` is a stable FK to a shared `exercises` catalog table (`workout_sets.exercise_id → exercises(id)`, `core_schema.sql:146`) — **not** duplicated per session, so cross-session matching for "the same exercise" is an exact equality join, not name-matching.
- Relevant indices: `idx_workout_sessions_user_completed (user_id, completed_at DESC)` (built for S-04's history query per `lessons.md`), `idx_workout_sets_session (workout_session_id)`, `idx_workout_sets_exercise_logged (exercise_id, logged_at DESC)` (added for S-03's pre-fill lookup, **not** scoped by `user_id`), and the implicit index backing `UNIQUE (workout_session_id, exercise_id, set_number)`.
- RLS + GRANTs are correctly paired on all workout tables per the project's own lessons.md rule — no gap for a new read-only feature using the `authenticated` role.
- **No index today makes an arbitrary "session before session Y, same exercise" lookup an index-only scan.** The natural covering index would need `user_id` denormalized onto `workout_sets` (it currently lives only on `workout_sessions`), or a session-keyed materialized view analogous to `latest_workout_sets` but not collapsed to a single global row.
- Two realistic query shapes:
  - **N+1 via existing PostgREST tooling**: per session × per distinct exercise in that session, one small indexed query. Works with today's tools/indices; acceptable at the PRD's declared "small" scale, but the same class of problem was previously flagged in an impl-review as a scaling concern for the pre-optimization version of `getLastLoggedSets`.
  - **Single RPC using a window function** (`LAG() OVER (PARTITION BY exercise_id ORDER BY completed_at)`): matches existing precedent for multi-statement Postgres functions (`save_generated_training_plan`, `restart_workout_session`), one round trip, but scans the user's full history (bounded by MVP's small target scale) rather than being paginated like the history list itself.

### `getLastLoggedSets` / `latest_workout_sets` — closest existing building block, and why it doesn't generalize

- `latest_workout_sets` (`supabase/migrations/20260729183800_latest_workout_sets_view.sql:9-27`) does `SELECT DISTINCT ON (exercise_id, user_id) ... ORDER BY exercise_id, user_id, logged_at DESC` — collapses to **one row: the single globally most-recent set**, before any session filter, and does not filter by `workout_sessions.status` at all.
- `getLastLoggedSets(supabase, userId, exerciseIds, excludeSessionId)` (`src/lib/services/session.ts:225-256`) applies `.neq("workout_session_id", excludeSessionId)` on top of that already-collapsed view.
- This is correct for its actual use case (pre-filling the *current*, by-definition-newest session) but breaks for FR-012's stated semantics ("most recent previous session," for an *arbitrary* session, not just "the current one"): if the excluded session isn't the globally-latest one, `.neq` either does nothing useful or strips the one row to `null` even when a real earlier session exists. Mid-session, once any set is logged for an exercise, `lastLoggedSets[exerciseId]` stops reflecting any prior-session data at all for that exercise.
- Conclusion: this view/service is a useful reference pattern (per-exercise "latest" via `DISTINCT ON`) but a new query/view is needed for FR-012 — it cannot be reused unmodified.

### Candidate "improved" definitions (oracle candidates — not resolved, per user's explicit choice to have research surface options)

All four are computable from `workout_sets(reps, weight_kg, duration_seconds)` grouped by `(workout_session_id, exercise_id)`:

1. **Best single-set weight** (`MAX(weight_kg)` per session/exercise) — matches PRD Success Criteria wording ("personal record was matched or exceeded," `prd.md:48`). Undefined for bodyweight `reps`-tracked exercises (nullable `weight_kg`) and meaningless for `duration`-tracked exercises.
2. **Total volume** (`SUM(weight_kg × reps)`) — needs both fields non-null on every row; `duration`-tracked sets have `reps = NULL` by the `workout_sets_tracking_xor` CHECK constraint, so this needs a parallel metric (e.g. `SUM(duration_seconds)`) for that tracking type. A session where the exercise was planned but zero sets were logged has no volume — must read as "no data," not a regression.
3. **More reps at same-or-greater weight** — undefined whenever rep ranges between sessions don't naturally order (e.g. 5×60kg vs. 12×40kg) unless a normalization rule (e.g. estimated 1RM) is chosen — that's a design decision the schema can't resolve on its own.
4. **Best set at same/lower rep count vs. best at higher rep count** — same rep-range ambiguity as #3; also undefined for duration-tracked exercises (no `reps` field).

Cross-cutting edge cases for all four: first-time exercise (no prior session at all) must render as "no comparison available," never a false negative; a planned-but-skipped exercise must be excluded, not treated as a regression; tie handling is genuinely ambiguous — PRD's Success Criteria says "matched or **exceeded**" (`>=`) while FR-012's own wording ("improved") reads stricter (`>`) — worth flagging as an open question rather than assuming either; `completed_at` has no uniqueness guarantee, so a stable tiebreak (e.g. `id`) is needed to define "most recent" deterministically.

## Code References

- `src/pages/history.astro:1-144` — entire history feature (SSR, no API/hook layer)
- `src/lib/services/session.ts:186-223` — `getWorkoutSessionHistory`
- `src/lib/services/session.ts:225-256` — `getLastLoggedSets` (closest existing precedent; does not generalize, see above)
- `src/lib/services/session.ts:258-276` — `upsertSet`
- `supabase/migrations/20260729183800_latest_workout_sets_view.sql:9-27` — `latest_workout_sets` view
- `src/pages/session/[workoutId].astro:1-51` — active session page SSR load (workout, session get-or-create, `getLastLoggedSets` call)
- `src/components/session/SessionLogger.tsx:1-184` — session-level client state
- `src/components/session/SetRow.tsx:1-209` — per-set input, debounce/retry, uses `LastLoggedSets` only as placeholder text (lines 188, 203)
- `src/pages/api/sessions/[sessionId]/sets.ts:1-155` — set upsert/delete API route
- `src/lib/validation/session.ts:4-28` — `buildSetLogSchema`, `SetLogInput`
- `src/types.ts:11,15,95-129` — `WorkoutStatus`, `TrackingType`, `WorkoutSession`, `WorkoutSet`, `WorkoutSessionWithSets`, `LastLoggedSets` (no "comparison"/"improvement" type exists yet)
- `supabase/migrations/20260529000000_core_schema.sql:56-63,133-165,171-266` — exercises, workout_sessions, workout_sets tables, indices, RLS
- `supabase/migrations/20260529000002_tracking_type.sql:11-14` — `tracking_type` enum
- `supabase/migrations/20260724110000_workout_session_logging_support.sql:12-16,18` — `workout_sets_tracking_xor` CHECK, `idx_workout_sets_exercise_logged`
- `supabase/migrations/20260716120000_grant_table_privileges_to_authenticated.sql:16` — GRANTs paired with RLS (per lessons.md rule)
- `context/foundation/prd.md:130-137` — FR-011, FR-012, NFR (p95 < 1s; ≥2s ops need continuous progress feedback)
- `context/foundation/roadmap.md:125-135` — S-05 outcome, prerequisites, risk register entry
- `context/foundation/lessons.md` — GRANT/RLS pairing rule; `supabase db reset` prohibition (both apply if this feature adds a migration)

## Architecture Insights

- **Plan vs. log split**: `workouts`/`workout_exercises` (intended plan) vs. `workout_sessions`/`workout_sets` (actual execution log) — a recurring pattern worth preserving; any new "progress" concept is a *derived read* over the log tables, not a new write-side table.
- **SSR-first, minimal client hydration**: both target screens do all data loading server-side in Astro frontmatter; only mutations (set logging, restart) go over client-side HTTP. A comparison feature computed server-side and passed as props fits this convention better than introducing a new client-fetched API, unless a requirement (e.g., live update without page reload) forces otherwise.
- **Exact-match exercise identity**: because `exercise_id` is a stable FK rather than a denormalized per-session value, cross-session comparison logic can rely on plain equality — no fuzzy matching needed.
- **RPC precedent for multi-statement Postgres logic**: `save_generated_training_plan`, `restart_workout_session` are existing `SECURITY INVOKER` RPCs — if the comparison computation is chosen to live in a single query (window-function approach), this is the established pattern to follow, and `context/foundation/test-plan.md` explicitly notes hermetic mocks cannot exercise logic living entirely inside a SQL function body — that would push this phase toward an integration-test-only strategy per the project's two-layer test approach.
- **IDOR-shaped risk applies directly**: any new query reading "another session's" data by ID needs the same cross-user attack/control test pairing already established in `tests/integration/session-ownership-rls.test.ts` (per `test-plan.md` §6.5) — relevant since a comparison query necessarily reads a *different* session than the one currently being viewed/logged.
- **Known recurring risk**: `test-plan.md` and roadmap both flag "new route left out of `PROTECTED_ROUTES`" as a previously-realized risk class (it caused a real incident for S-04) — directly applicable if this feature adds any new route/page.

## Historical Context (from prior changes)

- `context/archive/2026-07-16-workout-session/plan.md:34` — **explicit deferral, by name**: *"No visual 'you beat your last result' indicator during logging — inputs pre-fill silently from the last logged set, but the improvement badge itself is FR-012, formally owned by S-05 (progress-indicators), which depends on S-04 (history) which depends on this slice."* Repeated in `plan-brief.md:23,30,38`.
- `context/archive/2026-05-29-core-db-schema/plan-brief.md:21` — the `workout_exercises` join-table design was justified partly by *"FK integrity and clean per-exercise querying for S-05 personal records"* — the schema's original author already anticipated this feature's shape (a "personal records" style comparison), which supports candidate definition #1 (best single-set weight) as the originally-intended reading, though not a determinative one.
- `context/archive/2026-07-29-workout-history/research.md:41-49` — credits `idx_workout_sessions_user_completed` and `idx_workout_sets_session` (built in F-01, ahead of S-04's actual implementation) for making the history query "highly optimized" — evidence the team has a habit of pre-building indices for known future queries; the same discipline should apply here for whichever comparison query shape is chosen.
- `context/foundation/test-plan.md` §6 cookbook (lines ~130-165) — directly reusable test patterns: hand-mocked Supabase query-builder for service-layer unit tests (`session.test.ts`), zod-validation/auth 400/401 tests for any new route, the cross-user RLS attack/control pattern (`session-ownership-rls.test.ts`), and pure-function fixtures (`plan.test.ts`) as the likely closest analog for testing whatever "compute improvement" pure function this feature introduces.
- `context/foundation/roadmap.md:125-135` — S-05 status `proposed`, marked nice-to-have and the first candidate to slip past MVP if capacity is tight; the per-exercise cross-session query's p95 < 1s requirement is called out as the specific risk.

## Related Research

- `context/archive/2026-07-29-workout-history/research.md` — original S-04 research (history query design)
- `context/archive/2026-07-16-workout-session/plan.md` — S-03 plan (explicit FR-012 deferral, `latest_workout_sets` view origin)
- `context/archive/2026-05-29-core-db-schema/plan.md` — F-01 plan (full schema origin, index design rationale)

## Open Questions

1. **Which "improved" definition to use** — four viable candidates identified (best single-set weight, total volume, more-reps-at-same-weight, best-set-at-higher-rep-threshold), each with real edge cases; PRD wording ("matched or exceeded") and FR-012 wording ("improved") arguably imply different tie semantics (`>=` vs `>`). This needs an explicit decision (likely in `/10x-plan` or a direct user call) before implementation, not an assumption.
2. **Query shape**: N+1 PostgREST queries (simple, reuses existing tooling, acceptable at MVP's small declared scale) vs. a new RPC with a window function (single round trip, matches existing multi-statement-function precedent, but not paginated the same way the history list is, and harder to hermetically unit-test per test-plan.md's own note about SQL-function-body logic).
3. **Duration-tracked exercises**: none of the weight/volume-based definitions apply; a parallel metric (e.g., duration improvement) needs to be defined if duration-tracked exercises are in scope for this feature at all, or they could be explicitly excluded from the indicator in v1.
4. **Live vs. session-load-time computation on the active workout screen**: should the "improved" signal update in real time as the user logs a set during the current session (requiring a live comparison against the already-fetched prior session), or is it computed once at page load and static for the session's duration? This affects whether `SessionLogger`'s current architecture (per-row state not lifted to the parent) needs to change.
5. **Whether a new migration/index/view is needed now or can be deferred** given the "nice-to-have, may slip" status — worth revisiting cost/benefit in `/10x-plan` against the N+1-at-small-scale option before committing to new schema work.
