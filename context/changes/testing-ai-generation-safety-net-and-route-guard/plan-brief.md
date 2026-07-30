# AI Generation Safety Net + Protected-Route Guard — Plan Brief

> Full plan: `context/changes/testing-ai-generation-safety-net-and-route-guard/plan.md`
> Research: `context/changes/testing-ai-generation-safety-net-and-route-guard/research.md`

## What & Why

This is rollout Phase 3 of `context/foundation/test-plan.md` §3: close the two remaining top-6 risks — a future page shipping without a matching `PROTECTED_ROUTES` entry (risk #4), and a malformed Gemini AI response getting persisted instead of surfacing a clear failure (risk #6). Both risks describe already-correct behavior; research confirmed neither `src/middleware.ts` nor `src/lib/services/plan.ts` has a bug. This is a coverage phase, not a fix.

## Starting Point

`src/middleware.ts` has zero test coverage today, despite gating all four authenticated pages correctly. `src/lib/services/plan.ts`'s `generateTrainingPlan` has two existing tests, but both return before the Gemini client is ever called — the entire response-parsing/remap/re-validation path (`plan.ts:96-128`) is unverified.

## Desired End State

A future `.astro` page added under `src/pages` that reads `Astro.locals.user` but isn't added to `PROTECTED_ROUTES` fails a test automatically — no one has to remember to write a new test for it. A malformed Gemini response (bad JSON, out-of-range index, missing field, or a response that only fails the second validation layer) is proven to throw `PlanValidationError` before persistence, for every guard clause in the parsing path, plus one proof that a well-formed response correctly produces a persistable plan.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Route-list derivation | Auto-derive from `src/pages/**/*.astro` source (scan for `Astro.locals.user`), not a static list | A static re-check of today's 4 routes is the exact anti-pattern `test-plan.md` warns against — it wouldn't catch a future omission | Plan |
| Profile-required gate | Include in this phase, hand-specified (not auto-derived) | Same file gets its first test either way; "needs a profile" is a product decision not inferable from page source | Plan |
| Risk #6 fixture depth | One fixture per guard clause (5 negative + 1 golden path) | Matches the anti-pattern warning against "mocking Gemini to always return a perfect response" | Plan |
| Golden-path coverage | Add a valid-response test proving the index→UUID remap | Research flagged even the happy path as zero-coverage today | Plan |
| E2E scope | None — unit/integration only | `test-plan.md` §3 explicitly scopes Phase 3 to `unit + integration`; Phase 4 only wires *existing* e2e into CI, doesn't add new specs for these risks | Research + Plan |
| Logging assertions | Skip `console.error` shape assertions | Observability side-channel, not the behavior risk #6 describes; avoids pinning a brittle log signature | Plan |

## Scope

**In scope:**
- `src/middleware.test.ts` (new) — protected-route + profile-required gate coverage
- `src/lib/services/plan.test.ts` (extend) — Gemini response-path coverage
- `test-plan.md` §3/§6 sync (status + cookbook note)

**Out of scope:**
- New Playwright e2e specs (not in this phase's scope per `test-plan.md`, and not planned in any future phase for these two risks)
- Integration tests (real DB/Supabase) — both risks are hermetic by design
- `console.error` log-shape assertions
- Any production code changes — both risks are already correctly implemented

## Architecture / Approach

Two independent, hermetic unit-test phases, no shared setup. Phase 1 tests `src/middleware.ts`'s `onRequest` handler directly by calling it with mocked context objects and asserting redirect behavior — no DB, no real Supabase auth. Phase 2 mocks the `GoogleGenAI` client's `models.generateContent` method to return controlled `response.text` fixtures, establishing this repo's first AI-provider-response mocking convention (previously only a `{} as GoogleGenAI` stub was needed, for a branch that never reaches the client).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Protected-route + profile-required guard | `src/middleware.test.ts`, source-derived route coverage | Auto-derivation regex could miss an edge-case page structure — mitigated by verifying it matches today's known-correct 4-page set first |
| 2. AI generation safety net | Extended `plan.test.ts`, golden-path + 5 guard-clause fixtures, cookbook/status sync | First-ever Gemini-response mock in this repo — no existing convention to lean on |

**Prerequisites:** None — both phases are additive test files, no dependency on unmerged work.
**Estimated effort:** ~1 session across 2 phases (small, hermetic, no new infra).

## Open Risks & Assumptions

- The `.astro` source-scan regex (`/Astro\.locals\.user/`) assumes future authenticated pages will keep reading `Astro.locals.user` directly (the current convention). If a future page instead destructures via a different pattern (e.g. a shared helper), the scan would miss it — acceptable given this matches 100% of today's pages and is easy to extend later.
- The post-remap-only fixture (guard clause e) relies on a synthetic malformed candidate `id`, not a scenario that can occur with real DB data (candidate IDs are always valid UUIDs from a PK column) — this deliberately tests the second defensive layer in isolation, per the layered-defense architecture research documented.

## Success Criteria (Summary)

- A future protected page added without a `PROTECTED_ROUTES` entry fails `npm run test` automatically, not silently ships unauthenticated
- Every malformed-Gemini-response guard clause in `plan.ts:96-128` is proven to reject before persistence, and the happy path is proven to correctly remap indices to UUIDs
- `test-plan.md` reflects Phase 3 as `complete`, with cookbook notes for the two new testing patterns this phase establishes
