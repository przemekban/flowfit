---
date: 2026-07-24T22:44:24+02:00
researcher: Claude
git_commit: 5f26c2e0fd17bab840f752c64647ccae5dbdbc49
branch: main
repository: flowfit
topic: "Rollout Phase 1 — API + authorization safety net (Risk #1: input validation / auth-bypass, Risk #2: cross-user IDOR)"
tags: [research, codebase, api-routes, authorization, rls, supabase, middleware, idor]
status: complete
last_updated: 2026-07-24
last_updated_by: Claude
---

# Research: API + Authorization Safety Net (Test-Plan Phase 1)

**Date**: 2026-07-24T22:44:24+02:00
**Researcher**: Claude
**Git Commit**: 5f26c2e0fd17bab840f752c64647ccae5dbdbc49
**Branch**: main
**Repository**: flowfit

## Research Question

This is Phase 1 of the phased test rollout defined in `context/foundation/test-plan.md` §3 ("API + authorization safety net"). It covers Risk #1 and Risk #2 from §2's Risk Map:

- **Risk #1**: "An API route accepts malformed input or lets a request through without enforcing the auth/ownership check the middleware assumes is already in place, since the route is called directly (bypassing the trusted UI)."
- **Risk #2**: "An authenticated user reads, updates, or deletes another user's profile, plan, session, or set data through an API endpoint that doesn't scope its query to the caller, relying solely on RLS as a backstop."

Per §2's Risk Response Guidance, research must ground: (1) which routes under `src/pages/api` have zod validation vs. parse the body unchecked, and which enforce the middleware-assumed auth rule even when called directly; (2) which Supabase client (anon vs. service-role) each route uses, and whether queries add an explicit owner filter or rely solely on RLS.

## Summary

**Risk #1 (validation / auth-bypass):**
- `src/middleware.ts` never gates `/api/*`. `PROTECTED_ROUTES` and `PROFILE_REQUIRED_ROUTES` (`src/middleware.ts:5-6`) list only page paths (`/dashboard`, `/onboarding`, `/session`); the `startsWith` match at `src/middleware.ts:20` never fires for `/api/...` paths. The middleware's *only* unconditional effect on API requests is populating `context.locals.user` (`src/middleware.ts:9-18`) — enforcement is 100% delegated to each route handler, with no fallback gate.
- Of the 9 route files under `src/pages/api/**`, the 6 that touch user data (`profile.ts`, `profile/reset.ts`, `plan.ts`, and all three `sessions/[sessionId]/*.ts`) **do** each implement an explicit `if (!context.locals.user)` check — none were found missing it today. This is a "no safety net" architecture: correct now, but a new route added without that line would be silently exploitable, and nothing catches the omission.
- The 3 auth routes (`signup.ts`, `signin.ts`, `signout.ts`) are missing `export const prerender = false` — a direct violation of the AGENTS.md hard rule. `signup.ts`/`signin.ts` also read `email`/`password` via unchecked `form.get(...) as string` casts with **no zod validation** (`src/pages/api/auth/signup.ts:6-7`, `signin.ts:6-7`), unlike every other route in the app.
- Route params (`sessionId`) are checked only for truthiness, never for shape/UUID validity, in `complete.ts`, `restart.ts`, and `sets.ts`.
- This exact anti-pattern ("assume middleware/a prior check already handled it") has bitten this project twice before and been caught in review: `onboarding.astro`'s skipped null-guard, and `profile-reset`'s racy active-session guard that was independently callable via PostgREST — both times the fix was moving enforcement into the RPC/DB layer.

**Risk #2 (IDOR / cross-user access):**
- There is exactly one Supabase client factory in app code (`src/lib/supabase.ts:5-24`), using the anon key + cookie session (`@supabase/ssr`) — every route and service uses it identically. **No service-role client exists in any request-handling code path**; the only service-role usage is in the E2E seed fixture (`tests/e2e/fixtures/seed.ts`), explicitly isolated by using separate `E2E_*` env vars.
- Every `userId` used in an ownership check or RPC param across the codebase is derived from `context.locals.user.id` (the session), never from client-supplied input.
- Most service functions filter by `user_id` explicitly (`.eq("user_id", userId)`). Five functions in `src/lib/services/session.ts` query/mutate by row ID **alone**, with no owner filter: `getSessionOwnership` (line 111-115), `getSessionWithSets` (136-146), `upsertSet` (209-212), `deleteSet` (229-240), `completeSession` (247-251). Every current call site wraps the two read functions in a local `loadOwnedSession` helper (duplicated in `complete.ts:13-27`, `restart.ts`, `sets.ts:20-34`) that compares `session.user_id === userId` before trusting the result and before calling the unguarded mutations — so this is not exploitable today, but it is a latent IDOR shape: any future call site that skips `loadOwnedSession` would have only RLS standing between it and cross-user data access.
- RLS is enabled and owner-scoped (`auth.uid() = user_id`, or a one-hop subquery for child tables) on every user-owned table, with matching `GRANT`s to `authenticated` — no gap found in either direction (RLS-without-grant or grant-broader-than-policy).
- The two state-changing RPCs used by `plan.ts` and `profile/reset.ts` re-check `p_user_id IS DISTINCT FROM auth.uid()` inside their own transaction, independent of RLS — an established project convention of "don't trust RLS alone," documented explicitly in the `ai-plan-generation` plan.

## Detailed Findings

### Middleware: what it actually gates

`src/middleware.ts` (full file, 39 lines):

```ts
const PROTECTED_ROUTES = ["/dashboard", "/onboarding", "/session"];
const PROFILE_REQUIRED_ROUTES = ["/dashboard", "/session"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) return context.redirect("/auth/signin");
  }
  if (context.locals.user && supabase &&
      PROFILE_REQUIRED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    const profile = await getUserProfile(supabase, context.locals.user.id);
    if (!profile) return context.redirect("/onboarding");
  }
  return next();
});
```

- Matching is `Array.prototype.some` + `String.prototype.startsWith` on `context.url.pathname` (`src/middleware.ts:20,29`) — a prefix match, not exact or regex.
- Verified against every entry: `/dashboard` → `src/pages/dashboard.astro`, `/onboarding` → `src/pages/onboarding.astro`, `/session` → `src/pages/session/[workoutId].astro`. **All three are page routes.** `/api/sessions/...` does not start with `/session` (it starts with `/api`), so no `/api/*` path ever matches either array.
- The `context.locals.user` population at lines 9-18 runs unconditionally for every request, including API requests — this is the only thing the middleware guarantees for API routes. There is no redirect/401 gate for unauthenticated `/api/*` requests at the middleware layer.
- AGENTS.md's instruction ("Add new protected paths to `PROTECTED_ROUTES`... omitting it leaves the route unauthenticated") describes page-route protection; it does not and cannot cover API routes given the current array contents, since none of the API paths are prefixed by any entry.

### Risk #1: Route-by-route inventory (`src/pages/api/**/*.ts`, 9 files)

| Route | `prerender=false` | Input validation | Auth check | Notes |
|---|---|---|---|---|
| `auth/signup.ts` | **missing** | **none** — `form.get("email") as string` (`:6-7`), unchecked cast into `supabase.auth.signUp` | n/a (public) | AGENTS.md hard-rule violation |
| `auth/signin.ts` | **missing** | **none** — same pattern (`:6-7`) | n/a (public) | AGENTS.md hard-rule violation |
| `auth/signout.ts` | **missing** | n/a, no body read | n/a (public) | AGENTS.md hard-rule violation |
| `profile.ts` | present | `onboardingSchema.safeParse` (`src/lib/validation/profile.ts:16-22`), zod enums mirror DB `CHECK` vocabulary | explicit `if (!context.locals.user) redirect` | — |
| `profile/reset.ts` | present | no client input beyond session identity | explicit check | App-layer `hasActiveWorkoutSession` pre-check documented as "fast path, not enforcement" (`:10-13`) — real enforcement is inside `reset_user_profile` RPC's own transaction |
| `plan.ts` | present (`:12`) | no client-supplied body; AI output validated server-side via `validatePlanAgainstCandidates` | explicit `401` (`:15-17`) | Writes via `save_generated_training_plan` RPC which independently re-checks `auth.uid()` |
| `sessions/[sessionId]/complete.ts` | present (`:7`) | `sessionId` param — **truthiness only** (`:36`), no UUID/shape check | explicit `401` (`:30-32`) + explicit ownership (`session.user_id === userId`, `:20`) | Mutation (`completeSession`) itself has no owner filter — protected only by the preceding check |
| `sessions/[sessionId]/restart.ts` | present | same truthiness-only param check | explicit `401` + explicit ownership via identical `loadOwnedSession` helper | — |
| `sessions/[sessionId]/sets.ts` | present (`:9`) | `identifyingFieldsSchema` (DELETE, `:11-14`) and dynamic `buildSetLogSchema(trackingType)` (PUT/POST, `src/lib/validation/session.ts:4-26`) via `.safeParse`; `sessionId` param truthiness-only (`:51,126`) | explicit `401` in both handlers (`:45-47,120-122`) + explicit ownership via `loadOwnedSession` (`:20-34`) | `extractExerciseId` (`:36-42`) does a raw, pre-schema read of `body.exercise_id` to look up tracking type before the strict schema runs — narrower than a mirror-test concern since it's only used for a lookup, not trusted for persistence |

Confirmed by direct read of `signup.ts`, `sets.ts`, `complete.ts`, `plan.ts` (see Code References).

**Key implication for test design**: every data-touching route already has the auth check that Risk #1 worries about missing. The actual test target for Risk #1 is therefore twofold — (a) a **regression guard**: a test that would fail if a future route (or an edit to an existing one) dropped its `if (!context.locals.user)` check or its zod validation, since nothing else would catch that; and (b) the **three auth routes' missing `prerender=false` and missing zod validation**, which are real, present-tense findings, not hypothetical ones.

### Risk #2: Supabase client and ownership-filter inventory

**Client construction** — `src/lib/supabase.ts:5-24`, single factory:
```ts
export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, { cookies: { getAll(){...}, setAll(){...} } });
}
```
`SUPABASE_URL`/`SUPABASE_KEY` come from `astro:env/server` (`context: "server", access: "secret"`, `astro.config.mjs:19-20`) — this is the anon key; identity comes from the forwarded cookie session. Repo-wide search for `SERVICE_ROLE`/`service_role` under `src/` returns zero matches. A service-role client exists only in `tests/e2e/fixtures/seed.ts:1-23`, reading `process.env.E2E_SUPABASE_SERVICE_ROLE_KEY`, with a comment stating this is deliberately isolated via separate `E2E_*` env vars "so the service-role key can never leak into app code."

**Ownership-filter inventory** (`src/lib/services/**`, all Supabase-touching functions):

| Function | Table | Owner filter | `userId` source |
|---|---|---|---|
| `getUserProfile` (`profile.ts:6`) | `user_profiles` | `.eq("id", userId)` | `context.locals.user.id` |
| `createUserProfile` (`profile.ts:23-26`) | `user_profiles` insert | `id: userId` in payload | same |
| `getActivePlan` (`plan.ts:179-196`) | `user_plan` | `.eq("user_id", userId)` | same |
| `getWorkoutWithExercises` (`session.ts:18-55`) | `workouts` | `.eq("id", workoutId).eq("user_id", userId)` | same |
| `getActiveSessionForWorkout` (`session.ts:57-78`) | `workout_sessions` | `.eq("user_id", userId).eq("workout_id", workoutId).eq("status","active")` | same |
| `createSession` (`session.ts:80-109`) | `workout_sessions` insert | `user_id: userId` in payload | same |
| **`getSessionOwnership`** (`session.ts:111-129`) | `workout_sessions` | **none** — `.eq("id", sessionId)` only (line 115) | n/a — returns row for caller to compare |
| **`getSessionWithSets`** (`session.ts:136-165`) | `workout_sessions` join | **none** — `.eq("id", sessionId)` only (line 146) | n/a |
| `getLastLoggedSets` (`session.ts:167-207`) | `workout_sets` join `workout_sessions!inner` | `.eq("workout_sessions.user_id", userId)` (line 188) | same |
| **`upsertSet`** (`session.ts:209-227`) | `workout_sets` upsert | **none** — writes `{workout_session_id: sessionId, ...input}` (line 212), no owner check | n/a |
| **`deleteSet`** (`session.ts:229-245`) | `workout_sets` delete | **none** — filters by `workout_session_id`/`exercise_id`/`set_number` only (lines 238-240) | n/a |
| **`completeSession`** (`session.ts:247-266`) | `workout_sessions` update | **none** — `.eq("id", sessionId)` only (line 251) | n/a |
| `restartSession` (`session.ts:268-291`) | RPC `restart_workout_session` | `p_user_id`, `p_existing_session_id`, `p_workout_id` all passed; RPC re-scopes internally | `context.locals.user.id` |

The five bolded, owner-filter-less functions are only ever called after an explicit app-layer ownership check in every current call site:
- `sets.ts:20-34` (`loadOwnedSession`) guards `getSessionOwnership` → `upsertSet` (line 108) and → `deleteSet` (line 162).
- `complete.ts:13-27` (`loadOwnedSession`) guards `getSessionWithSets` → `completeSession` (line 61).
- `restart.ts` uses the identical pattern.

Verified directly: `sets.ts:20-34,44-114,119-168`, `complete.ts:13-67`. Confirmed no owner filter exists inside `upsertSet`, `deleteSet`, or `completeSession` themselves (`session.ts:209-266`) — protection for these three mutations is **entirely dependent on the caller having already run `loadOwnedSession`**, plus RLS as backstop.

**RLS policies** (`supabase/migrations/20260529000000_core_schema.sql`): every user-owned table (`user_profiles`, `workouts`, `workout_exercises`, `user_plan`, `workout_sessions`, `workout_sets`) has SELECT/INSERT/UPDATE/DELETE policies keyed on `auth.uid() = user_id` (direct) or a one-hop subquery to the parent's `user_id` (for `workout_exercises`, `workout_sets`). `user_profiles` DELETE policy was added later (`supabase/migrations/20260717000000_add_user_profiles_delete_policy.sql:10-11`), paired with its GRANT in the same migration per the `lessons.md` rule. Reference tables (`exercises`, `workout_templates`, `workout_template_exercises`) are SELECT-only, gated by `auth.uid() IS NOT NULL`, no per-row ownership (not user-owned data).

**GRANT coverage**: `supabase/migrations/20260716120000_grant_table_privileges_to_authenticated.sql` grants exactly what each table's policies allow — no RLS-without-grant gap, no grant-broader-than-policy gap found on any table. `service_role` has blanket `GRANT ALL` (`supabase/migrations/20260724120000_grant_table_privileges_to_service_role.sql`), but this is unreachable from any HTTP-facing code path (see above) and `service_role` bypasses RLS by design regardless.

**RPC-level defense-in-depth**: `save_generated_training_plan` and `reset_user_profile` (both `SECURITY INVOKER`) independently `RAISE EXCEPTION` if `p_user_id IS DISTINCT FROM auth.uid()` (`supabase/migrations/20260723000000_reset_rpc_hardening.sql:56-58,90-92`) — redundant with RLS, added explicitly "for a clear error rather than relying solely on the RLS failure message" per the `ai-plan-generation` plan.

### Existing test baseline

- Only two Vitest files exist: `src/lib/services/session.test.ts` (161 lines) and `src/lib/validation/session.test.ts` (53 lines, pure zod schema tests). **Zero tests exist for any file under `src/pages/api`.**
- `session.test.ts` hand-mocks the Supabase query builder with chainable `vi.fn()`s (no `vi.mock()` of the SDK, no MSW). Representative pattern (`session.test.ts:26-44`): every query-builder method returns `this` except terminal methods (`single`/`maybeSingle`/`then`), which resolve a `Promise<{data, error}>`. The `SupabaseClient` mock itself is `{ from: vi.fn(() => builder) } as unknown as SupabaseClient`.
- Assertion style is mixed: some tests assert exact builder-method call args (implementation-mirroring, e.g. `upsertSet`'s `onConflict` string, `restartSession`'s RPC param object), others assert purely on return value/behavior (`getLastLoggedSets`, `createSession`'s conflict-fallback path).
- `vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.test.ts"]` (note: `.tsx`/`.spec.ts` not matched), `@` alias to `./src`, no `setupFiles`, coverage via `@vitest/coverage-v8` with no thresholds configured.
- No `msw`, `supertest`, or `@testing-library/*` in `package.json` — any new API-route test must either hand-mock (following the existing convention) or bring in a new dependency.
- **CI ordering matters**: `.github/workflows/ci.yml` runs `npm run test` (Vitest) *before* `supabase start` — Vitest never has a live Postgres connection in CI today. Only `npm run test:e2e` (Playwright, after `supabase start`) touches a real local DB. New Risk #1/#2 unit/integration tests must therefore either (a) follow the existing hand-mocked-client convention to run in the current CI ordering, or (b) require a CI restructure to start Supabase before the Vitest step — a decision for `/10x-plan`, not settled here.
- `tests/e2e/workout-session.spec.ts` (45 lines) is a single happy-path, single-user flow (sign in → log a set → reload → resume → finish). It never exercises a second user or a direct API call bypassing the UI — confirms this is genuinely uncovered ground, not a duplicate of existing e2e coverage.

## Code References

- `src/middleware.ts:5-6,20,29` — `PROTECTED_ROUTES`/`PROFILE_REQUIRED_ROUTES` contain only page paths; `/api/*` never matches
- `src/middleware.ts:9-18` — `context.locals.user` populated unconditionally for every request, including API
- `src/pages/api/auth/signup.ts:1-20`, `signin.ts`, `signout.ts` — missing `prerender = false`; `signup.ts:6-7`/`signin.ts:6-7` unchecked `form.get(...) as string`
- `src/pages/api/profile.ts:14-16,38` — explicit auth check + `onboardingSchema.safeParse`
- `src/pages/api/profile/reset.ts:10-13,19-21` — documented "fast path, not enforcement" comment; explicit auth check
- `src/pages/api/plan.ts:15-17,50-53` — explicit `401`; RPC-level `auth.uid()` re-check
- `src/pages/api/sessions/[sessionId]/sets.ts:20-34,44-47,50-53,101-104,119-122,125-128,156-159` — `loadOwnedSession` pattern; truthiness-only `sessionId` check; schema validation points
- `src/pages/api/sessions/[sessionId]/complete.ts:13-27,30-32,36-38` — identical `loadOwnedSession` pattern
- `src/lib/supabase.ts:5-24` — single anon-key client factory, no service-role variant
- `src/lib/services/session.ts:111-129,136-165,209-266` — the five owner-filter-less functions (`getSessionOwnership`, `getSessionWithSets`, `upsertSet`, `deleteSet`, `completeSession`)
- `src/lib/services/session.ts:18-55,57-78,167-207` — functions with explicit `.eq("user_id", userId)` filters
- `tests/e2e/fixtures/seed.ts:1-23` — isolated service-role usage, E2E-only
- `supabase/migrations/20260529000000_core_schema.sql:171-266` — RLS policies for all user-owned tables
- `supabase/migrations/20260716120000_grant_table_privileges_to_authenticated.sql` — GRANT set matching RLS policies
- `supabase/migrations/20260723000000_reset_rpc_hardening.sql:56-58,90-92` — RPC-level `auth.uid()` re-checks
- `src/lib/services/session.test.ts:26-44` — existing Supabase-client hand-mocking pattern
- `vitest.config.ts:14-24` — test environment, include pattern, alias, coverage config
- `.github/workflows/ci.yml:21-28,35-39` — Vitest runs before `supabase start`; Playwright runs after

## Architecture Insights

- **No middleware backstop for APIs is a deliberate-by-omission gap, not a bug**: every data-touching route already carries its own auth check, so nothing is broken today, but the architecture offers zero protection against a *future* omission. This shapes what Phase 1's tests should optimize for: regression protection on route contracts, not just "does auth currently work."
- **The project has an established, recurring defense-in-depth idiom**: app-layer check → RPC/DB-layer re-check, seen in `plan.ts`/RPC, `profile/reset.ts`/RPC, and `getSessionOwnership`+`loadOwnedSession`/RLS. Two prior impl-reviews (`onboarding-survey` F1, `profile-reset` Phase 5) found and fixed cases where the app-layer check was assumed sufficient but was actually racy or independently bypassable via PostgREST — this is the same class of risk Risk #1 describes, and it has already manifested twice in this codebase's history.
- **The `loadOwnedSession` helper is duplicated verbatim across three route files** (`complete.ts`, `restart.ts`, `sets.ts`) rather than shared — each copy independently must remain correct. This duplication is itself a signal for what a regression test should target: a change to one copy that silently diverges from the others.
- **Zod validation adoption is uneven and chronological**: `core-db-schema` (schema-only, no zod) → `onboarding-survey` (first zod usage, explicit note that "no route validates input with it" before this change) → later routes (`plan.ts`, `sets.ts`) follow the pattern. The three `auth/*.ts` routes predate this convention and were never retrofitted — this is inherited debt, not a new regression, and was explicitly flagged as a pre-existing gap in the `onboarding-survey` impl-review (F3) without being fixed there either.

## Historical Context (from prior changes)

- `context/archive/2026-05-29-core-db-schema/plan.md:180-200`, `reviews/impl-review.md` F1/F3 — established the RLS-policy shape (direct `user_id` vs. subquery-to-parent) still in use; F1 fixed `auth.role() = 'authenticated'` → `auth.uid() IS NOT NULL` for reference tables; F3 accepted the subquery N+1 cost as an MVP-scale trade-off.
- `context/archive/2026-07-08-onboarding-survey/plan.md:13,82,163`, `reviews/impl-review.md` F1 — introduced zod to the codebase; F1 is the first documented instance of "assumed middleware already handled it" being caught and fixed (restored an explicit Supabase-null-check redirect guard in `onboarding.astro` that had been dropped in reliance on middleware).
- `context/archive/2026-07-10-ai-plan-generation/research.md:47`, `plan.md:129,145-147,308`, `reviews/impl-review.md` F2 — RPC-level `auth.uid()` re-check pattern established here, explicitly reasoned as "a clear error rather than relying solely on the RLS failure message"; F2 explicitly notes the RPC is directly callable via `supabase.rpc()`, "bypassing [zod] validation entirely" — a direct precedent for Risk #1's concern applied to an RPC rather than a REST route.
- `context/archive/2026-07-16-workout-session/plan.md:127,210-230,241,291`, `reviews/impl-review.md` F2/F6 — established the `getWorkoutWithExercises(supabase, userId, workoutId)` "ownership-scoped fetch" convention and the manual-test convention of explicitly checking cross-user 404s; F2 found and fixed a race in `restart_workout_session` after the plan's own reasoning ("only I can hit this, so no race is possible") was disproven by a double-click/two-tab scenario — a concrete example of an authorization-adjacent assumption failing under direct/concurrent access.
- `context/archive/2026-07-16-profile-reset/plan.md:25,54,346-359` — cites `lessons.md`'s GRANT rule by name before adding a new DELETE policy; Phase 5 review found the active-session guard was "racy and bypassable" and the RPC "directly callable by any authenticated client" without re-checking session state — fixed by moving the check inside the RPC's own transaction. Structurally identical to Risk #1.
- `context/foundation/lessons.md` — the GRANT-vs-RLS incident (RLS policies shipped without GRANTs, causing 500s in production) is the project's one recorded lesson; its actual incident narrative lives in the header comment of `supabase/migrations/20260716120000_grant_table_privileges_to_authenticated.sql:1-16`, not in a dedicated change folder.
- `context/foundation/prd.md:52-53,149-157` — the oracle for Risk #2: "Each user's data is strictly isolated. No user can view another user's workouts, profile, or results," and "Unauthenticated requests to any protected route are rejected and redirected to the login screen." Any authorization test's expected values should trace to this guardrail, not to whatever the current implementation happens to return.
- `context/foundation/roadmap.md:55,70` — F-01 (the DB foundation) explicitly names "RLS policy gaps" as a risk category inherited by every downstream slice.

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Map, Risk Response Guidance) — the parent document this research grounds.
- `context/archive/2026-07-10-ai-plan-generation/research.md` — prior research covering the AI-generation write path now referenced above for RPC-level defense-in-depth precedent.

## Open Questions

1. **Integration vs. hermetic layer split for Phase 1**: §2's guidance recommends "unit / contract test per route handler" for Risk #1 and "integration test (two authenticated test identities)" for Risk #2. Given CI currently runs Vitest *before* `supabase start` (no live Postgres), a real cross-user IDOR integration test against actual RLS would require either restructuring CI ordering or accepting a hermetic-mock-only test for Phase 1 (which cannot prove RLS itself holds — only that the app layer calls the right filters). This is a decision for `/10x-plan`.
2. **Should the two present-tense findings (missing `prerender=false` on the three auth routes; no zod validation on `signup.ts`/`signin.ts`) be fixed as part of this test-plan phase, or ticketed separately?** They are real gaps discovered during research, not hypothetical regressions — `/10x-plan` should decide whether fixing them is in scope for "API + authorization safety net" or a separate change.
3. **Is the `loadOwnedSession` duplication (three near-identical copies) worth de-duplicating before or alongside adding tests**, given a shared helper would only need one test instead of three near-identical ones? Cost×signal call for `/10x-plan`.
