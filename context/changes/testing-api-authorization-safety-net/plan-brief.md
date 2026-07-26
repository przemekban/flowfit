# API + Authorization Safety Net — Plan Brief

> Full plan: `context/changes/testing-api-authorization-safety-net/plan.md`
> Research: `context/changes/testing-api-authorization-safety-net/research.md`

## What & Why

Phase 1 of the phased test rollout (`context/foundation/test-plan.md` §3): defend the highest-churn, highest-impact boundary — `src/pages/api` — against two risks. **Risk #1**: a route accepts malformed input or skips the auth check the middleware doesn't enforce for `/api/*` (nothing gates API routes today; each one carries its own check, correct now but unprotected against a future omission). **Risk #2**: an authenticated user reaches another user's session/set data through a query that doesn't scope to the caller, relying solely on RLS as a backstop.

## Starting Point

Every data-touching route already has its own `if (!context.locals.user)` check — Risk #1 is about the future, not a present bug. Five functions in `src/lib/services/session.ts` have no owner filter at all; they're only safe today because a `loadOwnedSession` helper — duplicated verbatim in three route files — checks ownership before calling them, with RLS as the only other backstop. Two real, present-tense gaps also surfaced during research: the three `auth/*.ts` routes are missing `prerender = false`, and `signup.ts`/`signin.ts` have zero zod validation. Zero tests exist under `src/pages/api` today; CI runs Vitest before `supabase start`, so no test has ever touched a live Postgres instance.

## Desired End State

Every data-touching route has a contract test that fails if a future edit drops its auth check. The five owner-filter-less functions have integration tests proving RLS itself blocks cross-user access — not just that the app calls the right filter. The triplicated ownership helper is one shared function. The two present-tense findings are fixed and tested. The test-plan cookbook documents all of this for the next rollout phase to reuse.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #2 test layer | Integration, real Postgres/RLS, requires CI restructure | Only way to prove RLS itself holds, not just that the app calls the right filter — matches §2 Risk Response Guidance directly | Plan |
| Present-tense findings (prerender, zod) | Fix in this same change | They're real, already-located gaps; a separate ticket for something already found is pure overhead | Plan |
| `loadOwnedSession` triplication | Dedupe to one shared, generic helper | Removes the actual future-drift risk research flagged, not just document it three times | Plan |
| `npm run test` vs. new integration suite | Separate `test:integration` script + config | Keeps the fast, DB-free unit-test loop unchanged for daily work | Plan |
| Risk #1 regression guard shape | Per-route contract test (no route left uncovered) | Matches research's explicit recommendation; a structural meta-test would be fragile relative to the signal it gives | Plan |
| Integration test fixtures | New, dedicated setup — not shared with `tests/e2e/fixtures/seed.ts` | Different runner (Vitest per-file vs. Playwright global) and different lifecycle | Plan |
| Scope if time runs short | Nothing cut — all five phases are must-have | User call: this phase either lands whole or returns to planning | Plan |

## Scope

**In scope:**
- Integration test environment (new Vitest config, npm script, two-user fixture, CI wiring)
- RLS-backed integration tests for the five owner-filter-less `session.ts` functions
- Dedup of `loadOwnedSession` + `sessionId` UUID-format validation
- Unauthenticated-request contract tests for all 6 data-touching routes
- Fix + test coverage for the 3 auth routes (`prerender=false`, zod validation)
- `test-plan.md` cookbook update (§6.1, §6.2, §6.4, §6.5) and Phase 1 status

**Out of scope:**
- Any e2e work (`tests/e2e/workout-session.spec.ts` untouched)
- RLS-integration tests for routes that already filter explicitly by `user_id` (`profile.ts`, `plan.ts`, `profile/reset.ts`) — hermetic contract tests only
- A structural/meta-test scanning route files for a guard pattern
- Password-strength business rules in the new auth zod schemas (Supabase Auth's own policy stays authoritative)

## Architecture / Approach

Two-layer split per the project's cost×signal principle: **integration** (real Postgres, two real authenticated identities via a new `tests/integration/` suite) proves the DB-layer backstop (RLS) holds for the five functions that have no other protection; **hermetic** (mocked Supabase client, extending the existing `session.test.ts` convention) proves every route calls its auth/ownership guard correctly. CI gains one new step — `npm run test:integration` — running after `supabase start`, before Playwright, so the existing fast `npm run test` step stays DB-free.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Integration environment | New Vitest config, `test:integration` script, two-user fixture, CI wiring | CI step ordering/env-var wiring mistakes silently skip the suite |
| 2. Risk #2 — RLS integration tests | Proof that RLS blocks cross-user access on the 5 unguarded functions | Misreading RLS-denial error shape (`PGRST116` looks like "not found") |
| 3. Risk #1 — session routes | Deduped ownership helper, UUID validation, contract tests (6 routes) | Refactor regresses existing passing behavior for the 3 route files touched |
| 4. Risk #1 — auth routes | `prerender=false` + zod fix, hermetic tests (3 routes) | Zod change breaks the real signup/signin happy path |
| 5. Cookbook sync | `test-plan.md` §6.1/6.2/6.4/6.5 filled in, Phase 1 marked complete | Documentation drifts from what was actually built |

**Prerequisites:** Local Docker + `npx supabase start` capability for Phase 1/2 verification; no new dependencies to install.
**Estimated effort:** ~4-5 sessions across 5 phases (Phase 1 and 2 are the heaviest — new test infra + CI change).

## Open Risks & Assumptions

- CI step reordering (Phase 1) could interact unexpectedly with the existing `supabase start` → Playwright sequence; verify the full CI run, not just local `npm run test:integration`.
- The `deleteSet` RLS-denial assertion (Phase 2) relies on a follow-up read to detect "zero rows affected" — this is a slightly indirect proof and worth double-checking against actual RLS behavior on first run.

## Success Criteria (Summary)

- A future PR that adds an API route without an auth check, or drops one from an existing route, fails `npm run test`.
- A future PR that removes the app-layer ownership guard from a session route still can't leak cross-user data, because RLS is proven (not assumed) to hold.
- `signup`/`signin` reject malformed input with a clear redirect instead of an uncaught cast failure; both routes now satisfy the `prerender=false` hard rule.
