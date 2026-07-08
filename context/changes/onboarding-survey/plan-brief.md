# Onboarding Survey — Plan Brief

> Full plan: `context/changes/onboarding-survey/plan.md`

## What & Why

Build the one-time onboarding survey (roadmap slice S-01): a signed-in user without a saved profile is routed to `/onboarding`, answers five questions (training goal, experience level, equipment, preferred style, sessions per week), and the answers are saved to `user_profiles`. This is the first step of FlowFit's primary end-to-end flow and unblocks S-02 (AI plan generation), which is currently blocked on an AI provider decision.

## Starting Point

The `user_profiles` table, its RLS policies, and its `CHECK` constraints already exist (F-01, merged). Auth is fully wired (`src/middleware.ts`, sign-in/up/out routes), but nothing gates on profile completeness yet, and sign-in currently redirects to the unrelated Astro starter Welcome page (`/`) instead of anywhere in the authenticated app. Zod is not yet a dependency, and `src/lib/services/` is empty — both get their first real usage here.

## Desired End State

A first-time user signs in, lands on `/onboarding` automatically, fills in all five fields, and lands on `/dashboard?saved=1` with a confirmation — a row now exists in `user_profiles`. Revisiting `/onboarding` afterward shows a read-only summary instead of the form. Direct `/dashboard` access without a saved profile bounces back to `/onboarding`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Profile-completeness gate | Middleware-level check on `/dashboard` | Single enforcement point, matches the existing `PROTECTED_ROUTES` pattern, one cheap indexed lookup per request on that route only |
| Post-survey redirect | `/dashboard?saved=1` with an inline banner | No plan page exists yet (S-02 blocked); reuses the existing placeholder landing page |
| Revisiting `/onboarding` after completion | Read-only pre-filled summary | Transparent without crossing into profile *editing*, which PRD Non-Goals defers to V2 |
| Sign-in redirect target | Changed from `/` to `/dashboard` | Without this fix the profile gate never runs — sign-in currently dead-ends on the unrelated starter Welcome page |
| Single-select fields (goal/level/style) | Hand-rolled radio-card groups | Matches the app's existing glassmorphism styling; auth forms deliberately skip shadcn |
| Equipment field | Toggleable chip/checkbox list | Multi-select interaction, same visual language as the radio cards |
| Validation architecture | Server-only zod; hand-rolled client required-field checks | Matches `SignUpForm.tsx`'s existing convention exactly; avoids shipping zod to the browser |
| Sessions-per-week input | Segmented 1–7 button group | Avoids mobile number-input quirks; same interaction model as the radio cards |

## Scope

**In scope:**
- `user_profiles` read/write via a new service module
- Zod validation schema (first use in the repo) with vocabulary matching the DB `CHECK` constraints
- Middleware profile-completeness gate + sign-in redirect fix
- `/api/profile` POST route
- `/onboarding` page (form + read-only revisit view) and a dashboard success acknowledgment

**Out of scope:**
- Profile editing / retake-survey UI (V2, per PRD Non-Goals)
- The AI plan page (S-02, separately blocked)
- Any `workout_*`/`exercises` table or seed changes
- Automated tests (none configured in this repo)

## Architecture / Approach

Bottom-up build order: shared vocabulary + zod schema + service layer (Phase 1) → middleware gating + sign-in redirect (Phase 2) → `/api/profile` route (Phase 3) → UI components and pages (Phase 4). Each phase is independently lint/build-clean. The five fields' allowed values and labels live in one file (`src/lib/onboarding-options.ts`) so the server-only zod schema and the client-side UI never drift apart.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Foundation | Zod dependency, shared vocabulary, validation schema, profile service | Vocabulary/enum values drifting from the DB `CHECK` constraints |
| 2. Middleware gating | Profile-completeness redirect, sign-in target fix | This is the roadmap's explicitly flagged risk — get the redirect logic wrong and the primary flow breaks at step one |
| 3. Submit API route | `/api/profile` POST: validate, persist, redirect | Duplicate-submission handling (PK uniqueness) needs a clean, non-error redirect |
| 4. Onboarding UI | Form, read-only summary, dashboard banner | Native-POST field wiring for the styled radio/chip/segmented controls must stay real `<input>` elements, not JS-only fake buttons |

**Prerequisites:** F-01 (done); local Supabase stack running for manual DB verification
**Estimated effort:** ~1-2 sessions across 4 phases

## Open Risks & Assumptions

- Assumes no automated test suite is expected (confirmed by AGENTS.md) — all verification is lint/build/manual.
- Assumes the dashboard success banner should be a small inline element, not the existing `Banner.astro` (which is styled for site-wide config warnings, not per-page success messages).

## Success Criteria (Summary)

- A first-time signed-in user reaches `/onboarding`, completes it, and lands on `/dashboard` with their profile saved — no manual DB step required.
- A returning user with a saved profile never sees the survey form again unless they navigate to `/onboarding` directly, where they see a read-only summary.
- `npm run lint` and `npm run build` pass throughout.
