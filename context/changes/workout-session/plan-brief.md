# Workout Session Logging — Plan Brief

> Full plan: `context/changes/workout-session/plan.md`

## What & Why

Let a user launch a planned workout from their weekly plan and log sets (reps/duration + weight) in real time, with the session saved without a separate explicit save action. This is the roadmap's **north star** (S-03) — the smallest end-to-end flow that proves the product hypothesis: a plan that generates well but is painful to act on is still a failed product.

## Starting Point

The DB schema for this feature (`workout_sessions`, `workout_sets`, plus a type `WorkoutSessionWithSets`) has existed since F-01 but is completely unused — no page, API route, or service touches it yet. The weekly plan is currently rendered read-only on the dashboard (`PlanDisplay.astro`) with no way to act on any workout.

## Desired End State

Tapping "Start workout" on the dashboard lands the user directly in a logging screen (zero intermediate taps). Every exercise in the workout is visible on one page; entering reps and weight for a set autosaves silently once both values are valid, pre-filled from the user's last result for that exercise. "Finish workout" is always available and redirects to the dashboard. Returning to a workout with an unfinished session prompts a resume-or-start-over choice.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Launch/resume | Explicit resume-or-restart modal | User wants control over stale sessions, not silent auto-resume |
| Save trigger | Autosave, no button | Debounced save once reps+weight are both valid — no explicit "log set" tap |
| Set defaults | Pre-fill from last session | Cross-session lookup now, not deferred to S-05, per user's explicit choice |
| Exercise layout | Single scrollable page | Simplest build, matches low-friction ethos, all exercises visible at once |
| Finish criteria | No minimum sets required | Matches FR-010; a cut-short workout still saves |
| Restart behavior | Abandon+keep if sets exist, delete if empty | Preserves logged data (PRD guardrail) but avoids empty orphan rows |
| Autosave feedback | Silent, banner only on total failure | User's explicit call — mitigated (not eliminated) by 3 retries with backoff, a `sendBeacon` flush attempt, and a native "leave site?" prompt on navigate-away with unsaved data |
| Clearing a saved field | Deletes the persisted set | User's call — if a field is cleared back to invalid, the DB row is removed rather than left stale; a never-saved row makes no API call when cleared |
| DB integrity | Add reps-XOR-duration CHECK to workout_sets | Closes the same gap already fixed on workout_exercises |
| Improvement indicator | Deferred to S-05 | Pre-fill ships now; the visual "beat your last result" badge stays scoped to its own roadmap slice |
| UI components | Install shadcn input/card/label | Matches AGENTS.md's stated convention |
| Test strategy | Vitest (unit) + Playwright (E2E), both in CI | User's explicit choice over the smaller "manual verification only" default |

## Scope

**In scope:** launch/auto-create a session, resume-or-restart choice for an existing active session, real-time autosave per set with pre-fill from last result, finish action, DB integrity constraint, Vitest unit tests, one Playwright E2E happy path, CI wiring for both.

**Out of scope:** workout history view (S-04), the "you beat your last result" visual indicator (S-05), profile editing, rest timers/supersets, offline support, an explicit standalone "Abandon" action outside the restart flow.

## Architecture / Approach

SSR get-or-create at `/session/[workoutId]`: the Astro page checks for an existing active session and either creates one transparently (first launch) or defers the decision to a client-side modal (returning to an unfinished session). Three small fetch+JSON API routes (`sets` PUT, `complete` POST, `restart` POST) back the React islands, following the existing `plan.ts` convention rather than the older form-POST pattern. A new Postgres RPC (`restart_workout_session`) keeps the abandon-or-delete-then-create-new sequence atomic, mirroring the existing `save_generated_training_plan` RPC precedent.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | XOR check, pre-fill index, atomic restart RPC | Getting the RPC's delete-vs-abandon branch wrong corrupts session history |
| 2. Service & validation | Typed functions for every DB interaction | None major — pure groundwork |
| 3. Vitest setup & tests | First test infra in this repo | Astro+Vitest path-alias wiring is new territory |
| 4. API routes | sets (PUT/DELETE/POST-beacon)/complete/restart endpoints | Ownership checks must be airtight (cross-user data leak risk) |
| 5. Session page & wiring | The actual entry point, middleware, dashboard link | The get-or-create race condition (double-click/two tabs) |
| 6. React islands | Resume modal, logger, autosaving set rows, navigate-away guard | Debounce/upsert/delete/beacon logic is the most novel client-side code in the app so far |
| 7. Playwright E2E & CI | Real-browser happy path, wired into CI | Running Supabase in CI is new infra for this repo's pipeline |

**Prerequisites:** F-01 (done), S-02 (done) — both already merged.
**Estimated effort:** ~4-6 sessions across 7 phases; phase 7 (CI+Supabase-in-Docker) is the most likely to run long.

## Open Risks & Assumptions

- **Silent autosave with no per-set feedback** was the user's explicit choice over the recommended per-row status indicator. This creates real tension with the PRD guardrail "workout data must be persistent after a session is saved... data loss disqualifies the product." Mitigated with three layers: (1) 3 retries with exponential backoff before giving up, (2) a `sendBeacon` best-effort flush of any pending row on page unload, (3) a native "leave site?" browser confirmation when unsaved data exists. None of these are a hard guarantee — a beacon can still fail silently, and a user can still dismiss the unload prompt — so this remains a residual, accepted risk, not a closed one.
- Playwright-in-CI against a Dockerized local Supabase is new infrastructure for this pipeline — first run may need iteration on CI timing/flakiness that isn't fully knowable until Phase 7 actually runs in GitHub Actions.
- The seed fixture for E2E tests bypasses the real signup/onboarding/AI-generation flow by writing directly to the DB with a service-role key — this is intentional (those flows are already covered by S-01/S-02) but means the E2E test doesn't re-verify that upstream integration.

## Success Criteria (Summary)

- A first-time user can go from the dashboard to a saved, finished workout session in one continuous flow, with logged data surviving a page reload.
- Returning to an unfinished workout never silently loses or duplicates already-logged sets.
- `npm run lint`, `npm run build`, `npm run test`, and `npm run test:e2e` all pass in CI.
