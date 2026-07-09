<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Onboarding Survey Implementation Plan

- **Plan**: context/changes/onboarding-survey/plan.md
- **Scope**: Full plan — Phase 1 through Phase 4 (all complete)
- **Date**: 2026-07-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations
- **Triage**: All 4 findings fixed 2026-07-09; lint + build re-verified clean post-fix

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — onboarding.astro skips the plan's Supabase-null redirect guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/onboarding.astro:8-13
- **Detail**: The plan's Phase 4 contract for this file specifies: "creates its own Supabase client via `createClient(...)`, redirecting to `/auth/signin?error=...` if it's null" — mirroring the identical guard in `src/pages/api/profile.ts:14-17` and `src/pages/api/auth/signup.ts:9-12`. The actual code has no such guard; instead a comment states the guard was omitted because "middleware already protects /onboarding," and the code falls through to `const profile = user && supabase ? await getUserProfile(...) : null;` — if `supabase` were ever null here, the page would silently render the form branch rather than redirecting. Verified this reasoning holds today: `src/middleware.ts` puts `/onboarding` in `PROTECTED_ROUTES` and nulls `context.locals.user` whenever its own `createClient` call fails, so an unauthenticated/misconfigured request never reaches this frontmatter. The gap is only latent — a future middleware refactor that decouples the auth check from the Supabase-client-null check would silently degrade instead of redirecting, and even today a submitted form would just bounce at `/api/profile`'s own guard, not crash.
- **Fix A ⭐ Recommended**: Restore the explicit `if (!supabase) return Astro.redirect(...)` guard to match the plan's contract and the identical defense-in-depth pattern already used in `api/profile.ts` and `signup.ts`.
  - Strength: Matches the plan's contract and the established defense-in-depth convention used at every other authenticated entry point in this codebase; one-line change.
  - Tradeoff: Adds a branch that middleware currently guarantees is unreachable.
  - Confidence: HIGH — identical pattern already proven elsewhere in the repo.
  - Blind spot: None significant.
- **Fix B**: Keep the omission, but replace the inline comment with a plan addendum documenting the intentional coupling to middleware.ts and why it's safe.
  - Strength: Avoids a branch that can never execute under current middleware; keeps frontmatter lean.
  - Tradeoff: Creates a hidden invariant between onboarding.astro and middleware.ts with no compiler or runtime signal if it's ever broken.
  - Confidence: MEDIUM — reasonable only if middleware.ts is trusted to remain the sole gate for /onboarding indefinitely.
  - Blind spot: Haven't checked whether middleware.ts is likely to be touched by near-term follow-up work.
- **Decision**: FIXED (Fix A) — explicit null-guard redirects restored in src/pages/onboarding.astro

### F2 — Duplicate-submission redirect is silent, no operability signal

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/profile.ts:36-39
- **Detail**: On a `23505` unique-violation (double-submit of an existing profile), the catch block redirects to `/dashboard` with no log line. This is exactly the behavior the plan's "Duplicate-submission handling" section calls for, so it's not a deviation — but it means a genuine anomaly (e.g. a client retry bug hammering this endpoint) is indistinguishable from a normal race in server logs.
- **Fix**: Add a `console.error`/structured log in the `23505` branch before redirecting, without changing the user-facing redirect.
- **Decision**: FIXED — added console.error log in src/pages/api/profile.ts's 23505 branch

### F3 — `formData()` parse errors bypass the redirect-with-error UX

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/profile.ts:19
- **Detail**: `context.request.formData()` is called before the `try/catch` block (which starts at line 34), so a malformed request body throws past this route's own redirect-based error handling into Astro's default 500 page. This is not a new regression — the identical gap exists in the pre-existing `src/pages/api/auth/signup.ts:5` and `signin.ts` — so it's inherited debt this plan didn't introduce, not something Phase 3 broke.
- **Fix**: Wrap `formData()` in a try/catch that redirects to `/onboarding?error=...` on failure, matching the rest of the route's error-handling convention. Optional: fix signup.ts/signin.ts the same way in a follow-up, since they share the gap.
- **Decision**: FIXED — formData() wrapped in try/catch in src/pages/api/profile.ts; signup.ts/signin.ts left as-is (shared inherited gap, out of scope for this review)

### F4 — Unchecked type assertion on caught error

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/profile.ts:37
- **Detail**: `(err as PostgrestError).code === "23505"` asserts the caught error's shape without a runtime guard. This exactly matches the plan's specified contract, and is safe in practice — property access on any non-nullish thrown value just yields `undefined` if `.code` is absent, which correctly falls through to the generic error branch — but it has no protection if `createUserProfile`'s throw contract ever changes to something that could be `null`/`undefined`.
- **Fix**: Narrow with a small `isPostgrestError(err): err is PostgrestError` guard (or an `err && typeof err === "object" && "code" in err` check) before trusting `.code`.
- **Decision**: FIXED — added `isPostgrestError` type guard in src/pages/api/profile.ts

## Automated Verification

- `npm run lint` — PASS (clean, only benign `astro-eslint-parser`/`projectService` warnings)
- `npm run build` — PASS (types generated, server build completed, no errors)

## Manual Verification

All manual checkboxes in the plan's Progress section are marked `[x]` with commit SHAs across all 4 phases. Phases 2 and 4 each had an explicit "pause for manual confirmation" gate in the plan, consistent with genuine walkthroughs rather than rubber-stamping. Not independently re-driven in this review (no live Supabase/browser session available in this pass) — this is trusted evidence from the commit trail, not directly re-verified.
