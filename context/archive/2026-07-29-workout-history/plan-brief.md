# Workout History chronological list view — Plan Brief

> Full plan: `context/changes/workout-history/plan.md`
> Research: `context/changes/workout-history/research.md`

## What & Why

Provide users with a chronological history of their logged workout sessions. This closes the session lifecycle, giving visibility into past performance, and allows tracking both successfully completed workouts and abandoned training sessions.

## Starting Point

Currently, workouts can be started and logged in real-time, and active session status transitions to `completed` or `abandoned` in the database. However, there is no UI to view past records, navigation does not link to a history view, and completing a workout sends users directly back to the dashboard.

## Desired End State

A clean, server-side paginated list view at `/history` displaying past workout cards. Each card displays the workout name, completion status (Completed/Abandoned), date and start time, calculated duration, and detailed logs of exercises and sets completed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Session Statuses | Completed & Abandoned | Captures all historical logs where sets were registered even if the user started over. | Plan |
| Pagination | Server-side query params (`?page=N`) | Leverages Astro SSR architecture without needing client-side fetching or stateful trackers. | Plan |
| Chronological Sorting | Sorted by `started_at DESC` | Ensures consistent chronological order for both completed and abandoned workouts. | Plan |
| Sets Layout | Detailed individual sets | Displays actual reps and weights logged for every individual set for precise tracking. | Plan |
| Session Duration | Calculated elapsed time | Renders the time taken between session start and completion for additional user feedback. | Plan |

## Scope

**In scope:**
- A new Astro page at `/history` accessible only to signed-in and onboarded users.
- Chronological session querying with limit/offset pagination.
- Renders exercises list showing individual set logs.
- Navigation link updates on Topbar and Dashboard.
- Completion redirect pointing to `/history`.

**Out of scope:**
- Interactive charts or workout trends.
- Updating or deleting logged sets from the history list.

## Architecture / Approach

Retrieval is handled via a new service function `getWorkoutSessionHistory` in `session.ts`. It queries the Supabase client utilizing existing indices `idx_workout_sessions_user_status` and `idx_workout_sets_session`. It fetches `limit + 1` rows to check for a next page indicator.

```
[Astro /history page] 
       │ (reads query parameter ?page=N)
       ▼
[getWorkoutSessionHistory]
       │ (performs Range query joining workouts, sets, and exercises)
       ▼
[Supabase / Postgres Database]
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend Service & Protection | `getWorkoutSessionHistory` query + TDD unit & integration tests + route protection | Database query edge cases / RLS rules configuration |
| 2. Navigation & Redirects | Consistent topbar links + completion redirect update | Topbar CSS layout break on Dashboard |
| 3. Chronological History Page | Paginated `/history` SSR page view with cosmic aesthetics | Date parsing or duration calculation errors |

**Prerequisites**: Active Supabase connection with workout tables populated.
**Estimated effort**: ~1 development session across 3 phases.

## Open Risks & Assumptions

- **Assumed Schema Integrity**: Assumes `completed_at` is only populated for completed sessions, while `started_at` is always present.
- **Duration calculations**: Abandoned sessions do not have a `completed_at` timestamp. We will fall back to displaying "Abandoned" duration or "N/A" for these.

## Success Criteria (Summary)

- Signed-in users can browse their complete list of past workouts page-by-page.
- Completing a workout redirects users directly to their fresh history record.
- Inactive/abandoned logs are visible and clearly differentiated from completed workouts.
