# Workout History Chronological List View Implementation Plan

## Overview

Implement a chronological list view at `/history` for logged workouts (both completed and abandoned sessions), including route protection, navigation, and visual styling matching FlowFit's cosmic aesthetic.

## Current State Analysis

- **Service Layer**: [session.ts](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/lib/services/session.ts) contains functions for active session management, set upserting/deletion, and single session retrieval, but lacks a query for listing multiple historical sessions.
- **Route Protection**: [middleware.ts](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/middleware.ts) protects `/dashboard` and `/session` but knows nothing about `/history`.
- **Navigation**: [Topbar.astro](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/components/Topbar.astro) lacks a link to `/history`. Additionally, [dashboard.astro](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/pages/dashboard.astro) does not render the `<Topbar />` component.
- **Session Redirection**: [SessionLogger.tsx](file:///E:/kursy/10xdevs/FlowFit-workout-history/src/components/session/SessionLogger.tsx) redirects to `/dashboard` upon completing a session instead of sending the user to their history.

## Desired End State

- **History Page**: A server-rendered page at `/history` listing historical sessions ordered by start date (descending), showing the status (Completed or Abandoned), the duration of the workout, and the individual sets logged.
- **Pagination**: Next-page-indicator pagination using query parameters (`?page=N`), limiting to 10 sessions per page.
- **Consistent Navigation**: A topbar navigation link across both Dashboard and History views.

### Key Discoveries:

- `idx_workout_sessions_user_status` indexes `(user_id, status)` and `idx_workout_sessions_user_completed` indexes `(user_id, completed_at DESC)`.
- When a session has logged sets and is restarted, its status is set to `'abandoned'` in the database via the `restart_workout_session` stored procedure.

## What We're NOT Doing

- Direct edit/delete capabilities for historical sessions from the history list (this is read-only).
- Real-time session analytics, graphs, or charts in this view.
- Client-side interactive pagination (we will use server-side pagination with query parameters for clean SSR).

## Implementation Approach

1. **Service**: Implement `getWorkoutSessionHistory` in `session.ts` to retrieve user sessions with status `completed` or `abandoned`, ordering by `started_at DESC`. Use `.range(offset, offset + limit)` to fetch one extra item as a next-page indicator.
2. **Tests**: Add unit tests in `session.test.ts` to verify query range bounds, sorting, status filters, and set sorting.
3. **Protection**: Add `/history` to middleware protection arrays.
4. **Navigation & Redirect**: Wire `/history` into `Topbar.astro`, include topbar on the dashboard, and update `SessionLogger.tsx`'s redirect.
5. **Page View**: Implement `history.astro` with duration formatting, status badge styling, set listings, and pagination buttons.

---

## Phase 1: Backend Service & Route Protection

### Overview

Add history querying capabilities to the service layer, verify correctness with both mock unit tests and real database integration tests using a TDD approach (tests written first), and secure the route in middleware.

### Changes Required:

#### 1. Service Integration Tests [NEW]
**File**: `tests/integration/workout-history-rls.test.ts`

**Intent**: Write integration tests first (TDD) that run against the local Docker Supabase instance to test real database query execution, pagination logic, session status filtering, and Row Level Security (RLS) constraints.

**Contract**:
- Verify that users can only fetch their own session history (RLS security check).
- Verify that only completed and abandoned sessions are returned (active sessions are excluded).
- Verify that sorting is chronological (`started_at DESC`) and nested sets are sorted (`set_number ASC`).
- Verify range-based pagination bounds.

#### 2. Service Layer
**File**: `src/lib/services/session.ts`

**Intent**: Implement the query to fetch the paginated history of completed and abandoned workout sessions, joining workouts, sets, and exercises, satisfying the TDD tests.

**Contract**:
```typescript
export async function getWorkoutSessionHistory(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  offset: number
): Promise<{ sessions: WorkoutSessionWithSets[]; hasMore: boolean }>
```

#### 3. Service Unit Tests
**File**: `src/lib/services/session.test.ts`

**Intent**: Add unit tests verifying query structure mapping and query builder params to keep the unit test suite complete.

**Contract**: Add a `describe("getWorkoutSessionHistory", ...)` block mock testing standard query mappings.

#### 4. Route Protection
**File**: `src/middleware.ts`

**Intent**: Secure `/history` to require user authentication and onboarding.

**Contract**: Add `"/history"` to `PROTECTED_ROUTES` and `PROFILE_REQUIRED_ROUTES` arrays.

### Success Criteria:

#### Automated Verification:
- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration` (verifies actual business and database logic against Supabase)
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:
- Accessing `/history` unauthenticated redirects to `/auth/signin`.
- Accessing `/history` without a profile redirects to `/onboarding`.

---

## Phase 2: Navigation & Flow Redirection

### Overview

Integrate `/history` into the application's navigation bars, dashboard, and completion redirect loop.

### Changes Required:

#### 1. Navigation Bar
**File**: `src/components/Topbar.astro`

**Intent**: Provide a visible link to "/history" next to the Dashboard link when signed in.

**Contract**: Add `<a href="/history">History</a>` within the authenticated user section.

#### 2. Dashboard Layout
**File**: `src/pages/dashboard.astro`

**Intent**: Ensure the Topbar is rendered at the top of the dashboard page.

**Contract**: Import `Topbar` and render `<Topbar />` inside the layout container above the main dashboard cards.

#### 3. Completion Redirect
**File**: `src/components/session/SessionLogger.tsx`

**Intent**: Redirect users to `/history` instead of `/dashboard` upon completing their workout session.

**Contract**: Update `window.location.href = "/dashboard"` to `"/history"`.

### Success Criteria:

#### Automated Verification:
- Build passes: `npm run build`
- Type checking passes: `npx astro check`

#### Manual Verification:
- Topbar is visible on both Dashboard and History views, linking properly between them.
- Completing a workout successfully redirects user to `/history`.

---

## Phase 3: Chronological History Page

### Overview

Implement the paginated, styled history page at `/history` with a premium cosmic layout.

### Changes Required:

#### 1. History Page
**File**: `src/pages/history.astro`

**Intent**: Create the new page displaying past workouts, their completed/abandoned status, date, calculated session duration, individual sets, and next-page pagination.

**Contract**:
- Page is server-rendered (`export const prerender = false` is default/implicit via Astro config).
- Reads query parameters: `const page = Number(Astro.url.searchParams.get("page") ?? "1")`.
- Calculates session duration from `started_at` and `completed_at` (for abandoned sessions, show duration as "Incomplete/Abandoned" or duration up to the last set logged if preferred; default to "N/A" or "Abandoned" status).
- Styled with Tailwind using glassmorphism cards and `@utility bg-cosmic`.
- Renders pagination controls using simple prev/next anchor tags: `<a href="?page=prev">` and `<a href="?page=next">`.

### Success Criteria:

#### Automated Verification:
- Build passes: `npm run build`
- Linting and Formatting: `npm run lint` and `npm run format`

#### Manual Verification:
- History displays a checklist/list of past workouts.
- Pagination buttons appear when there are more than 10 sessions.
- Incomplete/Abandoned workouts are clearly labeled.
- Workouts duration are calculated and formatted correctly (e.g. "45m" or "1h 12m").
- Empty state displays a CTA redirecting to dashboard.

---

## Testing Strategy

### Test-Driven Development (TDD) Approach:
1. Create `tests/integration/workout-history-rls.test.ts` and `src/lib/services/session.test.ts` with assertions verifying history retrieval behavior, RLS protections, pagination, and sorting.
2. Run `npm run test:integration` and confirm they fail as expected.
3. Write the implementation of `getWorkoutSessionHistory` in `src/lib/services/session.ts` until all unit and integration tests pass successfully.

### Integration Tests (Real Database & RLS):
- `tests/integration/workout-history-rls.test.ts`: Verifies real database RLS (User A cannot view User B's history) and filter logic (excludes active sessions) against Supabase Docker.

### Unit Tests (Mocked API):
- `src/lib/services/session.test.ts`: Verifies postgrest client builder parameter matching.

### Manual Testing Steps:
1. Complete a workout session in the UI, verify it redirects to `/history`.
2. Confirm the completed session appears at the top of `/history` with the correct exercises, sets, and calculated duration.
3. Abandon a workout session by clicking "Start Over" or starting a new session on the dashboard. Verify that the previous session is marked as "Abandoned" on `/history`.
4. Validate that page query parameters `?page=2` correctly paginate results.
5. Verify empty state CTA works.

## References

- Related research: `context/changes/workout-history/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend Service & Route Protection

#### Automated
- [x] 1.1 Write getWorkoutSessionHistory integration tests (TDD) — e47f282
- [x] 1.2 Write getWorkoutSessionHistory unit tests (TDD) — e47f282
- [x] 1.3 Implement getWorkoutSessionHistory service function (make tests pass) — e47f282
- [x] 1.4 Add route protection in middleware — e47f282

#### Manual
- [ ] 1.5 Verify auth redirects for protected history route

### Phase 2: Navigation & Flow Redirection

#### Automated
- [x] 2.1 Add navigation link in Topbar
- [x] 2.2 Add Topbar to Dashboard page
- [x] 2.3 Update redirect target in SessionLogger

#### Manual
- [ ] 2.4 Verify Topbar layout on Dashboard
- [ ] 2.5 Verify redirect upon session completion

### Phase 3: Chronological History Page

#### Automated
- [ ] 3.1 Create history page with server-side pagination
- [ ] 3.2 Ensure type checking and linting pass

#### Manual
- [ ] 3.3 Verify chronological layout, duration formatting, and badges
- [ ] 3.4 Verify pagination controls functional
- [ ] 3.5 Verify empty state CTA redirect
