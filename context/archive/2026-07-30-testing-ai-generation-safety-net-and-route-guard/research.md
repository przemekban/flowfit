---
date: 2026-07-30T17:23:40+02:00
researcher: Claude (Sonnet 5)
git_commit: fef26cd1d888ada0cea93b2f969eca3add69f5d2
branch: main
repository: przemekban/flowfit
topic: "Test rollout Phase 3 — AI generation safety net (risk #6) + protected-route guard (risk #4)"
tags: [research, codebase, testing, middleware, plan-generation, gemini]
status: complete
last_updated: 2026-07-30
last_updated_by: Claude (Sonnet 5)
---

# Research: Test rollout Phase 3 — AI generation safety net + protected-route guard

**Date**: 2026-07-30T17:23:40+02:00
**Researcher**: Claude (Sonnet 5)
**Git Commit**: fef26cd1d888ada0cea93b2f969eca3add69f5d2
**Branch**: main
**Repository**: przemekban/flowfit

## Research Question

`context/foundation/test-plan.md` §3 Phase 3 covers two risks:

- **Risk #4**: a future protected route gets left out of `PROTECTED_ROUTES` and becomes reachable without authentication. Workout-history (`/history`) already shipped (S-04, issue #6) and is already in the list — but nothing tests that the middleware *enforces* the list, or would catch the *next* omission.
- **Risk #6**: a malformed/partial Gemini structured-output response (bad JSON, out-of-range index, missing field) in the AI plan-generation index→UUID remap step gets persisted as a partial/invalid plan instead of surfacing a clear failure.

What exists today for each risk, what's already tested, and what the oracle (correct behavior) is per prior design decisions?

## Summary

Both risks describe **already-correct behavior that is currently unverified by any test** — this is a coverage phase, not a bug-fix phase:

- **Risk #4**: `src/middleware.ts` already protects `/history` correctly. No test exists for the middleware at all (no unit, no e2e). The prior Phase 1 research explicitly deferred this ("Risk #4 ... explicitly scoped to rollout Phase 3, not touched here"). The test-plan's own Risk Response Guidance (test-plan.md:66) already prescribes the shape: a **parametrized** test over the protected-route list, specifically so a *future* addition to a page under `src/pages/` without a matching array entry would fail the test — not just re-confirm today's four routes.
- **Risk #6**: `src/lib/services/plan.ts` already throws `PlanValidationError` pre-persistence for empty response text, invalid JSON, and any out-of-range/malformed index (the zod schema bounds the index against `candidateCount` before the remap ever runs, so the remap itself cannot go out of bounds by construction). The route (`src/pages/api/plan.ts`) already maps that into a 502 `ai_error`. But **zero tests exercise this path** — `plan.test.ts`'s existing `generateTrainingPlan` tests return before the Gemini client is ever called (pre-flight candidate-count guard only), so lines 96–128 of `plan.ts` (the entire response-parsing/remap/re-validation path) are unverified.

Both risks are therefore **regression-prevention** tests: prove today's correct behavior, and prove it in a way that survives a future code change (parametrized route list; parametrized malformed-response fixtures) rather than re-confirming the current four routes / current happy-path shape.

## Detailed Findings

### Risk #4 — Protected-route guard (`src/middleware.ts`)

- Full logic, `src/middleware.ts:1-38`:
  - `PROTECTED_ROUTES = ["/dashboard", "/onboarding", "/session", "/history"]` (line 5)
  - `PROFILE_REQUIRED_ROUTES = ["/dashboard", "/session", "/history"]` (line 6) — `/onboarding` intentionally excluded (profile doesn't exist yet at that point).
  - Lines 9-18: resolves `context.locals.user` via `createClient(...).auth.getUser()`, falling back to `null`.
  - Line 20: `PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))` — **prefix match, not exact/segment match**. A hypothetical `/dashboardXYZ` route would also be gated, which is a latent quirk but not in scope for this phase (no such route exists today).
  - Lines 21-23: unauthenticated + protected → redirect to `/auth/signin`.
  - Lines 26-35: independent second gate — authenticated + protected-with-profile-required + no profile → redirect to `/onboarding`.
- **No test exists.** Repo-wide glob/grep for `middleware.test.ts`, `middleware.spec.ts`, or any test importing `@/middleware`/`onRequest` returns nothing.
- **Current protected surface has no gaps today.** Pages under `src/pages/*.astro`: `auth/{signin,signup,confirm-email}.astro` and `index.astro` are intentionally public; `onboarding.astro`, `dashboard.astro`, `history.astro`, `session/[workoutId].astro` are the four pages reading `Astro.locals.user` and all four are already in `PROTECTED_ROUTES`. So today's array is correct — the risk is entirely about a *future* omission, confirming this phase is about regression protection, not a current bug.
- **Context-mocking convention already established** (`src/pages/api/profile.test.ts:30-44`): a plain object cast `as unknown as APIContext` with `locals.user`, `request: new Request(...)`, `cookies: {} as APIContext["cookies"]`, `redirect: vi.fn(...)`. A middleware test needs the same shape plus a real `url: new URL(...)` (middleware reads `context.url.pathname`, unlike most route handlers), and must mock `@/lib/supabase`'s `createClient` and `@/lib/services/profile`'s `getUserProfile` the same way `profile.test.ts` does.
- **No e2e spec covers unauthenticated access either.** The two existing Playwright specs (`tests/e2e/workout-session.spec.ts`, `tests/e2e/workout-session-save-failure.spec.ts`) only visit `/auth/signin` as a login *setup* step. A new middleware test is purely additive, not redundant with e2e.
- **The test-plan already names the correct shape** (test-plan.md:66, Risk Response Guidance row #4): "unit/integration test on the middleware, parametrized over the protected-route list"; explicit anti-pattern: "a test that only re-checks routes already in the array today — doesn't catch a future omission." The strongest version of this test would derive the "expected protected pages" list independently from `src/pages/**/*.astro` (e.g. every page reading `Astro.locals.user`) and assert every one of them is present in `PROTECTED_ROUTES`, so adding a new authenticated page without updating the array fails the test — not just parametrizing over today's static array (which would only catch a route being *removed* from the array, not a new page being *added* without a matching entry).

### Risk #6 — AI plan-generation malformed-output handling (`src/lib/services/plan.ts`)

- **Parse/validate raw AI response**: `plan.ts:96-106` — empty `response.text` throws `PlanValidationError` (line 98); `JSON.parse(text)` wrapped in try/catch, invalid JSON throws `PlanValidationError` (102-106).
- **Schema validation**: `plan.ts:108-113`, via `generationSchema.safeParse(parsedJson)` — schema built by `buildPlanGenerationSchema` (`src/lib/validation/plan.ts:31-52`), which **already bounds the AI-returned index to `0..candidateCount-1`**. An out-of-range index fails at this schema-parse step, before the remap runs.
- **Index → UUID remap**: `plan.ts:115-123` — `candidates[candidateIndex].id`. Because the schema already bounds the index, this line cannot go out of bounds by construction; it is not itself where the risk lives, contrary to what the risk's phrasing might suggest. The actual risk surface is the schema-rejection path above it, and the re-validation path below it.
- **Guards before persistence**: preflight `candidates.length < MIN_EXERCISES_PER_WORKOUT` (`plan.ts:74-78`); post-remap re-validation via `buildPlanSchema(...).safeParse(plan)` (`plan.ts:125-128`); `validatePlanAgainstCandidates` (`plan.ts:133-169`, called from `src/pages/api/plan.ts:41`) checking candidate-set membership, per-workout duplicate `exercise_id`, and reps/duration XOR. DB-level backstop: a `CHECK` xor constraint in `supabase/migrations/20260714000001_workout_exercises_tracking_xor_check.sql:12-16` inside the `save_generated_training_plan` RPC.
- **The actual coverage gap**: `plan.test.ts`'s `generateTrainingPlan` describe block (lines 37-50) only tests the pre-flight candidate-count guard, using a stub `{} as GoogleGenAI` — **it returns before the Gemini client is ever invoked**. Lines 96-128 of `plan.ts` — the entire "receive AI response → parse → schema-validate → remap → re-validate" path — have **zero test coverage**: empty/missing `.text`, malformed JSON, out-of-range index (now schema-rejected), missing required field, wrong type, workout-count mismatch, and the final `buildPlanSchema` re-validation are all unverified. `src/pages/api/plan.test.ts` mocks `generateTrainingPlan` wholesale, so it only proves route-level status-code mapping (502 `ai_error` etc.), not that the service's parsing logic actually behaves this way.
- **Gemini client wrapper** (`src/lib/ai/gemini.ts:4-9`, `createGeminiClient`) is a thin factory with no parsing/validation of its own — all response handling lives in `plan.ts` via zod, not raw unchecked `JSON.parse`. No `gemini.test.ts` exists.
- **Oracle, already documented** (`context/foundation/tech-stack.md:29`, `context/archive/2026-07-10-ai-plan-generation/research.md:131-149`): the index-based remap is a deliberate workaround for a Gemini structured-output limitation (no direct UUID-in-array support). A prior manual-testing defect — narrow candidate pools (e.g. `resistance_band`-only) letting Gemini repeat one exercise to hit the count minimum, which was schema-valid but nonsensical — was already fixed via the preflight guard + duplicate-`exercise_id` check now living in `validatePlanAgainstCandidates`. Per this documented design, the correct behavior for any malformed/incomplete/out-of-range Gemini response is: throw `PlanValidationError` before persistence, and the API route already turns that into a 502 `{ error: "ai_error" }` (`src/pages/api/plan.ts:42-48`). **Current code appears to already implement this correctly** — Phase 3's job is to prove it with tests, not to fix a bug.

### Historical conventions to reuse (Phases 1 & 2)

- **`createQueryBuilder` mock** (chainable `vi.fn()`s, terminal `single`/`maybeSingle`/`then` resolve `{data, error}`): `src/lib/services/session.test.ts:26-44`, reused verbatim in Phase 2's `profile.test.ts`.
- **`buildContext` helper for API-route tests**: minimal `APIContext` cast, `vi.mock` the dependency module, dynamic-import the route after mocking. Reference: `src/pages/api/sessions/[sessionId]/sets.test.ts`; form-route/redirect variant: `src/pages/api/auth/signup.test.ts`.
- **RPC-error mocking convention** (Phase 2): `Object.assign(new Error(message), { code })`, never a plain `{ message }` object, because routes check `err instanceof Error`.
- **No React component-testing tooling** (`jsdom`/`@testing-library/react`) exists in this repo, and both prior phases explicitly declined to add it — client-side UX/retry logic is tested via Playwright route interception instead (`page.route(...)`), not unit-mounted components. Not directly relevant to Phase 3 (no client-side change here), but rules out reaching for RTL if a plan phase considers UI-level testing.
- **Gemini stubbing precedent**: Phase 2 tested the narrow-equipment guard by passing a stub `{} as GoogleGenAI`, because that branch returns before any Gemini call. Phase 3 is the first phase to actually need a **mocked Gemini response body** (`response.text` set to controlled malformed/valid fixtures) — there is no existing precedent for this in the repo; the plan should establish `generateContent`/`response.text` mocking conventions cleanly as part of this phase's cookbook update.
- **Explicit deferral confirmed in both prior archives**: `context/archive/2026-07-24-testing-api-authorization-safety-net/plan.md` scoped Risk #4 out ("not touched here"); `context/archive/2026-07-29-testing-critical-path-data-integrity/plan.md:34` and `research.md:110` scoped Risk #6's malformed-Gemini-output/index-remap coverage out explicitly to "rollout Phase 3." No overlap risk with prior work.

## Code References

- `src/middleware.ts:1-38` — full protected-route + profile-required gating logic
- `src/pages/api/profile.test.ts:30-44` — `APIContext` mock shape to extend for a middleware test
- `src/lib/services/plan.ts:74-78` — preflight candidate-count guard (already tested)
- `src/lib/services/plan.ts:96-106` — response.text empty/JSON.parse validation (untested)
- `src/lib/services/plan.ts:108-113` — `generationSchema.safeParse`, index bounds enforced here (untested)
- `src/lib/services/plan.ts:115-123` — index→UUID remap (safe by construction once schema passes)
- `src/lib/services/plan.ts:125-128` — post-remap `buildPlanSchema` re-validation (untested)
- `src/lib/services/plan.ts:133-169` — `validatePlanAgainstCandidates` (already tested)
- `src/lib/validation/plan.ts:31-52` — `buildPlanGenerationSchema`, index-bound enforcement
- `src/lib/ai/gemini.ts:4-9` — `createGeminiClient` factory, no parsing logic
- `src/pages/api/plan.ts:41-48` — calls `validatePlanAgainstCandidates`, maps failures to 502 `ai_error`
- `src/lib/services/plan.test.ts:37-50` — existing (incomplete) `generateTrainingPlan` tests
- `supabase/migrations/20260714000001_workout_exercises_tracking_xor_check.sql:12-16` — DB-level backstop CHECK constraint

## Architecture Insights

- FlowFit's AI-response defense is already layered: zod schema (bounds + shape) → service-level re-validation against candidates → DB CHECK constraint. This phase's job is purely to add tests proving each layer holds under adversarial/malformed input, not to add a new layer.
- The middleware's `startsWith` prefix-match semantics are a minor latent footgun (matches `/dashboardXYZ`) but out of scope — no route today triggers a false positive; noting it is enough for now.
- Both risks are best served by hermetic unit tests, not integration/e2e: risk #4 needs no real DB or Supabase auth, just a mocked `context.locals.user`; risk #6 needs no real Gemini call, just controlled `response.text` fixtures. Neither requires the two-user integration fixture pattern used for Risk #1/#2 (IDOR) — this is a divergence worth calling out explicitly in the plan.

## Historical Context (from prior changes)

- `context/archive/2026-07-24-testing-api-authorization-safety-net/plan.md` — Phase 1; deferred Risk #4.
- `context/archive/2026-07-24-testing-api-authorization-safety-net/research.md:34` — middleware only gates page routes, `/api/*` enforcement is fully delegated to handlers.
- `context/archive/2026-07-29-testing-critical-path-data-integrity/plan.md:34`, `research.md:110` — deferred Risk #6's malformed-Gemini-response coverage explicitly to Phase 3.
- `context/archive/2026-07-10-ai-plan-generation/research.md:131-149` — index-based remap rationale (Gemini structured-output limitation) and the narrow-equipment-pool defect that led to `validatePlanAgainstCandidates`.
- `context/foundation/tech-stack.md:29` — index→UUID remap fragility noted as a known design tradeoff (ORQ-2 follow-up note).

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Map, rows #4/#6), §3 (Phase 3 row), §6 (cookbook, referenced conventions above).

## Open Questions

- None blocking planning. One design note worth flagging in the plan: the risk #6 title's phrasing ("out-of-range index in the exercise remap step") is slightly imprecise — the index bound is actually enforced one layer earlier, in the zod schema (`plan.ts:108-113`), before the remap (`plan.ts:115-123`) ever executes. The plan should test the schema-rejection behavior (a fixture with an out-of-range index gets rejected by `generationSchema.safeParse` and throws `PlanValidationError`) rather than trying to force the remap line itself to go out of bounds, which is unreachable given the current guard ordering.
