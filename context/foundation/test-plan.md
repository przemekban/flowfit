# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-24

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`, `tests/` (18 commits/30d — sufficient signal).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                      | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | An API route accepts malformed input or lets a request through without enforcing the auth/ownership check the middleware assumes is already in place, since the route is called directly (bypassing the trusted UI).         | High   | High       | Hot-spot dir `src/pages/api` (12 commits/30d — top churn); AGENTS.md hard rule (zod validation required on all input; `PROTECTED_ROUTES` convention); interview Q4                     |
| 2   | An authenticated user reads, updates, or deletes another user's profile, plan, session, or set data through an API endpoint that doesn't scope its query to the caller, relying solely on RLS as a backstop.                 | High   | Medium     | PRD guardrail ("each user's data is strictly isolated"); AGENTS.md hard rule (RLS required per table); interview Q4 (RLS named among under-tested gaps)                                |
| 3   | During a workout session, a logged set (reps/weight) appears to save in the UI but the autosave request fails silently, and the data is gone on reload or session resume.                                                    | High   | Medium     | Interview Q1 (top user-stated worry); roadmap.md S-03 (north-star flow); PRD guardrail ("workout data must be persistent after a session is saved")                                    |
| 4   | When workout-history (roadmap S-04, GitHub issue #6, next up) ships its new route, the route is left out of `PROTECTED_ROUTES` and history data becomes reachable without authentication.                                    | High   | Medium     | roadmap.md S-04 ("ready", prerequisites met — raises likelihood); AGENTS.md hard rule ("omitting it leaves the route unauthenticated")                                                 |
| 5   | A change to `profile.ts` or `plan.ts` regresses onboarding-profile persistence or plan-generation input mapping without anyone noticing, since the area is both the most actively changed and the one the team trusts least. | Medium | High       | Interview Q3 (named as the lowest-confidence area); interview Q4; hot-spot dir `src/lib/services` (9 commits/30d)                                                                      |
| 6   | The Gemini structured-output response is malformed, incomplete, or has an out-of-range index in the exercise remap step, and a partial or invalid plan gets persisted instead of surfacing a clear failure to the user.      | Medium | Medium     | roadmap.md S-02 known limitation (documented 2026-07-10, equipment-too-narrow dead-end); tech-stack.md ORQ-2 note 3 (index→UUID remap fragility); archive `ai-plan-generation/plan.md` |

**Impact × Likelihood rubric** (High/Medium/Low, coarse by design):

| Rating | Impact                                                          | Likelihood                                               |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| High   | user loses access, data, or money; failure is publicly visible  | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs          |
| Low    | cosmetic, easily reverted, no data effect                       | stable code, rarely touched                              |

Risk #1 is the abuse/authorization lens required for a product with auth + user input: an API boundary must not trust that only the well-behaved frontend will call it. Risk #2 is the companion IDOR-style scenario — ownership must be checked at the query layer, not assumed from RLS alone.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                               | Must challenge                                                                                                                                                                       | Context `/10x-research` must ground                                                                                                            | Likely cheapest layer                                                               | Anti-pattern to avoid                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | Every API route rejects malformed/missing input with a clear 4xx (never a 500 or silent pass-through) and enforces the same auth rule the middleware assumes, even when called directly.                  | "The UI never sends malformed input, so validation is moot" — an API route is a trust boundary regardless of who calls it.                                                           | Which routes under `src/pages/api` already have a zod schema per AGENTS.md convention vs which parse the body unchecked.                       | unit / contract test per route handler                                              | One giant smoke test hitting every route with only valid input — proves routes exist, not that they reject bad input.                                               |
| #2   | A user's authenticated session cannot read, update, or delete another user's rows via any API route, even when a row ID is guessed.                                                                       | "RLS is on so the app layer doesn't need to check" — RLS is a backstop; a service-role client or an unscoped query bypasses it entirely and nothing today proves either layer holds. | Which Supabase client (anon vs service-role) each route uses; whether queries add an explicit owner filter or rely solely on RLS.              | integration test (two authenticated test identities, cross-access attempt)          | Asserting "the policy exists in the migration file" (schema-mirror) instead of proving the behavior; testing only the happy path where a user reads their own data. |
| #3   | A logged set is verifiably persisted (survives reload/resume) even under a slow network or a failed request, and a failed save surfaces a visible error rather than nothing.                              | "The request returned before the user moved on, therefore it saved" — a 200 doesn't guarantee the row landed; check whether failures are swallowed.                                  | The actual autosave call path (client retry/debounce, the API route, the DB write) and existing `session.test.ts` coverage baseline.           | integration test extending the existing `session.test.ts` mocking pattern           | An e2e test that just clicks through the happy path and reads a number off the screen — doesn't prove persistence survived a reload or a failed request.            |
| #4   | The middleware protects `/history` (and any future protected page) the same way it already protects `/dashboard`, `/onboarding`, `/session`, without a developer having to remember a manual step.        | "The pattern is simple so it's low-risk" — simple + manual + one-line array edit is exactly the shape of change that gets forgotten under a 3-week deadline.                         | `middleware.ts`'s current route-matching logic (`startsWith` semantics) and whether any test today asserts protected-route enforcement at all. | unit/integration test on the middleware, parametrized over the protected-route list | A test that only re-checks routes already in the array today — doesn't catch a future omission.                                                                     |
| #5   | A change to `profile.ts`/`plan.ts`'s edge-case handling (e.g. narrow equipment selection, mid-flow reset) behaves per the PRD's stated business rule, without needing a live DB or live Gemini call.      | "It worked in manual testing last time I touched it" — churn without a safety net is exactly what produced the known equipment-too-narrow dead-end.                                  | The actual function signatures/branches in `profile.ts`/`plan.ts`: which parts are pure logic vs I/O-bound.                                    | unit test, mirroring the existing `session.test.ts` mock pattern                    | Asserting against whatever the function currently returns (oracle problem) instead of deriving the expected value from the PRD's business rule.                     |
| #6   | A malformed/partial Gemini response (bad JSON, out-of-range index, missing field) is caught before persistence — no invalid or partial plan row is ever written, and the user sees a clear failure state. | "The re-validation step already guards this so it's covered" — a documented mitigation with zero test coverage is unverified, not verified.                                          | The index→UUID remap function and the re-validation step ahead of the transactional persistence call (roadmap F-01 risk register).             | unit test with crafted malformed fixtures (bad index, missing field, wrong type)    | Mocking Gemini to always return a perfect response (defeats the point), or an e2e test that depends on live Gemini output (flaky, costs quota).                     |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                      | Goal (one line)                                                                                                          | Risks covered | Test types         | Status      | Change folder                                                      |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------ | ----------- | ------------------------------------------------------------------ |
| 1   | API + authorization safety net                  | Defend the highest-churn, highest-impact boundary: input validation and cross-user access control                        | #1, #2        | unit + integration | complete    | `context/archive/2026-07-24-testing-api-authorization-safety-net/` |
| 2   | Critical-path data integrity                    | Prove the north-star session-logging flow persists data and the service layer the team trusts least behaves correctly    | #3, #5        | unit + integration | not started | —                                                                  |
| 3   | AI generation safety net + upcoming route guard | Catch malformed AI output before persistence and future-proof the protected-route list ahead of workout-history shipping | #4, #6        | unit + integration | not started | —                                                                  |
| 4   | Quality-gates wiring                            | Lock unit+integration and critical-flow e2e into CI as required gates                                                    | cross-cutting | gates              | not started | —                                                                  |

3–5 rollout phases. No AI-native testing layer is included: this is a solo, small-scale, 3-week-after-hours MVP where every risk in §2 is caught more cheaply by deterministic fixture-based tests than by an AI-native review layer — see §4 for the explicit cost×signal call.

**Status vocabulary** (fixed — parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. Recommendations are grounded in local manifests (`package.json`, `vitest.config.ts`, `playwright.config.ts`) plus the MCP/tools actually exposed in the current session.

| Layer                | Tool                      | Version | Notes                                                                                                                                                                                                                            |
| -------------------- | ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                    | ^4.1.10 | `@vitest/coverage-v8` installed; existing pattern in `src/lib/services/session.test.ts` mocks the Supabase query builder by hand (chainable `vi.fn()`s)                                                                          |
| API mocking          | none yet — see §3 Phase 1 | —       | No MSW or equivalent installed; current pattern hand-mocks the Supabase client directly rather than the HTTP edge                                                                                                                |
| e2e                  | Playwright                | ^1.61.1 | One spec exists: `tests/e2e/workout-session.spec.ts`                                                                                                                                                                             |
| accessibility        | none yet                  | —       | No axe-core or equivalent; not in scope for this rollout unless a later `--refresh` raises it                                                                                                                                    |
| (optional) AI-native | not included this rollout | n/a     | Cost×signal: solo/small-scale MVP, every §2 risk maps to a deterministic fixture-based test cheaper and more reliable than an AI-native reviewer; revisit only if a future risk genuinely can't be pinned down deterministically |

**Stack grounding tools (current session):**

- Docs: none available — no Context7/framework-docs MCP exposed in this session; checked: 2026-07-24
- Search: none available — no web-search/Exa MCP exposed in this session; checked: 2026-07-24
- Runtime/browser: none available as an MCP — Playwright is used directly as the project's e2e test runner, not as a session tool; checked: 2026-07-24
- Provider/platform: none available — no GitHub/Cloudflare/Supabase MCP exposed in this session; the project's `tasks-github.md` documents `gh` CLI recipes instead; checked: 2026-07-24

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                        | Where                                   | Required?                                                        | Catches                                |
| --------------------------- | --------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| lint + typecheck            | local + CI (`.github/workflows/ci.yml`) | required (already wired)                                         | syntactic / type drift                 |
| unit + integration          | local + CI                              | required after §3 Phase 1                                        | logic and authorization regressions    |
| e2e on critical flows       | CI on PR                                | required after §3 Phase 2                                        | broken north-star session-logging path |
| post-edit hook              | local (agent loop)                      | recommended — configured in Module 3 Lesson 3, out of scope here | regressions at edit time               |
| visual diff (deterministic) | CI on PR                                | optional                                                         | rendering regressions                  |
| multimodal visual review    | CI on PR                                | optional                                                         | visual issues classic diff misses      |
| pre-prod smoke              | between merge + prod                    | optional                                                         | environment-specific failures          |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Service-layer logic** (e.g. `src/lib/services/*.ts`): hand-mock the Supabase query builder — a chainable object whose methods (`select`/`eq`/`neq`/`in`/`order`/`insert`/`update`/`upsert`/`delete`) each return the same builder, with `single()`/`maybeSingle()`/`then()` resolving a fixed `{ data, error }` result. No MSW, no real client. **Reference**: `src/lib/services/session.test.ts` (`createQueryBuilder` helper).
- **API route handlers** (`src/pages/api/**/*.ts`): `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))`, dynamic-import the route module after the mock is registered, and build a minimal `APIContext` object exposing only what the handler reads (`locals.user`, `params`, `request`, `cookies`). Assert on `response.status` and `response.json()`. **Reference**: `src/pages/api/sessions/[sessionId]/sets.test.ts` (`buildContext` helper).
- **Location/naming**: co-located `<file>.test.ts` next to the file under test.
- **Run locally**: `npm run test`.

### 6.2 Adding an integration test

- **Location**: `tests/integration/`, config `vitest.integration.config.ts`, script `npm run test:integration`. Structurally separate from the unit path — `npm run test`'s `include` never picks these up.
- **Fixture**: `tests/integration/fixtures/two-users.ts` seeds two real, authenticated identities (`setupTwoUsers()` → `{ userA, userB }`, each `{ id, sessionId, client }`) against a live local Supabase instance via the service-role admin API; each identity gets its own anon-key `SupabaseClient` signed in via `signInWithPassword` (session state does not leak between identities). Call `teardownTwoUsers()` in `afterAll` — deletes are scoped to the fixture's own generated emails only, per the lessons-learned rule on exact-identifier-scoped fixture cleanup. Env vars: `INTEGRATION_SUPABASE_URL`, `INTEGRATION_SUPABASE_ANON_KEY`, `INTEGRATION_SUPABASE_SERVICE_ROLE_KEY` (from `supabase status -o env`; wired automatically in CI).
- **Reference test**: `tests/integration/session-ownership-rls.test.ts` (`beforeAll`/`afterAll` fixture setup + one `describe` block per function under test).
- **Run locally**: `npx supabase start`, then `npm run test:integration`.

### 6.3 Adding an e2e test

- **Location**: `tests/e2e/`.
- **Naming**: `<flow>.spec.ts`.
- **Reference test**: `tests/e2e/workout-session.spec.ts`.
- **Run locally**: `npx playwright test`.

### 6.4 Adding a test for a new API endpoint

- Every data-touching route needs at minimum an unauthenticated-request contract test: `locals.user = null` → assert `401 { error: "unauthorized" }` (JSON routes) or a redirect to `/auth/signin` (page-form routes). Add a malformed-input case (e.g. non-UUID param, invalid body) asserting `400 { error: "validation_error", ... }` whenever the route parses a param or body with zod. **Reference (JSON route)**: `src/pages/api/sessions/[sessionId]/sets.test.ts`. **Reference (form/redirect route)**: `src/pages/api/auth/signup.test.ts` (mocks `@/lib/supabase`'s `createClient`, builds `request` via `new Request(..., { body: new URLSearchParams({...}) })`, asserts redirect target and `?error=` on validation failure or a Supabase-error passthrough).
- **Location/naming**: co-located `<route>.test.ts`, same directory as the route file.
- **Run locally**: `npm run test`.

### 6.5 Adding a test for cross-user authorization (IDOR)

- Applies to any service-layer function that queries/mutates by row ID without an explicit `user_id` filter, relying on RLS alone. Write an integration test (§6.2), not a hermetic one — a mocked client would lie about whether RLS actually holds.
- Pattern: seed two identities via `setupTwoUsers()`, then for the function under test, pair an **attack case** (userB's client targeting userA's row — assert rejection, e.g. `PGRST116` for `.single()`/`.maybeSingle()` reads, or a thrown error for writes) with a **control case** (userA's own client/row — assert success), so the test proves the assertion shape is valid rather than "everything errors." For statements where RLS silently filters to zero affected rows instead of throwing (e.g. a scoped `DELETE`), assert via a follow-up read as the owning user that the row is unchanged.
- **Reference**: `tests/integration/session-ownership-rls.test.ts` (five functions × attack/control pairs).

### 6.6 Per-rollout-phase notes

(Filled in as each phase lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Astro static/layout pages** — low risk, high churn from styling tweaks; a snapshot test here breaks constantly and catches little. Re-evaluate if a layout page starts carrying business logic. (Source: Phase 2 interview Q5.)
- **shadcn/ui component internals** (`src/components/ui/`) — the installed primitives (`dialog.tsx`, `button.tsx`, etc.) are the library's own tested surface; testing their internals duplicates upstream coverage. Re-evaluate only if a primitive is hand-modified beyond its generated form. (Source: Phase 2 interview Q5.)
- **Exercise library seed data** — developer-authored, read-only, low blast radius; asserting seed content is a data-authoring task, not a test. Re-evaluate if seed data becomes user-editable. (Source: Phase 2 interview Q5, generalized from the "internal admin tools" example.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-24
- Stack versions last verified: 2026-07-24
- AI-native tool references last verified: 2026-07-24 (none in use this rollout)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
