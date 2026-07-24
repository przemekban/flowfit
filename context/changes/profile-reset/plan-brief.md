# Profile Reset — Plan Brief

> Full plan: `context/changes/profile-reset/plan.md`

## What & Why

Let a user delete their saved onboarding profile and retake the survey from scratch. This resolves OQ-001 / GitHub issue #9: today, if a user's goal or equipment changes — or their original equipment selection was too narrow to ever generate a plan — there is no recovery path beyond a "Try again" button that fails identically every time.

## Starting Point

The onboarding survey (S-01) and AI plan generation (S-02) are both `done` and archived. `user_profiles` has SELECT/INSERT/UPDATE RLS policies only — no DELETE policy or GRANT exists. `src/pages/api/profile.ts` is insert-only. `ProfileSummary.tsx` (the page shown once a profile exists) has no reset affordance today, just a "Back to dashboard" link.

## Desired End State

From `/onboarding`, a user with a saved profile can click "Reset profile," confirm in a modal, and land back on a blank onboarding form — their old profile row is gone. If they have an active workout session, the reset is blocked with an inline error instead. Retaking the survey and generating a new plan works exactly as it does today; the existing plan-generation RPC already archives whatever plan existed before.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Retake mode | Blank slate (hard delete + fresh form) | Matches GitHub issue #9's explicit resolution ("not a full in-app profile editor") and PRD Non-Goals | Plan (user Q&A) |
| Confirmation UX | Modal dialog (shadcn Dialog) | Standard accessible pattern for irreversible actions; no existing modal to misuse otherwise | Plan (user Q&A) |
| Active plan handling | Leave as-is until next generation | `/dashboard` already redirects to `/onboarding` with no profile; existing plan RPC already archives+replaces on next generation | Plan (user Q&A) |
| Entry point | Profile summary page (`/onboarding`) | Zero new routes — this is already the page that displays the saved profile | Plan (user Q&A) |
| Data handling | Hard delete | Matches "reset" semantics; needs only one RLS policy + GRANT, no schema change | Plan (user Q&A) |
| API shape | `POST /api/profile/reset` | Matches existing form-POST convention (`/api/profile`, `/api/auth/signout`); no fetch/JS required | Plan (user Q&A) |
| Session guard | Real guard now, not deferred | `workout_sessions.status='active'` is already a real, indexed, queryable concept even though S-03 UI isn't built | Plan (user Q&A) |
| Post-reset landing | Redirect straight to `/onboarding` | Matches middleware's existing no-profile → `/onboarding` behavior; one less screen | Plan (user Q&A) |

## Scope

**In scope:**
- New DELETE RLS policy + GRANT on `user_profiles`
- `deleteUserProfile` and `hasActiveWorkoutSession` service functions
- `POST /api/profile/reset` route
- Confirmation modal + "Reset profile" button on `ProfileSummary.tsx`
- Guard-error surfacing on the profile summary page

**Out of scope:**
- Prefilled/edit-style retake — the form is blank, not pre-populated
- Immediate archiving of the active plan as part of reset (deferred to next plan generation, which already handles it)
- Soft-delete / audit trail on `user_profiles`
- Any change to `/dashboard`, plan generation, or workout logging code paths

## Architecture / Approach

Standard schema → service → API → UI ordering. The reset endpoint reuses the codebase's existing POST-and-redirect, `?error=`-query-param conventions rather than introducing a new JSON/fetch API style — it looks and behaves like `/api/profile` and `/api/auth/signout`, just with a DELETE instead of an INSERT.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database migration | DELETE RLS policy + GRANT on `user_profiles` | Forgetting the GRANT reproduces the exact "permission denied" incident in `lessons.md` |
| 2. Backend | `deleteUserProfile`, `hasActiveWorkoutSession`, `POST /api/profile/reset` | Active-session guard needs manual SQL seeding to test since S-03 UI doesn't exist yet |
| 3. Frontend | Confirmation modal + wiring on `ProfileSummary.tsx` | First shadcn Dialog in the project — no existing modal pattern to copy |

**Prerequisites:** Local Supabase stack running (`npx supabase start`); nothing else — no blocking roadmap dependencies (OQ-001 is explicitly non-blocking).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Assumes deleting `user_profiles` without also archiving `workouts`/`user_plan` is acceptable, since those tables are hidden by the middleware's profile-required gating until the next plan generation — confirmed by the current gating logic, not by a UI test (S-03 isn't built to exercise this end-to-end yet).
- The active-session guard can only be manually tested via direct SQL seeding of `workout_sessions`, since the session-logging UI (S-03) that would create such rows isn't implemented yet.

## Success Criteria (Summary)

- A user with a saved profile can reset it via a confirmation modal and land on a blank onboarding form
- A reset while a workout session is active is blocked with a visible error, profile untouched
- Retaking the survey and regenerating a plan works with no regression to the existing onboarding/plan-generation flows
