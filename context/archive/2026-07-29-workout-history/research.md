---
date: 2026-07-29T20:34:00+02:00
researcher: Antigravity
git_commit: d5f3a2d60a774d73a3c044e80f50fd6ac403e327
branch: feature/workout-history
repository: przemekban/flowfit
topic: "Workout history: chronological list view"
tags: [research, codebase, workout-history, session-history]
status: complete
last_updated: 2026-07-29
last_updated_by: Antigravity
---

# Research: Workout history: chronological list view

**Date**: 2026-07-29T20:34:00+02:00
**Researcher**: Antigravity
**Git Commit**: [d5f3a2d60a774d73a3c044e80f50fd6ac403e327](file:///E:/kursy/10xdevs/FlowFit-workout-history#d5f3a2d60a774d73a3c044e80f50fd6ac403e327)
**Branch**: [feature/workout-history](file:///E:/kursy/10xdevs/FlowFit-workout-history)
**Repository**: przemekban/flowfit

## Research Question

How to implement the workout history chronological list view for completed workouts, including route protection, navigation, and visual styling.

## Summary

The goal of the `workout-history` feature is to provide users with a chronological list of their completed training sessions, displaying the date of execution and a summary of recorded sets, reps, and weights. 

Based on our exploration of the codebase:
1. **Database Access**: We will retrieve history from `workout_sessions` and `workout_sets` using a new service function `getWorkoutSessionHistory` in [session.ts](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/lib/services/session.ts). The query is highly optimized because of the existing index `idx_workout_sessions_user_completed` on `(user_id, completed_at DESC)`.
2. **Page & Route**: We will create a new Astro page at [history.astro](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/pages/history.astro).
3. **Route Protection**: The new route must be registered in [middleware.ts](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/middleware.ts) inside `PROTECTED_ROUTES` and `PROFILE_REQUIRED_ROUTES` to ensure users are authenticated and onboarded.
4. **Navigation**: We will update [Topbar.astro](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/components/Topbar.astro) to link to `/history` and import it into [dashboard.astro](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/pages/dashboard.astro) where it is currently missing.
5. **Session Completion**: We will update the redirect in [SessionLogger.tsx](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/components/session/SessionLogger.tsx) to route users to `/history` instead of `/dashboard` upon completing their workout.

---

## Detailed Findings

### 1. Database Schema and Query Efficiency

The tables involved in fetching workout history are `workout_sessions`, `workouts`, `workout_sets`, and `exercises`. 
* **Session Statuses**: When a session is active, its status is `'active'`. On completion, it is set to `'completed'`. If restarted and sets were already logged, it is set to `'abandoned'` (see [20260724130000_restart_workout_session_race_fix.sql:L52](file:///E:/kursy/10xdevs/FlowFit-workout-history/supabase/migrations/20260724130000_restart_workout_session_race_fix.sql#L52)).
* **Indexes Available**: 
  - `idx_workout_sessions_user_completed` on `workout_sessions (user_id, completed_at DESC)` ensures sorting completed sessions chronologically is highly performant.
  - `idx_workout_sets_session` on `workout_sets (workout_session_id)` optimizes queries fetching logged sets for each session.
* **Service Function Proposed**:
  We will add `getWorkoutSessionHistory` to [session.ts](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/lib/services/session.ts) using standard Supabase joins to fetch sessions, workouts, and sets (with exercise info) sorted by `completed_at DESC` and nested sets sorted by `set_number ASC`.

### 2. Route Protection in Middleware
In [middleware.ts](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/middleware.ts), page routes are protected by checking if they start with strings in `PROTECTED_ROUTES` and `PROFILE_REQUIRED_ROUTES`.
* **Action**: Add `/history` to both arrays so that unauthenticated users are redirected to `/auth/signin` and users without a profile are redirected to `/onboarding`.

### 3. Navigation and Topbar Usage
* **Topbar**: [Topbar.astro](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/components/Topbar.astro) displays the user email and links to `/dashboard` and the sign-out endpoint.
* **Dashboard Missing Topbar**: Currently, [dashboard.astro](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/pages/dashboard.astro) does not render the `<Topbar />` component. 
* **Action**: Add `/history` link to the authenticated section of `Topbar.astro` and render `<Topbar />` at the top of `dashboard.astro` to ensure a consistent header/navigation across user views.

### 4. Styling Conventions
To fit the app's premium aesthetic, the history view should follow these CSS and component layout patterns:
* **Background**: `@utility bg-cosmic` for a vibrant purple/blue gradient.
* **Layout Cards**: Semi-transparent card overlays matching the standard style:
  `w-full max-w-2xl rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl`

---

## Code References

* [src/lib/services/session.ts](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/lib/services/session.ts) - Service functions for managing workout sessions and sets.
* [src/pages/api/sessions/[sessionId]/complete.ts:L9-48](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/pages/api/sessions/%5BsessionId%5D/complete.ts#L9-48) - API route updating session status to `completed`.
* [src/middleware.ts:L5-6](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/middleware.ts#L5-6) - Definitions for protected path arrays.
* [src/components/Topbar.astro:L12-21](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/components/Topbar.astro#L12-21) - Authenticated user navigation bar links.
* [src/components/session/SessionLogger.tsx:L97](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/components/session/SessionLogger.tsx#L97) - Handles redirection to `/dashboard` upon session completion.

## Historical Context

Prior changes in the project established:
* `onboarding-survey` (`context/archive/2026-07-08-onboarding-survey/`): Set up base layouts, profile schema, and redirects.
* `ai-plan-generation` (`context/archive/2026-07-10-ai-plan-generation/`): Designed the plan display UI.
* `workout-session` (`context/archive/2026-07-16-workout-session/`): Implemented session tracking, real-time logging, and completions.
* `profile-reset` (`context/archive/2026-07-16-profile-reset/`): Hardened profile/session actions via transactions.

## Open Questions

None. The requirements for the chronological list view (S-04) are clear and align directly with the existing data schemas and project patterns.
