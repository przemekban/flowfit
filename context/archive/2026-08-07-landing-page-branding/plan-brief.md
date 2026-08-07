# FlowFit Homepage Rebrand — Plan Brief

> Full plan: `context/changes/landing-page-branding/plan.md`

## What & Why

The homepage at `/` still ships the unmodified 10x-Astro-Starter template — generic heading, generic tagline, static Sign In/Sign Up buttons, and 3 feature cards describing starter-kit tooling instead of FlowFit. This plan rebrands the hero and feature cards to describe FlowFit itself, makes the hero CTAs reflect whether the visitor is logged in, and fixes the leftover default page title.

## Starting Point

`src/components/Welcome.astro` hand-rolls its markup with raw Tailwind (no shadcn `Button`/`Card` usage). It already renders `<Topbar />`, which independently handles auth-aware nav using `const { user } = Astro.locals;` — that pattern is copied here rather than invented. `/` is a public route (not in `PROTECTED_ROUTES`), so `Astro.locals.user` is always safely readable (Supabase user or `null`).

## Desired End State

Visiting `/`: heading reads "FlowFit", tagline describes the actual product (personalized plan, live logging, progress history), hero buttons show Dashboard/History when logged in (Sign In/Sign Up when not), the 3 feature cards describe Plan/Log/Progress with FlowFit copy, and the browser tab title reads "FlowFit".

## Key Decisions Made

| Decision            | Choice                                              | Why (1 sentence)                                                                                                                    | Source |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Base branch         | `origin/main`                                       | No `origin/develop` exists in this repo; user confirmed `main` as the base.                                                         | Plan   |
| Copy tone           | Friendly & conversational                           | User's explicit pick over confident/benefit-led or technical/feature-first.                                                         | Plan   |
| Feature cards       | Plan / Log / Progress                               | Mirrors the PRD's core onboarding→plan→log→history flow exactly.                                                                    | Plan   |
| Logged-in hero CTAs | Dashboard (primary) + History (secondary) only      | Matches the user's original ask exactly; no extra "continue workout" logic in scope.                                                | Plan   |
| Page `<title>`      | Also fix `Layout.astro` default to "FlowFit"        | Same generic-starter leftover as the heading; low-risk one-line change.                                                             | Plan   |
| Card visual style   | Keep existing hand-rolled Tailwind glass-card style | Zero regression risk, consistent with the rest of the "cosmic" hero; no shadcn `Card` usage exists yet elsewhere in `.astro` files. | Plan   |

## Scope

**In scope:**

- `src/components/Welcome.astro`: heading, tagline, auth-aware hero CTAs, 3 feature cards (content + icons)
- `src/layouts/Layout.astro`: default `title` prop

**Out of scope:**

- `Topbar.astro` (already auth-aware, untouched)
- Any workout-state-aware CTA (e.g. "continue last workout")
- Migrating to shadcn `Button`/`Card` components
- Any other page's title

## Architecture / Approach

Pure content + one conditional branch, no new files or routes. `Welcome.astro` reads `Astro.locals.user` directly (same as `Topbar.astro`) and ternary-branches the hero CTA markup between logged-out (Sign In/Sign Up) and logged-in (Dashboard/History) states.

## Phases at a Glance

| Phase                    | What it delivers                                          | Key risk                                              |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------- |
| 1. Homepage hero rebrand | FlowFit heading, tagline, auth-aware CTAs, page title fix | Low — mirrors existing `Topbar.astro` pattern exactly |
| 2. Feature cards rewrite | 3 FlowFit-specific feature cards with new icons/copy      | Low — content-only change, same card shell            |

**Prerequisites:** None — branch `landing-page-branding` already created from `origin/main`, change folder initialized.
**Estimated effort:** ~1 session, single file plus a one-line change.

## Open Risks & Assumptions

- Assumes a local Supabase test user is available for manual logged-in verification (per `README.md` local setup).
- Icon choices (calendar, activity, trending-up) are a judgment call within the "keep existing hand-rolled style" decision — not separately confirmed line-by-line with the user, but consistent with the established icon-per-card convention.

## Success Criteria (Summary)

- Logged-out and logged-in visitors to `/` each see the correct, FlowFit-specific hero copy and CTAs
- All 3 feature cards describe FlowFit's actual Plan/Log/Progress flow
- Browser tab title reads "FlowFit"
