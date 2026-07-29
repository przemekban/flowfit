# Critical-Path Data Integrity Test Rollout (Phase 2) — Plan Brief

> Full plan: `context/changes/testing-critical-path-data-integrity/plan.md`
> Research: `context/changes/testing-critical-path-data-integrity/research.md`

## What & Why

Rollout Phase 2 of `context/foundation/test-plan.md` §3: prove the north-star session-logging flow persists data (Risk #3) and that `profile.ts`/`plan.ts` — the service layer the team trusts least — behave correctly on their known edge cases (Risk #5). Both risks are already partially "known near-misses": Phase 1's impl-review found and fixed two races (save/delete, restart double-click) with zero regression coverage, and the narrow-equipment plan-generation dead-end was found manually in a prior phase. This phase closes that gap with tests, not new features.

## Starting Point

The DB write path is atomic for both risk areas (single upserts/RPCs, no partial-write branch). Existing coverage is thin: `upsertSet`'s happy path only, `401`/`400` only on the sets route, and a single e2e happy-path spec for Risk #3. `profile.ts`/`plan.ts` have zero unit tests; their API routes cover only the unauthenticated branch. No component-testing tooling exists in the repo (`environment: "node"`, no jsdom).

## Desired End State

Every branch of the four routes touched (`plan`, `profile`, `profile/reset`, `sessions/[id]/sets`) has a hermetic test. `plan.ts`'s two pure business-rule functions and all three `profile.ts` functions are unit-tested against the PRD/roadmap oracle. The `restart_workout_session` race has a real concurrent-call regression test. A new e2e spec proves the autosave failure UX (banner + preserved input) end-to-end. `test-plan.md`'s `e2e on critical flows` gate documentation is corrected to `required (already wired)`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Component-testing tooling for Risk #3 | Stay at API/service boundary; no jsdom/testing-library | Matches `test-plan.md` §4's explicit "not in scope" and cost×signal for a solo MVP | Plan |
| Risk #3 test depth | Full route + service branch coverage + new e2e failure-sim spec | Closes every gap research found; matches the Risk Response Guidance bar ("failed save surfaces a visible error") | Plan |
| E2E gate status | Update `test-plan.md` §5 to `required (already wired)` this phase | CI already runs/blocks on `test:e2e`; this phase supplies the regression coverage the gate is meant to protect | Plan |
| Mid-flow-reset race depth | Hermetic route-level test only (mocked `profile_missing` RPC error) | Explicit cost×signal call in research — a live-timing test needs to delay a real Gemini call | Research |
| Phase structure | Two phases: Risk #5 first, then Risk #3 | Cheapest/purest tests ship first with no dependencies; Risk #3 has the larger surface | Plan |
| `opQueueRef` client race (F1, CRITICAL) | Accept as untestable in this scope; document as residual risk | Pure client JS logic with no service/API surface, given the no-new-tooling decision | Plan |
| `restart_workout_session` race (F2) | Add as a real integration test (`Promise.all`, real concurrency) | The fix lives entirely inside the SQL function body — a mock can't exercise it; matches CLAUDE.md's own "unique constraints a mock would lie about" rule | Plan |

## Scope

**In scope:**
- Unit tests: `plan.ts`'s narrow-equipment guard + re-validation, `profile.ts`'s three functions, `upsertSet`'s error branch
- Full hermetic route-branch coverage: `api/plan.ts`, `api/profile.ts`, `api/profile/reset.ts`, `api/sessions/[sessionId]/sets.ts`
- New integration test: `restart_workout_session` concurrent-call race
- New e2e spec: autosave failure simulation via route interception
- `test-plan.md` gate/cookbook sync

**Out of scope:**
- New component-testing tooling (jsdom/testing-library)
- `opQueueRef` client-race regression test (documented as accepted residual risk)
- Live-interleaving integration test for the mid-flow-reset race
- Risk #4 (protected-route list) and Risk #6 (malformed Gemini output) — Phase 3 territory
- Any production code refactor (this is a test-only rollout)

## Architecture / Approach

No architecture changes — this is test-only. Two phases: Phase 1 closes all of Risk #5 (unit + hermetic route tests, no DB/e2e infra needed). Phase 2 closes Risk #3 (service/route unit tests, one new real-concurrency integration test, one new e2e spec) and finishes with the `test-plan.md` sync now that the north-star flow has coverage.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Risk #5 safety net | Unit tests for `plan.ts`/`profile.ts` pure functions and service calls; hermetic route coverage for `plan`/`profile`/`profile/reset` | Mocking a `RAISE EXCEPTION` error as a plain object instead of a real `Error` instance silently produces a false negative |
| 2. Risk #3 safety net + gate sync | Full route coverage for `sets.ts`; `restart_workout_session` concurrency integration test; e2e failure-sim spec; `test-plan.md` sync | The restart-race integration test needs true concurrency (`Promise.all`), not simulated timing — a sequential-with-delay test would pass without proving anything |

**Prerequisites:** None beyond what's already running in CI (local Supabase for the integration test, Playwright for e2e).
**Estimated effort:** ~2 sessions across 2 phases — Phase 1 is unit-only and small; Phase 2 has more surface (route coverage + 2 new test files + doc sync).

## Open Risks & Assumptions

- The `opQueueRef` save/delete race (CRITICAL, already fixed) ships this phase with zero automated regression protection — an explicit, accepted gap given the no-new-tooling decision, not an oversight.
- The e2e failure-sim spec has a real ~4-5s wall-clock floor per run (debounce + backoff) — expected, not a flake to chase away.

## Success Criteria (Summary)

- Every zero-coverage branch research identified in Risk #3/#5's call paths now has a test deriving its expected value from the PRD/roadmap oracle, not from the current implementation.
- Two previously-fixed, previously-unregression-tested races (restart double-click, mid-flow-reset) each have a test at the cost-appropriate layer.
- `test-plan.md` accurately reflects that the north-star flow's e2e gate is backed by real coverage.
