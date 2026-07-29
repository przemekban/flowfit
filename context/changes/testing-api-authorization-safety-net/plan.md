# API + Authorization Safety Net Implementation Plan

## Overview

Phase 1 of the phased test rollout (`context/foundation/test-plan.md` §3). Builds the safety net for the two highest-risk items in §2's Risk Map: **Risk #1** (an API route accepts malformed input or skips the auth check the middleware doesn't actually enforce for `/api/*`) and **Risk #2** (an authenticated user reaches another user's session/set data through a query that doesn't scope to the caller, relying solely on RLS).

## Current State Analysis

- `src/middleware.ts` only gates page routes (`PROTECTED_ROUTES`/`PROFILE_REQUIRED_ROUTES` are page paths); `/api/*` never matches. Every data-touching route (`profile.ts`, `profile/reset.ts`, `plan.ts`, the three `sessions/[sessionId]/*.ts`) already has its own `if (!context.locals.user)` check today — nothing is broken, but nothing would catch a future omission either.
- Five functions in `src/lib/services/session.ts` (`getSessionOwnership`, `getSessionWithSets`, `upsertSet`, `deleteSet`, `completeSession`) query/mutate by row ID alone, with no `user_id` filter. Every current call site wraps the two reads in a `loadOwnedSession` helper — duplicated verbatim in `sets.ts`, `complete.ts`, `restart.ts` — that compares `session.user_id === userId` before trusting the result. RLS is the only other backstop; nothing today proves it holds.
- The three `auth/*.ts` routes are missing `export const prerender = false` (AGENTS.md hard-rule violation), and `signup.ts`/`signin.ts` cast `form.get(...) as string` with zero zod validation — the only routes in the app without it.
- `sessions/[sessionId]/*.ts` check `sessionId` for truthiness only; a malformed (non-UUID) value reaches Postgrest, throws a non-`PGRST116` error, and falls into the generic `500 db_error` branch instead of a `400`.
- Zero tests exist under `src/pages/api`. The only test convention is hand-mocking the Supabase query builder (`src/lib/services/session.test.ts`) — no MSW/supertest in the project. CI runs Vitest *before* `supabase start`, so no live Postgres is available during today's test step.

## Desired End State

Every data-touching API route has a hermetic contract test proving it rejects unauthenticated calls, so a future route (or edit) that drops the check fails CI. The five owner-filter-less `session.ts` functions have integration tests proving real RLS blocks cross-user access, independent of the app-layer guard. The `loadOwnedSession` triplication is gone. The three auth routes carry `prerender = false` and zod validation. `test-plan.md`'s cookbook (§6.1, §6.2, §6.4, §6.5) documents the patterns established here for future phases to reuse.

Verify via: `npm run test` and `npm run test:integration` both green locally and in CI; `npm run lint` and `npm run build` pass; manual checks per phase below.

### Key Discoveries

- `src/pages/api/sessions/[sessionId]/sets.ts:20-34`, `complete.ts:13-27`, `restart.ts:13-27` — three verbatim copies of `loadOwnedSession`
- `src/lib/services/session.ts:111-129,136-165,209-266` — the five owner-filter-less functions
- `.github/workflows/ci.yml:21-28` — `npm run test` runs before `supabase start`; no live Postgres available today
- `tests/e2e/fixtures/seed.ts:1-23` — existing service-role seeding pattern (Playwright-only, not reused here per decision below)

## What We're NOT Doing

- No new e2e coverage — `tests/e2e/workout-session.spec.ts` is untouched.
- No integration/RLS tests for `profile.ts`/`plan.ts`/`profile/reset.ts` reads — those already filter explicitly by `user_id` at the query layer (`getUserProfile`, `getActivePlan`); they get hermetic 401-contract tests only, same as every other route. The RLS-integration layer targets exactly the five owner-filter-less functions research flagged as the latent IDOR shape.
- No structural/meta-test that scans `src/pages/api` for a guard pattern — per-route contract tests only, per explicit decision below.
- No password-strength business rules in the new auth-route zod schemas — Supabase Auth owns that policy; zod validates shape/type only.
- No reuse of `tests/e2e/fixtures/seed.ts` for integration-test fixtures — new, dedicated setup, per explicit decision below (different runner, different lifecycle).
- No CI gate gets `required` status flipped in `test-plan.md` §5 — it already reads "required after §3 Phase 1"; this phase makes that true, it doesn't change the row.

## Implementation Approach

Five phases in dependency order: environment (integration test runner + fixtures + CI wiring) → the integration-dependent risk (#2, needs the environment) → hermetic risk #1 coverage for session routes (dedup + contract tests) → hermetic risk #1 coverage for auth routes (fix + contract tests) → cookbook/test-plan sync. Phases 3 and 4 don't technically depend on Phase 1, but are sequenced after it to match the project's established environment-first ordering convention.

Two-layer split per `test-plan.md` §1 cost×signal: integration (real Postgres, two real identities) proves RLS itself holds for the five unguarded functions — a mock would lie about this. Hermetic (mocked client) proves the app layer calls the right guard on every route — cheaper, and integration coverage of "did route X call the 401 check" would only be testing wiring, not a DB constraint.

## Critical Implementation Details

**RLS-denial test semantics**: A `.single()`/`.maybeSingle()` call whose target row is invisible under RLS returns the *same* `PGRST116` ("no rows returned") error as a genuinely nonexistent row — not a permission-denied error. Phase 2's assertions must match on this shape (mirroring the existing `isPostgrestError`/`PGRST116` check already used in `loadOwnedSession`), not assume a distinct "forbidden" signal exists.

**Test client session isolation**: Each seeded test identity in Phase 1's fixture needs its own `SupabaseClient` instance (anon key) authenticated via `signInWithPassword` — a single shared client's session state would leak between "act as user A" and "act as user B" assertions within the same test file.

## Phase 1: Integration test environment

### Overview

Establishes a Vitest config, npm script, and two-user fixture that require a live local Supabase instance, kept fully separate from the fast, DB-free `npm run test` unit path.

### Changes Required:

#### 1. Integration Vitest config

**File**: `vitest.integration.config.ts` (new, project root)

**Intent**: A separate config so integration tests requiring live Postgres never run inside the default `npm run test`, and vice versa.

**Contract**: Same `resolve.alias` (`@` → `./src`) and `environment: "node"` as `vitest.config.ts`; `test.include: ["tests/integration/**/*.test.ts"]`. No coverage config — coverage is a unit-test concern per `test-plan.md` §4.

#### 2. npm script

**File**: `package.json`

**Intent**: Expose the new config as its own command.

**Contract**: add `"test:integration": "vitest run --config vitest.integration.config.ts"` alongside the existing `"test"` script.

#### 3. Two-user integration fixture

**File**: `tests/integration/fixtures/two-users.ts` (new)

**Intent**: Service-role-seeded pair of real, authenticated identities, each owning a workout + active session + one logged set, so Phase 2 has real rows to attempt cross-access against.

**Contract**: Exports `async function setupTwoUsers(): Promise<{ userA: TestIdentity; userB: TestIdentity }>` where `TestIdentity = { id: string; sessionId: string; client: SupabaseClient }` and `client` is an anon-key `@supabase/supabase-js` client already authenticated via `signInWithPassword` as that user. Exports `async function teardownTwoUsers(): Promise<void>` deleting both users via the service-role admin API (cascades per the existing FK convention, same pattern as `tests/e2e/fixtures/seed.ts:30-33`). Reads `INTEGRATION_SUPABASE_URL`, `INTEGRATION_SUPABASE_ANON_KEY`, `INTEGRATION_SUPABASE_SERVICE_ROLE_KEY` from `process.env`, throwing a clear setup-instructions error if any is missing (same convention as `tests/e2e/fixtures/seed.ts:13-19`). Deliberately not shared with `tests/e2e/fixtures/seed.ts` — different runner (Vitest per-file setup/teardown vs. Playwright global setup) and different lifecycle (created and torn down per test file here, once per e2e run there).

#### 4. CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Give the new integration suite a live local Supabase instance without slowing down or gating the existing fast unit step.

**Contract**: Insert a new step running `npm run test:integration` immediately after the existing "Export local Supabase connection details" step (line ~28-30, after `supabase status -o env`) and before `npx playwright install` (line ~35), with `env: { INTEGRATION_SUPABASE_URL: ${{ env.API_URL }}, INTEGRATION_SUPABASE_ANON_KEY: ${{ env.ANON_KEY }}, INTEGRATION_SUPABASE_SERVICE_ROLE_KEY: ${{ env.SERVICE_ROLE_KEY }} }`.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` runs against a locally started Supabase instance and exits 0
- `npm run test` (unit config) does not pick up anything under `tests/integration/**` — its `include` pattern (`src/**/*.test.ts`) already excludes it structurally

#### Manual Verification:

- Run `npx supabase start`, then `npm run test:integration` locally; confirm via Studio UI (`localhost:54323`) that the two seeded users and their rows are created and cleaned up (no leftover rows after the run)

---

## Phase 2: Risk #2 — cross-user IDOR integration tests (real RLS)

### Overview

Proves RLS blocks cross-user access to the five owner-filter-less `session.ts` functions, independent of the app-layer `loadOwnedSession` guard — the actual question Risk #2 asks.

### Changes Required:

#### 1. RLS cross-access test suite

**File**: `tests/integration/session-ownership-rls.test.ts` (new)

**Intent**: For each of `getSessionOwnership`, `getSessionWithSets`, `upsertSet`, `deleteSet`, `completeSession` (`src/lib/services/session.ts:111-266`), call it with userB's authenticated client targeting userA's seeded `sessionId`, and assert RLS denies the operation. Pair each with a control case using userA's own client/ID, proving the fixture and assertion shape are valid rather than "everything errors."

**Contract**:
- Reads (`getSessionOwnership`, `getSessionWithSets`): userB's call rejects with a `PostgrestError` coded `PGRST116`; userA's own call resolves with the row.
- `upsertSet`, `completeSession` against userA's `sessionId` via userB's client: reject (RLS denies the underlying INSERT/UPDATE).
- `deleteSet` against userA's `sessionId`/set via userB's client: resolves without throwing (a DELETE with an RLS-filtered `WHERE` simply matches zero rows) — assert via a follow-up read as userA that the set still exists, since `deleteSet`'s return type is `void` and doesn't surface an affected-row count.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` — all 5 attack cases + 5 control cases + the `deleteSet` zero-rows-affected follow-up pass

#### Manual Verification:

- None beyond Phase 1's manual check — this phase's protection is fully demonstrated by automated integration tests against a real local Supabase instance

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Risk #1 — dedupe ownership guard + hermetic contract tests (session routes)

### Overview

Removes the three-way `loadOwnedSession` duplication, adds `sessionId` format validation, and adds the per-route unauthenticated-request contract test that is Risk #1's actual regression guard.

### Changes Required:

#### 1. Shared ownership helper

**File**: `src/lib/services/session.ts`

**Intent**: Replace the three verbatim-duplicated `loadOwnedSession` implementations (`sets.ts:20-34`, `complete.ts:13-27`, `restart.ts:13-27`) with one shared, generic implementation, so a future change to the ownership-comparison or `PGRST116`-handling logic can't silently diverge between the three copies.

**Contract**: `export async function loadOwnedSession<T extends { user_id: string }>(loader: () => Promise<T>, userId: string): Promise<T | null>` — calls `loader()`; returns the result if `result.user_id === userId`; returns `null` on ownership mismatch or when `loader()` throws a `PostgrestError` coded `PGRST116`; rethrows any other error. Moves the `isPostgrestError` type guard here too (currently duplicated in the same three route files).

#### 2. Session route files

**Files**: `src/pages/api/sessions/[sessionId]/sets.ts`, `complete.ts`, `restart.ts`

**Intent**: Consume the shared helper; validate `sessionId` shape before querying, so a malformed value returns `400` instead of falling through to the generic `500 db_error` branch.

**Contract**: Replace `if (!sessionId) return 404` with `z.uuid().safeParse(sessionId)`, returning `400 { error: "validation_error", message: "sessionId must be a UUID" }` on failure. (Astro's dynamic-route matching guarantees `sessionId` is present when the handler runs, so this check only needs to cover format, not presence.) Replace each file's local `loadOwnedSession(supabase, sessionId, userId)` call with the shared `loadOwnedSession(() => getSessionOwnership(supabase, sessionId), userId)` (`sets.ts`) or `loadOwnedSession(() => getSessionWithSets(supabase, sessionId), userId)` (`complete.ts`, `restart.ts`). Delete the local `loadOwnedSession`/`isPostgrestError` definitions from all three files.

#### 3. Shared-helper unit tests

**File**: `src/lib/services/session.test.ts` (extend)

**Intent**: Cover the new shared `loadOwnedSession`'s branches directly — today only exercised indirectly, per-route.

**Contract**: Three `it` cases using the existing hand-mocked builder convention: matching `user_id` → returns the row; mismatched `user_id` → returns `null`; `single()` rejecting with `{ code: "PGRST116" }` → returns `null`; `single()` rejecting with any other error → the call rejects.

#### 4. Route contract tests

**Files**: `src/pages/api/profile.test.ts`, `src/pages/api/profile/reset.test.ts`, `src/pages/api/plan.test.ts`, `src/pages/api/sessions/[sessionId]/sets.test.ts`, `complete.test.ts`, `restart.test.ts` (all new)

**Intent**: The Risk #1 regression guard — one test per route proving an unauthenticated call is rejected, so a future edit that drops the check fails CI immediately.

**Contract**: Each constructs a minimal context object exposing only what the handler actually reads (`locals.user`, `request`, `params`, `cookies`, `redirect`), sets `locals.user = null`, and asserts: JSON routes (`plan.ts`, `sets.ts`, `complete.ts`, `restart.ts`) return `401 { error: "unauthorized" }`; redirect routes (`profile.ts`, `profile/reset.ts`) return a redirect to `/auth/signin`. `sets.ts`/`complete.ts`/`restart.ts` additionally get one authenticated-but-malformed-`sessionId` case asserting `400`.

### Success Criteria:

#### Automated Verification:

- `npm run test` — all new and extended unit tests pass
- `npm run lint` passes (no leftover duplicated `isPostgrestError`/`loadOwnedSession` in the three route files)
- `npm run build` succeeds (confirms the three routes still type-check against the shared helper's generic signature)

#### Manual Verification:

- Via `npm run dev`: call `PUT /api/sessions/<real-id>/sets` unauthenticated and confirm `401`; call `POST /api/sessions/not-a-uuid/complete` authenticated and confirm `400`

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Risk #1 — fix and cover the auth routes

### Overview

Closes the two present-tense findings from research (missing `prerender = false`, missing zod validation on `signup.ts`/`signin.ts`) and adds the first hermetic tests for Astro form-handler `APIRoute`s in this codebase.

### Changes Required:

#### 1. Auth route fixes

**Files**: `src/pages/api/auth/signup.ts`, `signin.ts`, `signout.ts`

**Intent**: Close the AGENTS.md hard-rule violation and the zod-validation gap on the two routes reading client input.

**Contract**: Add `export const prerender = false;` to all three. In `signup.ts`/`signin.ts`, replace the unchecked `form.get(...) as string` casts with `z.object({ email: z.email(), password: z.string().min(1) }).safeParse({ email: form.get("email"), password: form.get("password") })`; on failure, redirect via the existing `?error=` pattern using the first zod issue's message (mirrors `profile.ts:38-41`'s `onboardingSchema` failure handling). Password validation stays shape-only (non-empty string) — Supabase Auth's own policy remains the source of truth for strength, consistent with how its rejection already surfaces via `error.message`.

#### 2. Auth route tests

**Files**: `src/pages/api/auth/signup.test.ts`, `signin.test.ts`, `signout.test.ts` (all new)

**Intent**: First hermetic coverage of Astro form-handler routes in this codebase — happy path, validation failure, and Supabase-error passthrough.

**Contract**: Mock `@/lib/supabase`'s `createClient` to return a stub `{ auth: { signUp / signInWithPassword / signOut: vi.fn() } }`. Build `context.request` via `new Request("http://test", { method: "POST", body: new URLSearchParams({ email, password }) })` so `context.request.formData()` resolves realistically. Cases: valid email/password → redirects to `/auth/confirm-email` (signup) or `/dashboard` (signin), mocked Supabase call invoked with the parsed args; empty password → redirects with `error=`, Supabase never called; malformed email → same; Supabase call resolving `{ error }` → redirect carries `error.message`. `signout.ts`: calls `signOut()` when `createClient` returns a client, redirects to `/` in both cases.

### Success Criteria:

#### Automated Verification:

- `npm run test` — new auth-route tests pass
- `npm run lint` — no `as string` casts remain in `signup.ts`/`signin.ts`
- `npm run build` succeeds

#### Manual Verification:

- Sign up and sign in through the UI (`/auth/signup`, `/auth/signin`) still work end-to-end — the zod addition must not break the existing happy path
- Submit the signup form with an invalid email (e.g. via curl/devtools) and confirm a friendly `?error=` redirect, not a 500

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 5.

---

## Phase 5: Cookbook + test-plan sync

### Overview

Fills in `test-plan.md`'s Phase-1-scoped cookbook sections now that the patterns exist, and closes out the rollout status for this phase.

### Changes Required:

#### 1. Test-plan cookbook and status

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the four "TBD — see §3 Phase 1" placeholders with the real patterns established in Phases 1-4, and mark Phase 1 complete.

**Contract**: §6.1 (adding a unit test) documents the hand-mocked-Supabase-client + minimal-context-object pattern from Phase 3/4, referencing a concrete test file. §6.2 (adding an integration test) documents the `vitest.integration.config.ts` + `npm run test:integration` + `tests/integration/fixtures/two-users.ts` pattern from Phase 1. §6.4 (new API endpoint) references a Phase 3/4 route test as the template. §6.5 (cross-user IDOR) references Phase 2's `session-ownership-rls.test.ts` as the template. §3's Phase 1 row `Status` column → `complete`.

### Success Criteria:

#### Automated Verification:

- `npm run format` (prettier via lint-staged) produces no diff on the edited markdown

#### Manual Verification:

- Read §6.1/6.2/6.4/6.5 as a first-time implementer of a future phase and confirm each points to a real, existing file from Phases 1-4

---

## Testing Strategy

### Unit Tests:

- Every data-touching route (6 files) gets an unauthenticated-request contract test (401/redirect)
- `sets.ts`/`complete.ts`/`restart.ts` get a malformed-`sessionId` (`400`) case
- The new shared `loadOwnedSession` gets direct own/not-own/not-found/other-error coverage
- `signup.ts`/`signin.ts`/`signout.ts` get happy-path, validation-failure, and Supabase-error-passthrough cases

### Integration Tests:

- The five owner-filter-less `session.ts` functions get real-RLS cross-user attack + control cases against a locally running Supabase instance

### Manual Testing Steps:

1. `npm run dev` → attempt each session mutation route unauthenticated, confirm `401`
2. `npm run dev` → attempt a session route with a malformed `sessionId`, confirm `400`
3. Sign up / sign in through the UI, confirm no regression from the new zod validation
4. `npx supabase start` + `npm run test:integration` locally, confirm no leftover seeded rows after the run

## Performance Considerations

The integration suite adds Supabase admin-API user creation/deletion per test-file run (a few seconds); it only runs in `test:integration`, never in the fast default `npm run test`, so day-to-day unit-test iteration speed is unaffected.

## Migration Notes

No database schema changes. `sessionId` format validation (`400` instead of `500` on malformed input) is a behavior change but strictly narrows an existing error path — no valid caller today relies on the `500` response.

## References

- Research: `context/changes/testing-api-authorization-safety-net/research.md`
- Test-plan strategy: `context/foundation/test-plan.md` §2 (Risk Map, Risk Response Guidance), §3 (Phase 1 row)
- Existing hand-mock convention: `src/lib/services/session.test.ts:26-44`
- Existing service-role fixture convention (not reused, referenced for pattern): `tests/e2e/fixtures/seed.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Integration test environment

#### Automated

- [x] 1.1 `npm run test:integration` runs against a local Supabase instance and exits 0 — 010e6b6
- [x] 1.2 `npm run test` does not pick up `tests/integration/**` — 010e6b6

#### Manual

- [x] 1.3 Local run confirms two seeded users are created and cleaned up with no leftover rows — 010e6b6

### Phase 2: Risk #2 — cross-user IDOR integration tests (real RLS)

#### Automated

- [x] 2.1 All 5 attack + 5 control cases + the `deleteSet` zero-rows-affected follow-up pass in `npm run test:integration` — 23c5a68

### Phase 3: Risk #1 — dedupe ownership guard + hermetic contract tests (session routes)

#### Automated

- [x] 3.1 `npm run test` passes with all new/extended unit tests
- [x] 3.2 `npm run lint` passes, no duplicated `isPostgrestError`/`loadOwnedSession` remain
- [x] 3.3 `npm run build` succeeds

#### Manual

- [ ] 3.4 Unauthenticated `PUT /api/sessions/<real-id>/sets` returns 401; malformed `sessionId` on `complete` returns 400

### Phase 4: Risk #1 — fix and cover the auth routes

#### Automated

- [ ] 4.1 `npm run test` passes with new auth-route tests
- [ ] 4.2 `npm run lint` passes, no `as string` casts remain in `signup.ts`/`signin.ts`
- [ ] 4.3 `npm run build` succeeds

#### Manual

- [ ] 4.4 Sign up/sign in through the UI still work end-to-end
- [ ] 4.5 Invalid email on signup returns a friendly `?error=` redirect, not a 500

### Phase 5: Cookbook + test-plan sync

#### Automated

- [ ] 5.1 `npm run format` produces no diff on the edited markdown

#### Manual

- [ ] 5.2 §6.1/6.2/6.4/6.5 each point to a real, existing file from Phases 1-4
