# AI Generation Safety Net + Protected-Route Guard (Rollout Phase 3) Implementation Plan

## Overview

This is rollout Phase 3 of `context/foundation/test-plan.md` §3, covering Risk #4 (a future page shipping without a matching `PROTECTED_ROUTES` entry) and Risk #6 (a malformed/partial Gemini structured-output response getting persisted instead of surfacing a clear failure). Research (`research.md`) already resolved the oracle for both: `src/middleware.ts` and `src/lib/services/plan.ts` already implement the correct behavior — this plan closes the coverage gap with regression tests, not bug fixes.

## Current State Analysis

- **Risk #4**: `src/middleware.ts` gates `PROTECTED_ROUTES` (`/dashboard`, `/onboarding`, `/session`, `/history`) and, independently, `PROFILE_REQUIRED_ROUTES` (`/dashboard`, `/session`, `/history` — `/onboarding` deliberately excluded). No test exists for the middleware at all. Confirmed by reading every `.astro` page under `src/pages`: exactly the four pages already in `PROTECTED_ROUTES` (`dashboard.astro`, `onboarding.astro`, `history.astro`, `session/[workoutId].astro`) read `Astro.locals.user`; `index.astro` and `auth/*.astro` don't. Today's array is correct — the risk is entirely about a *future* omission.
- **Risk #6**: `src/lib/services/plan.ts:96-128` — the full "receive Gemini response → parse → schema-validate → remap index→UUID → re-validate" path — has zero test coverage. `plan.test.ts`'s existing `generateTrainingPlan` tests both return before the Gemini client is ever called (pre-flight candidate-count guard only). The route test (`api/plan.test.ts`) mocks `generateTrainingPlan` wholesale, so it only proves status-code mapping, not that the service's parsing logic behaves this way. The out-of-range-index bound is enforced by the zod schema (`plan.ts:108-113`, via `buildPlanGenerationSchema`) before the remap (`plan.ts:115-123`) ever runs — the remap line itself is unreachable-out-of-bounds by construction.

## Desired End State

- `src/middleware.test.ts` exists, passes, and covers both gates: the protected-route redirect, derived independently from `src/pages/**/*.astro` source (not a static re-check of today's four routes) so a future page added without a matching array entry fails the test; and the profile-required redirect (hand-specified, since "needs a profile" is a product decision not derivable from page source).
- `src/lib/services/plan.test.ts` is extended with `generateTrainingPlan` tests covering the full Gemini-response path: one golden-path case (valid mocked response → correctly remapped, persistable plan) and one fixture per guard clause (empty/missing `response.text`, invalid JSON, schema-rejected missing field, schema-rejected out-of-range index, post-remap re-validation failure).
- `test-plan.md` §3 Phase 3 row moves to `complete` with this change folder linked, and §6 gains a Phase 3 cookbook note documenting the middleware auto-derivation pattern and the Gemini `generateContent` mocking convention (no prior precedent in this repo).
- **Verify via**: `npm run test`, `npm run lint`, `npm run build` all pass locally and in CI.

### Key Discoveries:

- `middleware.ts`'s `PROTECTED_ROUTES` and `PROFILE_REQUIRED_ROUTES` constants are module-private (not exported) — the test cannot introspect the array directly. This is a feature, not a limitation: testing the exported `onRequest` handler's actual *behavior* against source-derived paths is the stronger design research recommended, since it fails when the handler's real behavior diverges from what a new page needs, not when a private constant happens to differ from a duplicated test-side list.
- Node 22 (`.nvmrc`) supports `fs.readdirSync(dir, { recursive: true })` natively — no glob dependency needed for the `.astro` source scan (none is installed).
- `plan.ts`'s `generateTrainingPlan` takes the `GoogleGenAI` client as a plain parameter (`client.models.generateContent(...)`), so mocking is a plain object stub — no `vi.mock` of `@google/genai` needed, unlike the `@/lib/supabase`-style module mocks used elsewhere in this repo.
- `buildPlanSchema`'s `exercise_id` field is `z.uuid()` (`src/lib/validation/plan.ts:7`) — this is the only place a post-remap-only failure can occur, since every other constraint (`target_sets` range, exercise count, workout count) is already checked by `generationSchema` before the remap runs. A post-remap fixture therefore needs a candidate whose `id` is not a valid UUID, proving the second defensive layer independently.

## What We're NOT Doing

- No Playwright e2e spec for the route guard. `test-plan.md` §3 explicitly scopes Phase 3 to `unit + integration` test types; e2e is not in this phase's Risk Response Guidance's "likely cheapest layer" for either risk #4 or #6, and adding one here would be the exact "e2e because it feels safer" anti-pattern §1 warns against.
- No new e2e coverage in a later phase either — Phase 4 ("Quality-gates wiring") only locks *existing* unit+integration and critical-flow e2e into CI as required gates; it does not add new specs for these two risks.
- No integration test (real DB/Supabase) for either risk — both are hermetic by design per research's Architecture Insights: risk #4 needs no real auth, just a mocked `context.locals.user`; risk #6 needs no real Gemini call, just controlled `response.text` fixtures.
- No `console.error`/log-shape assertions for risk #6's tests — logging is an observability side-channel, not the behavior risk #6 describes (a partial/invalid plan being persisted); pinning a log-call signature risks the cosmetic-mutant-chasing anti-pattern `CLAUDE.md`'s mutation-testing guidance warns against.
- No auto-derivation for `PROFILE_REQUIRED_ROUTES` — unlike the protected-route list, "requires a profile" isn't inferable from a page reading `Astro.locals.user`; it's tested via a hand-specified case set instead, with the `/onboarding` exclusion asserted explicitly as documented, intentional behavior.
- No changes to production code. Both risks describe already-correct behavior (confirmed by research); this phase adds regression coverage only.
- No `/api/*` route coverage in the middleware test — middleware only gates page routes; `/api/*` enforcement is fully delegated to each handler (confirmed in the Phase 1 archive's research, and already covered by Phase 1's per-route `401` tests).
- No new client-side component-testing tooling (`jsdom`/`@testing-library/react`) — neither risk touches client-side code; matches the standing exclusion in `test-plan.md` §4/§7.

## Implementation Approach

Ship Phase 1 (risk #4, middleware) first: it's simpler, fully hermetic, and doesn't require establishing a new mocking convention. Ship Phase 2 (risk #6, AI generation) second: it establishes the Gemini `generateContent` response-mocking convention as new cookbook precedent — the first time this repo mocks an AI provider response body rather than a Supabase client — and closes with the `test-plan.md` sync, mirroring the pattern the archived Phase 2 plan used (cookbook update folded into the final phase, not a separate one).

## Critical Implementation Details

**Middleware auto-derivation algorithm**: The test needs a small helper (not exported from production code, lives in the test file) that walks `src/pages` via `fs.readdirSync(path.join(rootDir, "src/pages"), { recursive: true, withFileTypes: true })`, filters to `.astro` files, excludes anything under `pages/api/` and `pages/auth/` (neither is page-route-gated by this middleware), reads each file's source, and keeps files matching `/Astro\.locals\.user/`. The protected path for each kept file is its first path segment relative to `src/pages` (e.g. `session/[workoutId].astro` → `/session`, `dashboard.astro` → `/dashboard`), deduplicated. This list becomes the input to `describe.each` — a future `.astro` page added under `src/pages` that reads `Astro.locals.user` but isn't yet in the (private, unexported) `PROTECTED_ROUTES` array will appear in this derived list, and the resulting `onRequest` call will fail to redirect, failing the test.

**Gemini response mocking shape**: `generateTrainingPlan(client, profile, candidates)` only ever calls `client.models.generateContent(...)` and reads `.text` off the resolved value — no other `GoogleGenAI` surface is touched. The mock is therefore `{ models: { generateContent: vi.fn().mockResolvedValue({ text: <fixture string> }) } } as unknown as GoogleGenAI`, matching the existing `{} as GoogleGenAI` stub-casting convention from Phase 2's narrow-equipment guard test, extended with the one method actually invoked on this code path.

## Phase 1: Risk #4 — Protected-route + profile-required middleware guard

### Overview

Give `src/middleware.ts` its first test coverage, closing risk #4 with a test strong enough to catch a *future* omission rather than re-confirming today's four routes.

### Changes Required:

#### 1. Protected-route redirect, derived from source

**File**: `src/middleware.test.ts` (new)

**Intent**: Prove `onRequest` redirects every unauthenticated request to `/auth/signin` for each page that reads `Astro.locals.user`, where "each page" is computed independently from `src/pages/**/*.astro` source rather than hardcoded — so a future authenticated page shipping without a matching `PROTECTED_ROUTES` entry fails this test, per the algorithm in Critical Implementation Details.

**Contract**: `vi.mock("@/lib/supabase", ...)` returning a stub whose `auth.getUser()` resolves `{ data: { user: null } }` for the unauthenticated case (and the fake user for a control case); `vi.mock("@/lib/services/profile", ...)` for `getUserProfile`. Build context objects extending the `profile.test.ts` shape (`locals`, `request`, `cookies`, `redirect: vi.fn()`) plus a real `url: new URL("http://test" + derivedPath)` (middleware reads `context.url.pathname`, unlike route handlers) and a `next: vi.fn()`. `describe.each(derivedPaths)`: unauthenticated → `context.redirect` called with `"/auth/signin"`, `next` not called. One control case: an authenticated user with a mocked profile hitting one derived path → `next()` called, `redirect` not called for the auth gate.

#### 2. Profile-required redirect (hand-specified)

**File**: `src/middleware.test.ts` (same file, separate `describe` block)

**Intent**: Prove the second, independent gate — authenticated-but-no-profile redirects to `/onboarding` on `PROFILE_REQUIRED_ROUTES` pages — and that `/onboarding` itself is deliberately excluded from this gate (the profile doesn't exist yet at that point).

**Contract**: `describe.each(["/dashboard", "/session", "/history"])`: authenticated user, `getUserProfile` mock resolves `null` → `context.redirect` called with `"/onboarding"`. Separate case: path `/onboarding`, same authenticated-no-profile mocks → `redirect` not called (falls through to `next()`), asserting the intentional exclusion. Control case: `getUserProfile` resolves a profile object for one representative path → `next()` called, `redirect` not called.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the new `src/middleware.test.ts`
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- In local dev, while logged out, visit `/dashboard`, `/history`, `/session/<any-id>`, and `/onboarding` — each redirects to `/auth/signin`
- Log in with an account that has no profile yet, visit `/dashboard` — redirects to `/onboarding` (not `/auth/signin`)
- Complete onboarding, revisit `/dashboard` — loads normally, no redirect

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Risk #6 — AI generation safety net

### Overview

Close the zero-coverage path in `generateTrainingPlan` (`plan.ts:96-128`) with a golden-path test and one fixture per guard clause, establishing this repo's first Gemini-response-mocking convention. Fold in the `test-plan.md` cookbook/status sync as this rollout's closing phase.

### Changes Required:

#### 1. Golden-path test — valid Gemini response through the full remap

**File**: `src/lib/services/plan.test.ts` (extend existing `describe("generateTrainingPlan")`)

**Intent**: Prove the receive→parse→schema-validate→remap→re-validate path produces a correct, persistable plan from a well-formed Gemini response — currently zero coverage, since both existing tests return before the client is ever called.

**Contract**: A `buildGeminiClient(responseText: string)` test helper per Critical Implementation Details. Fixture: a candidate list of `MIN_EXERCISES_PER_WORKOUT` items with real-shaped UUID `id`s, a hand-built valid generation-shape JSON string (referencing candidates by array index, matching `sessions_per_week`), passed as `response.text`. Assert the resolved `PlanOutput`'s `exercise_id` values equal the candidates' `id`s at the referenced indices (proving the remap), and that the call resolves without throwing (proving `buildPlanSchema` re-validation passed).

#### 2. Malformed-response fixtures, one per guard clause

**File**: `src/lib/services/plan.test.ts` (extend)

**Intent**: Prove each of the five distinct failure branches in `plan.ts:96-128` throws `PlanValidationError` before persistence, closing the exact coverage gap research identified line-by-line.

**Contract**: Five `it` cases, each asserting `.rejects.toBeInstanceOf(PlanValidationError)`: (a) `response.text` is `undefined`/empty string (`plan.ts:97-98`); (b) `response.text` is a non-JSON string (`102-106`); (c) valid JSON missing a required field, e.g. an exercise object without `target_sets` (`108-113`, schema rejection); (d) valid JSON with an `id` outside `0..candidates.length-1` (`108-113` — schema-rejected, per research's Open Questions: this exercises the schema bound, not the unreachable remap line itself); (e) a response that passes `generationSchema` but fails the post-remap `buildPlanSchema` re-validation — achieved by giving one candidate a non-UUID `id` string, so the remap substitutes an invalid `exercise_id` and only the second validation layer (`125-128`) catches it, per the layered-defense note in Critical Implementation Details.

#### 3. Cookbook + rollout status sync

**File**: `context/foundation/test-plan.md`

**Intent**: Record this phase's two new patterns for future contributors and close out the rollout row.

**Contract**: Add a §6.6 note for Phase 3 pointing at `src/middleware.test.ts` as the reference for the source-derived route-list pattern, and the extended `src/lib/services/plan.test.ts` as the reference for the `GoogleGenAI` `generateContent` mocking convention. Update §3's Phase 3 row: Status → `complete`, Change folder → this change's path.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the extended `src/lib/services/plan.test.ts`
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- In local dev, complete onboarding with a normal (non-narrow) equipment selection and generate a plan — it still generates and saves successfully end-to-end, confirming no regression from the new test-only mocking conventions (production code is unchanged)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/middleware.test.ts`: source-derived protected-route redirects (attack + control), hand-specified profile-required redirects (attack + control + exclusion case)
- `src/lib/services/plan.test.ts`: golden-path Gemini remap, five malformed-response guard-clause fixtures

### Integration Tests:

- None — both risks are hermetic by design (see What We're NOT Doing)

### Manual Testing Steps:

1. Logged-out visits to all four protected pages redirect to `/auth/signin`
2. Logged-in, no-profile visit to `/dashboard` redirects to `/onboarding`
3. Post-onboarding, normal-equipment plan generation still succeeds end-to-end

## Performance Considerations

None — this phase is test-only; no production code changes.

## Migration Notes

None — no schema or data changes.

## References

- Related research: `context/changes/testing-ai-generation-safety-net-and-route-guard/research.md`
- Middleware source: `src/middleware.ts:1-38`
- AI generation service: `src/lib/services/plan.ts:69-131`
- Existing mock conventions: `src/pages/api/profile.test.ts:30-44` (`APIContext` shape), `src/lib/services/plan.test.ts:37-50` (`{} as GoogleGenAI` stub precedent)
- Prior phase precedent for cookbook-update-in-final-phase: `context/archive/2026-07-29-testing-critical-path-data-integrity/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #4 — Protected-route + profile-required middleware guard

#### Automated

- [ ] 1.1 `npm run test` passes, including the new `src/middleware.test.ts`
- [ ] 1.2 `npm run lint` passes
- [ ] 1.3 `npm run build` passes

#### Manual

- [ ] 1.4 Logged-out visits to `/dashboard`, `/history`, `/session/<any-id>`, `/onboarding` redirect to `/auth/signin`
- [ ] 1.5 Logged-in, no-profile visit to `/dashboard` redirects to `/onboarding`
- [ ] 1.6 Post-onboarding revisit to `/dashboard` loads normally

### Phase 2: Risk #6 — AI generation safety net

#### Automated

- [ ] 2.1 `npm run test` passes, including the extended `src/lib/services/plan.test.ts`
- [ ] 2.2 `npm run lint` passes
- [ ] 2.3 `npm run build` passes

#### Manual

- [ ] 2.4 Normal-equipment plan generation still succeeds end-to-end in local dev
