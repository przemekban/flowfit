# Profile Reset Implementation Plan

## Overview

Let a user delete their saved onboarding profile and retake the survey from scratch, gated by a confirmation modal and blocked while a workout session is active. This resolves OQ-001 / GitHub issue #9: without it, a user whose goal or equipment changes — or whose original equipment selection was too narrow to ever generate a plan — has no recovery path beyond a "Try again" button that fails identically every time.

## Current State Analysis

- `user_profiles` has RLS policies for SELECT/INSERT/UPDATE only; the schema comment at `supabase/migrations/20260529000000_core_schema.sql:191` explicitly says "owner only (no DELETE in MVP)". No DELETE GRANT exists either (`supabase/migrations/20260716120000_grant_table_privileges_to_authenticated.sql:14`).
- `src/pages/api/profile.ts` is POST-only (insert). `src/lib/services/profile.ts` has only `getUserProfile` and `createUserProfile` — no update/delete function.
- `src/components/onboarding/ProfileSummary.tsx` (shown at `/onboarding` once a profile exists, rendered as a `client:load` React island from `src/pages/onboarding.astro:30`) has no reset/edit affordance — just a "Back to dashboard" link.
- `src/middleware.ts:26-35` already redirects `/dashboard` → `/onboarding` whenever `getUserProfile` returns null (`PROFILE_REQUIRED_ROUTES`). Deleting the profile row alone is sufficient to route the user back into the survey — no new redirect logic needed.
- `workouts`/`user_plan` have no FK back to `user_profiles` (they reference `auth.users(id)` directly) — deleting the profile does not cascade to or orphan plan data.
- `workout_sessions` has a real `status` enum with an `'active'` value and a unique partial index (`idx_one_active_session_per_workout`, `supabase/migrations/20260612000000_active_session_uniqueness.sql`) enforcing at most one active session per workout. This is queryable today even though the session-logging UI (S-03) isn't built yet.
- `save_generated_training_plan` (RPC, `supabase/migrations/20260714000000_add_advisory_lock_to_plan_rpc.sql`) already archives the prior active plan and clears `user_plan` every time a new plan is generated — this "wipe and replace" behavior fires regardless of whether the profile was just reset, so no extra plan-cleanup code is needed here.

## Desired End State

A user with a saved profile can, from `/onboarding`, open a confirmation dialog and reset their profile. On confirm, the profile row is deleted and they land back on a blank onboarding form. If they have an active workout session, the reset is blocked with an inline error instead. Retaking the survey creates a fresh profile through the existing `POST /api/profile` flow; the next plan generation naturally archives whatever plan existed before, via the existing RPC.

Verify by: completing onboarding, resetting, confirming the form is blank again and the profile row is gone, then retaking the survey and generating a new plan.

### Key Discoveries:

- `lessons.md` rule ("Grant table privileges explicitly alongside RLS policies") applies directly — the new DELETE policy and its GRANT must land in the same migration.
- A single-row DELETE on `user_profiles` doesn't need the SECURITY INVOKER/advisory-lock RPC pattern used by plan generation — that pattern exists to make multi-table writes atomic; this is already atomic as a plain client-side DELETE.
- `idx_workout_sessions_user_status` (`core_schema.sql:161`) already covers the active-session guard query — no new index needed.
- **Discovered 2026-07-22, during manual Phase 3 verification**: `src/pages/dashboard.astro:44-52` renders `PlanGenerator` (the only code path that calls `save_generated_training_plan`) exclusively when `activePlan.length === 0`. Since reset only deleted the profile row and left `user_plan`/`workouts.is_archived` untouched, a user who reset and retook the survey landed back on the dashboard still showing their *old* plan, with no UI entry point to generate a new one. The original Phase 1 reasoning ("a single-row DELETE doesn't need the RPC/advisory-lock pattern — this is already atomic as a plain client DELETE") assumed reset would stay a single-table write; it no longer does once plan archiving is added, so Phase 4 below moves reset behind an RPC, mirroring `save_generated_training_plan`'s own archive-and-clear + advisory-lock pattern rather than inventing a new one.
- Rejected alternative: adding a persistent "Regenerate plan" button next to `PlanDisplay`. `PlanGenerator` currently has no button at all — it self-fires once on mount (`hasFiredRef`) and the dashboard permanently removes it from the tree once a plan exists, which is the app's only built-in guard against uncontrolled Gemini API spend. A standalone always-visible regenerate button would be repeatably clickable with no natural stopping condition and would break that invariant. Archiving the old plan atomically during reset instead makes the *existing* `activePlan.length === 0` gate do the work, so no new spend surface is introduced.

## What We're NOT Doing

- No profile editing / prefilled retake form — the retake is a blank onboarding form, matching PRD Non-Goals ("no in-app form to update survey answers in MVP") and GitHub issue #9's explicit resolution ("not a full in-app profile editor").
- ~~No immediate archiving of the active plan as part of reset — it's left untouched until the next plan generation, which already handles archiving via the existing RPC.~~ **Reversed 2026-07-22, see Phase 4** — manual testing showed the dashboard only ever offers plan (re)generation when it has no active plan, so leaving the old plan untouched left users with no way to reach "the next plan generation" at all.
- No soft-delete / audit trail column on `user_profiles` — this is a hard DELETE.
- No new confirmation step beyond the modal itself (no separate "profile was reset" acknowledgment screen).

## Implementation Approach

Add the missing DELETE policy + GRANT first (DB), then the service/API layer (backend), then the UI (frontend) — following the codebase's established "schema → service → API → UI" ordering. The reset endpoint reuses the existing POST-and-redirect, `?error=`-query-param conventions from `src/pages/api/profile.ts` and `src/pages/api/auth/signout.ts` rather than introducing a new JSON/fetch API style.

## Phase 1: Database migration — DELETE policy + GRANT on `user_profiles`

### Overview

Add the RLS policy and matching GRANT that let a user delete their own profile row.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260717000000_add_user_profiles_delete_policy.sql`

**Intent**: Allow an authenticated user to delete their own `user_profiles` row, unblocking the reset flow. Per the `lessons.md` GRANT rule, the policy and its GRANT must ship together in one migration — a policy without the GRANT will 500 with "permission denied for table user_profiles" exactly like the incident that produced that lesson.

**Contract**:

```sql
CREATE POLICY "user_profiles_delete" ON user_profiles
  FOR DELETE USING (auth.uid() = id);

GRANT DELETE ON user_profiles TO authenticated;
```

Do not edit the historical comment at `core_schema.sql:191` ("no DELETE in MVP") — migrations are append-only; this new file supersedes that statement in practice.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Grant is present: `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='user_profiles' AND grantee='authenticated';` includes a `DELETE` row
- Lint passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio, `user_profiles` policy list shows `user_profiles_delete`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Backend — service functions + API route

### Overview

Add the delete and active-session-guard service functions, then the `POST /api/profile/reset` route that ties auth, the guard, and the delete together.

### Changes Required:

#### 1. Profile service

**File**: `src/lib/services/profile.ts`

**Intent**: Delete the caller's own profile row, mirroring the existing `getUserProfile`/`createUserProfile` shape (throw on `PostgrestError`).

**Contract**: `deleteUserProfile(supabase: SupabaseClient, userId: string): Promise<void>` — `DELETE FROM user_profiles WHERE id = userId`; throw on error, same pattern as `createUserProfile`.

#### 2. Workout session guard service

**File**: `src/lib/services/workout-sessions.ts` (new)

**Intent**: Answer whether the user currently has an active workout session, to block reset mid-workout. This is a real, schema-backed check (`workout_sessions.status = 'active'`, indexed by `idx_workout_sessions_user_status`), not a placeholder — it will simply start returning `true` in practice once session logging (S-03) ships.

**Contract**: `hasActiveWorkoutSession(supabase: SupabaseClient, userId: string): Promise<boolean>` — `SELECT id FROM workout_sessions WHERE user_id = userId AND status = 'active' LIMIT 1`; return whether a row was found.

#### 3. Reset API route

**File**: `src/pages/api/profile/reset.ts` (new)

**Intent**: Authenticate, guard against an active session, delete the profile, and redirect — following the same auth-check and `?error=`-redirect conventions as `src/pages/api/profile.ts`.

**Contract**: `export const prerender = false;` `export const POST: APIRoute`. No `context.locals.user` → redirect `/auth/signin`. `hasActiveWorkoutSession` true → redirect `/onboarding?error=<message>` (e.g. "Finish or end your active workout before resetting your profile"). Otherwise call `deleteUserProfile` and redirect `/onboarding`. No request body, so no zod schema is needed for this route.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `astro check` (via `npm run build`)
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With `npx supabase start` running locally: POST to `/api/profile/reset` as an authenticated user with a saved profile → profile row is gone, redirected to `/onboarding` with a blank form
- Seed a `workout_sessions` row with `status='active'` for the test user via SQL, then POST to `/api/profile/reset` → redirected to `/onboarding?error=...`, profile row untouched

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend — confirmation modal + wiring

### Overview

Add the "Reset profile" entry point and confirmation dialog to the profile summary page, and surface guard errors there.

### Changes Required:

#### 1. Install shadcn Dialog

**Command**: `npx shadcn@latest add dialog`

**Intent**: Provide the accessible confirm/cancel modal chosen for this destructive action — no dialog primitive exists in `src/components/ui/` yet (only `button.tsx`).

**Contract**: Lands `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` in `src/components/ui/dialog.tsx`, new-york variant, matching the rest of the project's shadcn components.

#### 2. Profile summary UI

**File**: `src/components/onboarding/ProfileSummary.tsx`

**Intent**: Add a "Reset profile" button that opens the confirmation dialog. On confirm, submit a plain `<form method="POST" action="/api/profile/reset">` inside the dialog — consistent with the rest of the app's progressive-enhancement, no-fetch form-POST convention (same as `OnboardingForm` and the signout form in `dashboard.astro`). On cancel, close the dialog with no request sent. Also render an optional guard-error message, mirroring how `OnboardingForm` renders `serverError`.

**Contract**: `ProfileSummaryProps` gains `error?: string | null`. Use `cn()` from `@/lib/utils` for any conditional classes per `AGENTS.md`. Dialog open/close is local component state; the reset action itself is a real form POST, not a fetch call.

#### 3. Wire the error prop through

**File**: `src/pages/onboarding.astro`

**Intent**: `error` is already read from the query string (`:19`) but only forwarded to `OnboardingForm`. Forward it to `ProfileSummary` too so a guard-blocked reset is visible to the user.

**Contract**: `<ProfileSummary profile={profile} error={error} client:load />`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- As a user with a saved profile, open `/onboarding`, click "Reset profile", cancel the dialog → no request sent, profile still shown
- Click "Reset profile", confirm → redirected to a blank onboarding form; reloading `/dashboard` also redirects to `/onboarding` (profile gone)
- Retake the survey → new profile saves via the existing `POST /api/profile` flow; dashboard shows `PlanGenerator`
- With an active `workout_sessions` row seeded for the test user, attempt reset → dialog confirm redirects back to `/onboarding` with the guard error message visible on the profile summary page
- Reset+retake with an existing plan → dashboard automatically regenerates a fresh plan (Phase 4), archiving the prior one, with no regression

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Fix — archive the active plan atomically during reset

### Overview

Reset must leave the user in the same "no active plan" state a brand-new signup is in, so the dashboard's existing `PlanGenerator` self-fires a fresh generation after retaking the survey — no new button, no new endpoint.

### Changes Required:

#### 1. Reset RPC

**File**: `supabase/migrations/20260722000000_reset_user_profile_rpc.sql`

**Intent**: Atomically delete the profile row and archive the active plan, so partial failure can't leave the profile gone but the stale plan still active (or vice versa). Reuses the exact archive-and-clear statements from `save_generated_training_plan` (`20260714000000_add_advisory_lock_to_plan_rpc.sql:41-44`) and the same per-user advisory-lock pattern, so a concurrent plan generation (e.g. a second tab) can't interleave with a reset.

**Contract**:

```sql
CREATE OR REPLACE FUNCTION reset_user_profile(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  DELETE FROM user_profiles WHERE id = p_user_id;
  UPDATE workouts SET is_archived = true, updated_at = now()
    WHERE user_id = p_user_id AND is_archived = false;
  DELETE FROM user_plan WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION reset_user_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_user_profile(uuid) TO authenticated;
```

The active-session guard (`hasActiveWorkoutSession`) stays an app-layer pre-check in the API route, unchanged from Phase 2 — only the delete-and-archive step moves into the RPC.

#### 2. Profile service

**File**: `src/lib/services/profile.ts`

**Intent**: Replace the plain-DELETE `deleteUserProfile` with `resetUserProfile`, calling the new RPC instead of a table DELETE.

**Contract**: `resetUserProfile(supabase: SupabaseClient, userId: string): Promise<void>` — `supabase.rpc("reset_user_profile", { p_user_id: userId })`; throw on error.

#### 3. Reset API route

**File**: `src/pages/api/profile/reset.ts`

**Intent**: Call `resetUserProfile` instead of `deleteUserProfile`. No other behavior change — guard check and redirects stay as Phase 2 defined them.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase migration up`
- `reset_user_profile` function exists and is owned by `authenticated`: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'reset_user_profile';`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With an existing profile and a generated plan: reset, retake the survey → dashboard shows `PlanGenerator` (loading spinner), not the old plan, and a *new* plan appears after it finishes
- The old plan's workouts are archived (`is_archived = true`) and no longer referenced by `user_plan`, verifiable in Supabase Studio
- Active-session guard (Phase 2) still blocks reset the same way — this phase doesn't touch that check

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

None — no automated test suite is configured project-wide (per `AGENTS.md`). Rely on `npm run lint`, `npm run build`, and manual verification per phase.

### Integration Tests:

None (same reason).

### Manual Testing Steps:

1. Complete onboarding as a fresh test user; confirm the profile summary now shows a "Reset profile" button.
2. Click "Reset profile", cancel — profile untouched, no network request fires.
3. Click "Reset profile", confirm — profile row deleted, redirected to a blank onboarding form.
4. Retake the survey — new profile saves; dashboard shows the plan generator (no plan yet).
5. Seed a `workout_sessions` row with `status='active'` via SQL for the test user, attempt reset — blocked with an inline error, profile intact.
6. Generate a plan, reset the profile, retake the survey — confirm the dashboard automatically shows `PlanGenerator` and generates a fresh plan (Phase 4), and that the old plan is archived exactly as it is on any other regeneration.

## Performance Considerations

None significant — a single-row DELETE and an indexed single-row SELECT (`idx_workout_sessions_user_status`) add negligible load.

## Migration Notes

No data backfill required. The migration only adds a new DELETE policy and GRANT; it does not touch existing rows.

## References

- GitHub issue #9 / `context/foundation/roadmap.md` OQ-001
- `context/foundation/lessons.md` — RLS + GRANT pairing rule
- Precedent for "wipe and replace": `supabase/migrations/20260714000000_add_advisory_lock_to_plan_rpc.sql`
- POST-and-redirect convention: `src/pages/api/profile.ts`, `src/pages/api/auth/signout.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database migration — DELETE policy + GRANT on `user_profiles`

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 2144277
- [x] 1.2 Grant is present in `information_schema.role_table_grants` — 2144277
- [x] 1.3 Lint passes: `npm run lint` — 2144277

#### Manual

- [x] 1.4 Supabase Studio shows `user_profiles_delete` policy — user-verified 2026-07-22

### Phase 2: Backend — service functions + API route

#### Automated

- [x] 2.1 Type checking passes (`npm run build`) — bf4a1a6
- [x] 2.2 Lint passes: `npm run lint` — bf4a1a6
- [x] 2.3 Build succeeds: `npm run build` — bf4a1a6

#### Manual

- [x] 2.4 POST `/api/profile/reset` deletes the profile and redirects to blank `/onboarding` — user-verified 2026-07-22
- [x] 2.5 POST `/api/profile/reset` with an active session is blocked with `?error=` — user-verified 2026-07-22

### Phase 3: Frontend — confirmation modal + wiring

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 6b78c44
- [x] 3.2 Build succeeds: `npm run build` — 6b78c44

#### Manual

- [x] 3.3 Cancel in dialog sends no request — user-verified 2026-07-22
- [x] 3.4 Confirm in dialog resets profile and redirects to blank onboarding form — user-verified 2026-07-22
- [x] 3.5 Retaking the survey saves a fresh profile and dashboard shows `PlanGenerator` — re-verified 2026-07-22 after Phase 4 landed (originally failed 2026-07-22: `PlanGenerator` did NOT show, stale plan stayed visible; see Phase 4)
- [x] 3.6 Active-session guard error is visible on the profile summary page — user-verified 2026-07-22
- [x] 3.7 Post-reset plan regeneration archives the prior plan with no regression — superseded by Phase 4's 4.5/4.6, both verified

### Phase 4: Fix — archive the active plan atomically during reset

#### Automated

- [x] 4.1 Migration applies cleanly: `npx supabase migration up`
- [x] 4.2 `reset_user_profile` function present, granted to `authenticated` — verified via `\df reset_user_profile` against local DB
- [x] 4.3 Lint passes: `npm run lint`
- [x] 4.4 Build succeeds: `npm run build`

#### Manual

- [x] 4.5 Reset+retake with an existing plan → dashboard shows `PlanGenerator` and a fresh plan appears (not the stale one) — user-verified 2026-07-22: 2 workouts × 5 exercises generated, confirmed on screen
- [x] 4.6 Old plan's workouts are archived (`is_archived = true`) and no longer in `user_plan` — verified directly in DB 2026-07-22: 2 active / 5 archived workouts, `user_plan` has exactly 2 rows matching the active ones
- [x] 4.7 Active-session guard (Phase 2) still blocks reset unchanged — user-verified 2026-07-22
