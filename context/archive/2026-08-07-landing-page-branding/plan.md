# FlowFit Homepage Rebrand — Implementation Plan

## Overview

The homepage (`/`, rendered via `src/pages/index.astro` → `src/components/Welcome.astro`) still ships the unmodified 10x-Astro-Starter template: a generic "10x Astro Starter" heading, a generic tagline about the starter kit itself, static Sign In/Sign Up CTAs, and 3 feature cards describing the starter template's tooling (Auth Ready, Modern Stack, Developer Experience) rather than FlowFit. This plan rebrands that content to describe FlowFit itself, makes the hero CTAs auth-aware, and fixes the leftover default page `<title>`.

## Current State Analysis

- `src/pages/index.astro` renders `<Layout><Welcome /></Layout>` with no `title` prop override, so it inherits `Layout.astro`'s default `title = "10x Astro Starter"` (`src/layouts/Layout.astro:10`).
- `src/components/Welcome.astro` (127 lines) hand-rolls all of its hero and feature-card markup with raw Tailwind (glassmorphism "cosmic" theme: `border border-white/10 bg-white/5 backdrop-blur-xl`) — it does not use the shadcn `Button` or `Card` components from `src/components/ui/`.
- `Welcome.astro` already renders `<Topbar />` (`src/components/Topbar.astro`), which independently handles auth-aware navigation (shows email + Dashboard/History/Edit profile/Sign out when logged in, Sign in/Sign up when not) by reading `const { user } = Astro.locals;` in its frontmatter and branching in the template. The hero CTA buttons inside `Welcome.astro` are separate from `Topbar` and are currently static links regardless of auth state.
- `src/middleware.ts` always sets `context.locals.user` (to the Supabase user or `null`) on every request, including `/`, since `/` is not in `PROTECTED_ROUTES`. This means `Astro.locals.user` is safe to read unconditionally in `Welcome.astro`.
- `/dashboard` and `/history` are confirmed existing routes (`src/pages/dashboard.astro`, `src/pages/history.astro`).
- Feature-card content is grounded in `context/foundation/prd.md`: the core end-to-end flow is onboarding survey → AI-personalized weekly plan → live set/rep/weight logging during a workout → chronological history with PR-improvement highlighting.

## Desired End State

Visiting `/` shows:

- Browser tab title "FlowFit" instead of "10x Astro Starter".
- Hero heading "FlowFit" instead of "10x Astro Starter".
- A friendly, conversational one-to-two sentence tagline describing what FlowFit actually does (personalized plan, live logging, progress tracking) instead of the starter-kit blurb.
- Hero CTA buttons that reflect the visitor's auth state: signed out → Sign In / Sign Up (unchanged); signed in → Dashboard (primary) / History (secondary), linking to the real `/dashboard` and `/history` routes.
- Three feature cards titled around Plan / Log / Progress, each with FlowFit-specific copy and a relevant icon, in the same visual card style as today.

Verification: load `/` logged out and logged in (via `npm run dev`, manually signing in with a local Supabase test user) and visually confirm all four content points above.

### Key Discoveries:

- Auth-branching pattern to mirror: `src/components/Topbar.astro:1-3` (`const { user } = Astro.locals;` in frontmatter) and `Topbar.astro:9-11` / `:32-34` (ternary branching in the template).
- `Layout.astro:10` (`const { title = "10x Astro Starter" } = Astro.props;`) is the single place the default title is set — no other page currently overrides it for `/`.

## What We're NOT Doing

- Not changing `Topbar.astro` — it's already auth-aware and out of scope.
- Not adding a "continue last workout" CTA or any workout-state-aware logic — out of scope per user decision.
- Not migrating the hero/cards to shadcn `Button`/`Card` components — staying with the existing hand-rolled Tailwind "cosmic" glass-card style per user decision.
- Not touching `src/pages/index.astro` itself (no props/logic change needed there — `Welcome.astro` will read `Astro.locals.user` directly, same as `Topbar.astro` does).
- Not changing any other page's title (`history.astro`, `dashboard.astro`, etc. are unaffected — only the shared default in `Layout.astro`).

## Implementation Approach

Single component rewrite (`Welcome.astro`) plus a one-line default change in `Layout.astro`. No new files, no new routes, no data/schema changes. The auth-branching approach directly copies the established `Astro.locals.user` + ternary pattern already used in `Topbar.astro`, so there's no new pattern being introduced to the codebase.

## Phase 1: Homepage hero rebrand

### Overview

Replace the hero heading, tagline, and CTA buttons in `Welcome.astro` with FlowFit branding, and make the CTAs auth-aware.

### Changes Required:

#### 1. Hero heading and tagline

**File**: `src/components/Welcome.astro`

**Intent**: Replace the `<h1>` text "10x Astro Starter" with "FlowFit", and replace the tagline paragraph ("A production-ready starter with authentication, modern tooling, and a cosmic developer experience.") with new friendly/conversational copy describing FlowFit's core value: a personalized weekly plan generated from a short onboarding survey, real-time set logging during workouts, and a progress history with PR highlights.

**Contract**: Use this exact copy —

- Heading: `FlowFit`
- Tagline: `No more guessing what to train today. FlowFit builds your personalized weekly plan, tracks every set as you go, and keeps your progress in one place.`

Both elements keep their existing classes/positions (`<h1>` gradient text classes, `<p>` tagline classes) — only the text content changes.

#### 2. Auth-aware hero CTAs

**File**: `src/components/Welcome.astro`

**Intent**: The two hero CTA links currently point unconditionally to `/auth/signin` and `/auth/signup`. Branch them on auth state, mirroring `Topbar.astro`'s pattern, so a logged-in visitor sees direct links into the app instead of sign-in prompts.

**Contract**: Add `const { user } = Astro.locals;` to the frontmatter. Wrap the existing two-link `<div class="flex flex-col gap-4 sm:flex-row">` block in a `{ user ? (...) : (...) }` ternary:

- Logged out (existing markup, unchanged): primary-styled link → `/auth/signin` labeled "Sign In"; secondary-styled link → `/auth/signup` labeled "Sign Up".
- Logged in (new): primary-styled link (same classes as the current "Sign In" button) → `/dashboard` labeled "Dashboard"; secondary-styled link (same classes as the current "Sign Up" button) → `/history` labeled "History".

Use a JSX fragment (`<>...</>`) for each branch, matching the fragment style already used in `Topbar.astro:9-11` and `Topbar.astro:23-33`.

#### 3. Page title default

**File**: `src/layouts/Layout.astro`

**Intent**: The browser tab title still reads the starter-template default. Update it so `/` (and any other page that doesn't pass its own `title` prop) shows "FlowFit" instead.

**Contract**: Change line 10 from `const { title = "10x Astro Starter" } = Astro.props;` to `const { title = "FlowFit" } = Astro.props;`. No other line changes.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (or the project's configured check command)
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Loading `/` while signed out shows heading "FlowFit", the new tagline, and Sign In / Sign Up buttons linking to `/auth/signin` and `/auth/signup`
- Loading `/` while signed in (via a local Supabase test user) shows Dashboard / History buttons linking to `/dashboard` and `/history`, and clicking each navigates correctly
- Browser tab title reads "FlowFit" on `/`

---

## Phase 2: Feature cards rewrite

### Overview

Replace the 3 generic feature cards (Auth Ready / Modern Stack / Developer Experience) with FlowFit-specific cards covering the core Plan → Log → Progress flow, keeping the existing glass-card visual style.

### Changes Required:

#### 1. Feature card content and icons

**File**: `src/components/Welcome.astro`

**Intent**: Replace all 3 `<div class="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">` cards' icon/title/description with FlowFit-specific content grounded in the PRD's core user flow (onboarding survey → personalized plan, live logging during a workout, history with PR highlights). Keep the card container classes, icon SVG attribute conventions (`width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ... class="mb-4 text-purple-300"`), and title/description text classes unchanged — only swap each card's icon `<path>`/shape children, `<h3>` text, and `<p>` text.

**Contract**: Use this exact copy and icon per card, in this order:

1. **Personalized Weekly Plan** — icon: calendar (lucide `calendar`: `<rect width="18" height="18" x="3" y="4" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>`). Description: `Tell us your goal, experience, and equipment once — FlowFit builds a training plan tailored to you, ready to launch.`
2. **Log As You Train** — icon: activity/pulse (lucide `activity`: `<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>`). Description: `Track sets, reps, and weight in real time during your workout — no spreadsheets, no reconstructing it afterward.`
3. **See Your Progress** — icon: trending-up (lucide `trending-up`: `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline>`). Description: `Every finished workout lands in your history, with personal records highlighted so you can see how far you've come.`

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Loading `/` shows exactly 3 feature cards titled "Personalized Weekly Plan", "Log As You Train", "See Your Progress" with the new descriptions, each rendering its icon correctly
- Visual style (card borders, blur, spacing, icon color) is unchanged from the current cosmic theme

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new unit-testable logic is introduced (pure content + a boolean ternary already exercised by `Topbar.astro`'s existing behavior). No new unit tests required.

### Integration Tests:

- None required — no new API routes, data model, or server logic.

### Manual Testing Steps:

1. Run `npm run dev`, visit `/` while logged out — confirm heading, tagline, feature cards, and Sign In/Sign Up CTAs.
2. Sign in with a local Supabase test user, revisit `/` — confirm CTAs now read Dashboard/History and link correctly.
3. Click through both Dashboard and History links from the signed-in homepage to confirm they land on the correct existing pages.
4. Check the browser tab title reads "FlowFit".

## Performance Considerations

None — this is a static content change with no new data fetching, computation, or client-side JavaScript.

## Migration Notes

Not applicable — no data model or schema changes.

## References

- Auth-branching pattern: `src/components/Topbar.astro`
- Middleware setting `Astro.locals.user`: `src/middleware.ts`
- Feature copy grounded in: `context/foundation/prd.md` (Success Criteria, User Stories, Functional Requirements sections)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Homepage hero rebrand

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — f9f47b2
- [x] 1.2 Linting passes: `npm run lint` — f9f47b2
- [x] 1.3 Build succeeds: `npm run build` — f9f47b2

#### Manual

- [x] 1.4 Logged-out `/` shows FlowFit heading, new tagline, Sign In/Sign Up buttons linking correctly
- [x] 1.5 Logged-in `/` shows Dashboard/History buttons linking correctly
- [x] 1.6 Browser tab title reads "FlowFit" on `/`

### Phase 2: Feature cards rewrite

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 1c725e1
- [x] 2.2 Linting passes: `npm run lint` — 1c725e1
- [x] 2.3 Build succeeds: `npm run build` — 1c725e1

#### Manual

- [x] 2.4 3 feature cards show new titles/descriptions/icons correctly
- [x] 2.5 Visual style unchanged from current cosmic theme
