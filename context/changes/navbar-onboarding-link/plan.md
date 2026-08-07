# Navbar Onboarding Link Implementation Plan

## Overview

Add an "Edit profile" link to the shared `Topbar` so a logged-in user who already has a plan can navigate back to `/onboarding` — today there is no nav entry point once a profile exists, only the "Back to dashboard" link inside `ProfileSummary` on the onboarding page itself.

## Current State Analysis

- `src/components/Topbar.astro` renders "Dashboard" / "History" / "Sign out" for a logged-in user (`:13-23`) — no link to `/onboarding`.
- `Topbar` is used on `dashboard.astro`, `history.astro`, and `Welcome.astro`. `onboarding.astro` itself does **not** render `Topbar` (it has its own header/back-link via `ProfileSummary.tsx:51-56`), so adding the link there is a no-op for that page — expected, since you're already on `/onboarding`.
- `/onboarding` is in `PROTECTED_ROUTES` (`src/middleware.ts:5`) but **not** in `PROFILE_REQUIRED_ROUTES` (`:6`) — visiting it with an existing profile is already fully supported today and renders `ProfileSummary` (goal/experience/equipment/etc. + "Reset profile"). No middleware change needed.

## Desired End State

From `/dashboard` or `/history`, a logged-in user can click a nav link to reach `/onboarding` and see their saved profile (with the option to reset it), without going through a "reset first" detour.

Verify by: signing in with a completed profile, clicking the new link from both `/dashboard` and `/history`, landing on `/onboarding` showing `ProfileSummary`.

## What We're NOT Doing

- No change to `middleware.ts` — `/onboarding` already works correctly for users with an existing profile.
- No change to `ProfileSummary.tsx` or the onboarding page itself.
- No new mobile/hamburger nav — `Topbar` has no responsive collapse today; this follows the existing flat-link pattern.

## Implementation Approach

Single-file change: add one more `<a>` link to the logged-in branch of `Topbar.astro`, alongside "Dashboard" and "History".

## Phase 1: Add the link

### Changes Required:

#### 1. Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Give logged-in users a nav path back to `/onboarding` to view/edit their profile.

**Contract**: Insert a link labeled "Edit profile" pointing to `/onboarding`, between "History" and the sign-out form (`:16-19`), using the same classes as the existing links (`text-purple-300 transition-colors hover:text-purple-100 hover:underline`).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Signed in with an existing profile, `/dashboard` and `/history` both show an "Edit profile" link in the Topbar
- Clicking it navigates to `/onboarding` and shows the saved profile summary (not a blank form)
- Signed out, the Topbar is unchanged (no "Edit profile" link, sign-in/sign-up links only)

## Testing Strategy

### Manual Testing Steps:

1. Sign in as a user with a completed profile.
2. From `/dashboard`, click "Edit profile" → lands on `/onboarding`, `ProfileSummary` is shown.
3. From `/history`, repeat the same check.
4. Sign out, confirm the Topbar shows only Sign in / Sign up (no "Edit profile").

No unit/integration tests — this is a static link addition to an `.astro` component with no logic branch beyond the existing `user ? ... : ...` check, consistent with `AGENTS.md`'s note that this project has no automated test suite for this kind of change.

## Performance Considerations

None — one static anchor tag.

## References

- `src/components/Topbar.astro`
- `src/middleware.ts` (`PROTECTED_ROUTES`, `PROFILE_REQUIRED_ROUTES`)
- `src/components/onboarding/ProfileSummary.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Add the link

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build succeeds: `npm run build`

#### Manual

- [x] 1.3 "Edit profile" link visible and working from `/dashboard` and `/history` — verified via temporary Playwright script against local Supabase (signed-in seeded user, link visible on both pages, click lands on `/onboarding` showing the profile summary)
- [x] 1.4 Signed-out Topbar unchanged — verified via the same script (`/auth/signin` shows no "Edit profile" link)
