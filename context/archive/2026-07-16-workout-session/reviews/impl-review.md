<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Workout Session Logging Implementation Plan

- **Plan**: context/changes/workout-session/plan.md
- **Scope**: Phase 7 of 7 (full plan review — all phases complete)
- **Date**: 2026-07-24
- **Verdict**: REJECTED (pre-triage) → all findings triaged, 8/9 fixed, 1 skipped (no behavioral consequence) — see Triage Summary at end of file
- **Findings**: 1 critical, 5 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification run during this review

- `npm run lint` — pass (0 errors, 12 pre-existing `no-console` warnings matching the established `plan.ts`/`profile.ts` logging convention)
- `npm run build` — pass
- `npm run test` (Vitest) — pass, 12/12 tests, 2 files
- `npm run test:e2e` (Playwright) — **not re-run** in this review (no local Docker/Supabase instance available in this environment); trusted CI's recorded green run per Progress 7.1–7.5 and the last CI-referencing commits

## Findings

### F1 — Clearing a field can race with an in-flight save and silently drop persisted data

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/session/SetRow.tsx:103-114, 116-148

- **Detail**: `deletePersisted()` (fired when a valid+saved row is cleared back to invalid) and `persist()` (fired by the debounced autosave) both write to the same `(session, exercise_id, set_number)` row via independent, unawaited `fetch()` calls with no ordering guarantee between them. `requestIdRef` only suppresses a *stale debounce timer* from firing — it does not cancel an already-in-flight `persist()` call (which can span up to `500+1000+2000=3500ms` across 3 retries) or sequence it against a `deletePersisted()` triggered afterward. Sequence: save reps=10 succeeds → user clears the field (fires unawaited DELETE) → user immediately retypes reps=12 (new debounced PUT completes fast) → the slower DELETE arrives after the PUT commits. The UI shows reps=12 as saved (`onSaved()` already fired) but the server has deleted the row. This directly contradicts the plan's own stated guardrail area (Critical Implementation Details: "clearing a field deletes the persisted set") and the PRD's "data loss disqualifies the product" guardrail cited in the plan brief's Open Risks.
- **Fix**: Serialize `persist` and `deletePersisted` through a single per-row promise queue (e.g. `opQueueRef.current = opQueueRef.current.then(() => op())`) so a delete triggered by clearing always resolves before a subsequent save is sent, and vice versa.
  - Strength: Removes the race at the source with a small, localized change; doesn't touch the retry/backoff logic that's already correct.
  - Tradeoff: Adds a small amount of state/complexity to the row's save lifecycle.
  - Confidence: HIGH — the race is directly observable in the code (no shared mutex, two independent fetches to the same row).
  - Blind spot: Haven't verified server-side behavior under reordered requests beyond reading the route code; a promise queue only fixes client-side ordering, not true server-side idempotency, but that's sufficient here since there's only one client-initiated writer per row.
- **Decision**: FIXED — added `opQueueRef`/`enqueue()` in SetRow.tsx serializing `persist`/`deletePersisted` calls per row.

### F2 — `restart_workout_session` RPC has no unique-violation handling on its final INSERT

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260716130000_workout_session_logging_support.sql:55-57

- **Detail**: `createSession()` in `src/lib/services/session.ts` explicitly catches Postgres `23505` (partial unique index violation) and falls back to fetching the existing active session — this is the documented fix for the "session get-or-create race" in Critical Implementation Details. The `restart_workout_session` RPC's final `INSERT INTO workout_sessions ... VALUES (..., 'active')` has no equivalent safeguard, and neither `restartSession()` in the service layer nor `restart.ts` catches it either. If "Start Over" fires twice near-simultaneously (double-click, two tabs), both transactions can pass the `status = 'active'` check before either commits, then race on the INSERT — one succeeds, the other raises an unhandled `unique_violation`, surfacing as a generic 500. Worse: the losing transaction has *already* abandoned or deleted the original session in the same function call before the INSERT fails, so that request's user is left with no active session and no new one, recoverable only by reloading.
- **Fix A ⭐ Recommended**: Add an `EXCEPTION WHEN unique_violation THEN` clause in the RPC that returns the existing active session's id, mirroring `createSession`'s client-side fallback pattern.
  - Strength: Consistent with the pattern already established and trusted elsewhere in this exact feature (`createSession`); keeps the fix inside the RPC, no caller changes needed.
  - Tradeoff: The exception handler needs a follow-up `SELECT` to find the winning session, adding a small amount of RPC complexity.
  - Confidence: HIGH — same shape of race, same shape of fix, already proven correct in `createSession`.
  - Blind spot: None significant.
- **Fix B**: Take an advisory lock on `(p_user_id, p_workout_id)` at the top of the function before the abandon/delete branch runs.
  - Strength: Prevents the two transactions from interleaving at all, closing the "abandoned but no replacement" window entirely rather than just papering over the final INSERT.
  - Tradeoff: The plan's own Critical Implementation Details section explicitly reasoned that "no advisory lock is needed since a single user can only be restarting their own single workout's session at a time" — this finding shows that reasoning was incomplete (double-click/two-tab is exactly a single user issuing two concurrent restarts), so adopting this fix means revising that documented assumption.
  - Confidence: MEDIUM — closes the race more thoroughly, but is a larger change to reason about than Fix A.
  - Blind spot: Haven't verified whether Postgres advisory locks interact safely with `SECURITY INVOKER` + RLS in this codebase's other RPCs.
- **Decision**: FIXED via Fix A — new migration `supabase/migrations/20260724130000_restart_workout_session_race_fix.sql` wraps the final INSERT in a nested BEGIN/EXCEPTION block catching `unique_violation` and falling back to the winning call's active session id.

### F3 — Unplanned migration: blanket `service_role` grants

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260724120000_grant_table_privileges_to_service_role.sql

- **Detail**: This migration was not in the plan. It grants `ALL PRIVILEGES` on all public tables/sequences plus `ALTER DEFAULT PRIVILEGES` to `service_role`. It's justified and low-risk — `service_role` already bypasses RLS by design and is only used by the Phase 7 E2E seed fixture via a dedicated env var (never exposed to end users); without it, a freshly-provisioned `supabase start` instance (exactly what CI's E2E job spins up) would deny the seed fixture with "permission denied," so this is a necessary enabler for Phase 7's own CI wiring, and it mirrors the already-reviewed `authenticated`-role grant pattern from `context/foundation/lessons.md`. Still, it's unplanned scope that the plan document doesn't record.
- **Fix**: Add a one-line addendum to the plan's Phase 1 or Phase 7 section noting this migration and why it was needed, so the plan stays the accurate source of truth.
- **Decision**: FIXED — added an addendum under plan.md's "Migration Notes" section.

### F4 — Pre-fill contract changed from "value" to "placeholder hint" without updating the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/session/SetRow.tsx:24-29, 174, 189; plan.md Phase 6.4 contract, Progress item 6.6

- **Detail**: Plan Phase 6.4 contract says inputs are "initialized from `lastLoggedSets[exercise_id]`" — i.e., a real starting value — and the Plan Brief's Key Decisions table locks in "Pre-fill from last session" as an explicit user decision. Commit `2b1ac68` changed this: the last-known value is now rendered only as an HTML `placeholder` (grey hint text), never as the actual controlled-input value (`value={quantity}` starts at `""` unless the row was already saved this session). This is a legitimate, well-reasoned bug fix — a real pre-filled value the user never edits would never fire `onChange`, so it would silently never autosave, faking persistence the user believed was recorded, which is the same class of silent-data-loss risk the plan itself calls out elsewhere. But it does mean the locked-in "pre-fill from last session" decision, and Progress checkbox 6.6 ("previously-logged exercise pre-fills"), no longer match literal reality — a user must retype a value even if it's identical to last time, which is a materially different UX than "pre-fill."
- **Fix A ⭐ Recommended**: Keep the current placeholder-only implementation (already shipped, correctly avoids the silent-no-autosave bug) and update the plan/plan-brief text to record this as a deliberate revision of the original "pre-fill from last session" decision.
  - Strength: No further code risk; the shipped behavior is the more correct one relative to the "never silently lose data" guardrail.
  - Tradeoff: The originally-decided UX (values genuinely pre-populated) is not delivered — the user does slightly more typing than the PRD's decision implied.
  - Confidence: HIGH — the current code is correct and tested; this is a documentation catch-up, not a behavior change.
  - Blind spot: Haven't checked whether product/design expected the stronger "auto-filled value" UX badly enough to warrant Fix B instead.
- **Fix B**: Restore true pre-filled values, but track a separate "touched" flag so autosave still fires for an accepted (untouched) pre-fill — e.g., save the pre-filled value once on mount if the user doesn't edit it within the debounce window, or require a lightweight explicit acceptance.
  - Strength: Delivers the originally-decided "pre-fill from last session" UX literally.
  - Tradeoff: Re-introduces meaningful new logic (a mount-time save path) into the already-tricky `SetRow` autosave state machine, with its own edge cases (e.g., what if the user is still deciding whether to log this set at all).
  - Confidence: MEDIUM — plausible, but not designed or reviewed here.
  - Blind spot: Haven't verified how this interacts with the "clearing a field deletes the persisted set" logic if the pre-filled-then-auto-saved value is later cleared.
- **Decision**: FIXED via Fix A — updated `plan.md` Phase 6.4 contract and `plan-brief.md`'s Key Decisions table to record the placeholder-hint revision.

### F5 — No unmount guard on `SetRow`'s retry chain; `deletePersisted` isn't beacon/keepalive-safe

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/session/SetRow.tsx:60-68, 103-114

- **Detail**: Unmount cleanup only clears the debounce timer and calls `clearPending()` — it does not cancel an in-progress `persist()` retry chain (up to ~3.5s across 3 retries) or an in-flight `deletePersisted()`. If a row unmounts mid-retry (e.g., "Start Over" replaces the whole set list), the orphaned promise can still call `onSaved`/`onSaveFailed` against stale closures. Separately, `deletePersisted()` uses a plain `fetch()` (not `keepalive`/beacon), and pending deletions are never registered in `pendingRef` (the map the `beforeunload` guard reads), so a user who clears a field and immediately closes the tab loses that DELETE request with no fallback — the UI already shows the field as cleared, but the server-side row can survive navigation.
- **Fix**: Track an `isMountedRef` (or `AbortController`) to short-circuit retry/delete callbacks after unmount, and register pending deletions in `pendingRef` too (or add `keepalive: true` to the delete `fetch`) so `beforeunload`'s beacon fallback also covers in-flight deletes.
- **Decision**: FIXED — added `isMountedRef` in SetRow.tsx to guard `onSaved`/`onSaveFailed`/retry continuation after unmount, and added `keepalive: true` to `deletePersisted`'s fetch so an in-flight delete survives tab close (sendBeacon can't carry DELETE, so keepalive is the more direct fix here rather than routing deletes through `pendingRef`).

### F6 — Unhandled rejection breaks the JSON-error contract in `sets.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/sessions/[sessionId]/sets.ts:86

- **Detail**: Every other Supabase call in this file (`loadOwnedSession`, `upsertSet`, `deleteSet`) is wrapped in try/catch with `console.error(..., { userId, sessionId, cause })` plus a structured JSON error response, matching `plan.ts`'s established convention. The `getWorkoutWithExercises` call on line 86 is not wrapped — if it throws, the exception propagates uncaught, bypassing both the JSON error contract and the structured server-side logging every sibling call path uses in this same file.
- **Fix**: Wrap the `getWorkoutWithExercises` call in the same try/catch pattern used elsewhere in this file, logging `{ userId, sessionId, cause }` and returning `{ error: "db_error" }` with status 500.
- **Decision**: FIXED — wrapped the call in try/catch matching the file's existing convention.

### F7 — `restart.ts` skips the active-status 409 check its sibling routes perform

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/sessions/[sessionId]/restart.ts

- **Detail**: `sets.ts` and `complete.ts` both check `session.status !== "active"` and return a clean 409. `restart.ts` has no such check and relies on the RPC's `RAISE EXCEPTION` for a non-active existing session, which surfaces as a generic 500 `db_error` instead of a 409. The DB still rejects the operation correctly (safe), but the inconsistency makes this route's error contract diverge from its two siblings for no functional reason.
- **Fix**: Add the same `if (existingSession.status !== "active") return Response.json({ error: "conflict" }, { status: 409 })` check before calling `restartSession`.
- **Decision**: FIXED — added the 409 check to restart.ts, matching sets.ts/complete.ts.

### F8 — Full session+sets+exercises join re-fetched on every autosave call

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/pages/api/sessions/[sessionId]/sets.ts (`loadOwnedSession` → `getSessionWithSets`)

- **Detail**: Every debounced PUT/DELETE (fires every ~600ms per edited field) calls `getSessionWithSets`, which selects the full session row plus all logged sets joined with exercises, purely to check `user_id` and `status`. This grows linearly with sets logged, on every single-field autosave. The plan's own Performance Considerations section states this scale doesn't need extra indexing yet, and this is a genuinely low-priority nit at the PRD's stated "small" target scale — noted for awareness, not urgent.
- **Fix**: Add a lightweight ownership-only query (`id, user_id, workout_id, status`) for the write-path check, reserving the full `getSessionWithSets` for cases that need the set list (initial page load, restart response).
- **Decision**: FIXED — added `getSessionOwnership` in session.ts (selects only `id, user_id, workout_id, status, started_at, completed_at`) and switched `sets.ts`'s PUT/POST/DELETE ownership check to use it instead of the full `getSessionWithSets` join.

### F9 — Session page/modal composition differs from the plan's literal wording

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/session/[workoutId].astro; src/components/session/SessionLogger.tsx:103-114

- **Detail**: The plan's Phase 5.1 contract describes the `.astro` page rendering `SessionLogger` "wrapped by `ResumeRestartModal`... modal blocks interaction with the logger underneath until resolved," implying the page composes both components. In the actual implementation, the page renders only `SessionLogger` with a `needsChoice` prop, and `SessionLogger` itself early-returns to `ResumeRestartModal` when unresolved — so the logger never mounts until the choice is made, rather than being rendered-but-blocked underneath. Functionally equivalent (interaction is blocked either way) and the race-handling / get-or-create logic described in Critical Implementation Details is correctly implemented in the service layer regardless of which component owns the composition.
- **Fix**: None needed — this is a structural detail with no behavioral consequence. Optional: tighten the plan's wording if it's reused as a reference for a similar future feature.
- **Decision**: SKIPPED — not worth fixing now.

## Triage Summary

- **Fixed**: F1, F2 (Fix A), F3, F4 (Fix A), F5, F6, F7, F8 (8)
- **Skipped**: F9 (1)
- Re-verified after fixes: `npm run lint` (0 errors), `npm run build` (pass), `npm run test` (12/12 pass)
- Not re-run: `npm run test:e2e` (no local Docker/Supabase in this environment) — recommend running it once before merge given the SetRow/API changes touched the autosave and restart paths the E2E spec exercises
