# Onboarding Survey Implementation Plan

## Overview

Build the one-time onboarding survey (S-01): a signed-in user without a saved profile is routed to `/onboarding`, completes five fields (training goal, experience level, equipment, preferred style, sessions per week), and the answers are persisted to the existing `user_profiles` table. This closes the first step of the primary end-to-end flow (registration → survey → plan → workout → history) and unblocks S-02 (AI plan generation).

## Current State Analysis

- `user_profiles` (schema, RLS, `CHECK` constraints) already exists from F-01 (`supabase/migrations/20260529000000_core_schema.sql:88-97`) with SELECT/INSERT/UPDATE policies for the owner and no DELETE policy. `src/types.ts:19-28` already defines the `UserProfile` entity and the five enum union types.
- Auth is fully wired: `src/middleware.ts` resolves `context.locals.user` on every request and gates `PROTECTED_ROUTES = ["/dashboard"]`, but there is no profile-completeness check anywhere — a signed-in user with no survey answers can reach `/dashboard` freely today.
- `src/pages/api/auth/signin.ts:19` redirects to `/` (the unrelated Astro starter Welcome page) after a successful sign-in, so the app currently has no automatic path into `/dashboard` or any future gate.
- The only existing form flow is auth (`SignUpForm.tsx`, `SignInForm.tsx`): controlled React components using `useState` + a hand-rolled `validate()` function, submitting via a plain `<form method="POST" action="...">` (no `fetch`/JSON), with server errors passed back via a `?error=` redirect query param and rendered by the reusable `ServerError` component. `SubmitButton` wraps `useFormStatus` for pending state.
- Zod is not yet a dependency of this project and no route validates input with it, despite AGENTS.md's "validate all input with zod" rule — `signup.ts`/`signin.ts` pass form fields straight to Supabase. This plan introduces the first real usage.
- `src/lib/services/` is empty — this plan introduces the first extracted service module.
- No shadcn form primitives beyond `Button` are installed (`src/components/ui/`); existing auth forms deliberately hand-roll their inputs to match the app's glassmorphism styling (`bg-cosmic`, `bg-white/10`, gradient headings) rather than using shadcn.

## Desired End State

A first-time user who signs in lands on `/onboarding` automatically (no profile yet), fills in all five fields, submits, and lands on `/dashboard?saved=1` with a saved confirmation; a row now exists in `user_profiles` scoped to their `id` via RLS. A user who already completed the survey and revisits `/onboarding` sees a read-only summary of their saved answers instead of the form. A signed-in user without a profile who tries to open `/dashboard` directly is redirected to `/onboarding`.

Verify via: `npm run lint` and `npm run build` passing, plus the manual walkthrough in each phase's Success Criteria and in Testing Strategy below.

### Key Discoveries

- `user_profiles.equipment` is a `TEXT[]` constrained by `CHECK (equipment <@ ARRAY['barbell','dumbbell','bodyweight','machine','cable','resistance_band','kettlebell']::text[])` (`supabase/migrations/20260529000000_core_schema.sql:92`) — the zod schema must enforce exactly this vocabulary or valid-looking client input can still fail at the DB layer with an opaque constraint error.
- `sessions_per_week` is constrained to `BETWEEN 1 AND 7` (same file, line 94).
- `user_profiles` has no DELETE policy and an UPDATE policy exists in the schema, but FR-004/PRD Non-Goals scope this slice to one-time creation only — the UPDATE policy is architectural readiness for V2 profile editing, not something this slice's UI exposes.
- `SignUpForm.tsx` and `FormField.tsx` are the pattern to imitate for controlled state, error display, and native-POST field wiring (`name` attributes carry values through the plain form submit, no `fetch`).

## What We're NOT Doing

- Profile editing or "retake the survey" UI — PRD Non-Goals defers this to V2; the read-only view has no edit affordance.
- The AI plan / "My Plan" page (S-02) — that slice is blocked on an AI provider decision; `/dashboard` remains the placeholder authenticated landing page after survey completion.
- Workout template browsing, personal workout library, or any `workout_*` table changes — unrelated slices, `user_profiles` is the only table this plan touches.
- A shared client+server zod schema — decided against; the client does lightweight required-field checks only (mirrors `SignUpForm.tsx`), zod stays server-side.
- Installing shadcn `RadioGroup`/`Select`/`Checkbox` — decided against; new components hand-roll inputs to match the existing auth-form styling convention.
- Rate limiting, CAPTCHA, or abuse protection on the submit route — not required by any PRD NFR.
- Automated tests — AGENTS.md confirms no test suite is configured in this repo; verification here is lint, build, and manual.

## Implementation Approach

Bottom-up: shared vocabulary + validation + service layer first (Phase 1), then the routing/gating rules that depend on the service (Phase 2), then the API route that depends on validation + service (Phase 3), then the UI that depends on the API route existing (Phase 4). Each phase is independently buildable and lint/build-clean.

## Critical Implementation Details

**Shared option vocabulary.** Define the five fields' allowed values and display labels once, in `src/lib/onboarding-options.ts`, as the single source of truth. The zod schema (Phase 1) builds its `z.enum(...)` calls from these arrays' `value` fields; the UI components (Phase 4) map over the same arrays for labels. This keeps client and server aligned on vocabulary without shipping zod itself to the browser (the "server-only zod, hand-rolled client hints" decision).

**Native-POST field contract for styled selection controls.** The radio-card, chip, and segmented-button controls must render real `<input type="radio">` / `<input type="checkbox">` elements with `name` attributes (visually hidden or styled via their `<label>`, not `div`-based fake buttons), because the app's form convention is a plain `<form method="POST">` submit, not a JS-intercepted `fetch`. `equipment` uses repeated checkboxes sharing `name="equipment"`; the API route reads them with `formData.getAll("equipment")`.

**Duplicate-submission handling.** A rogue second POST to `/api/profile` from a user who already has a profile row will hit the `user_profiles` primary-key uniqueness constraint. Since FR-004/Non-Goals rule out silent profile editing in MVP, the service does a plain `insert` (never `upsert`). The route catches a unique-violation specifically and redirects to `/dashboard` (the profile already exists, so that's already the correct end state) rather than surfacing it as a user-facing error; any other insert failure redirects to `/onboarding?error=...`.

## Phase 1: Foundation — Shared Vocabulary, Validation Schema, Profile Service

### Overview

Establish the reusable pieces every later phase depends on: the canonical field vocabulary, the zod schema built from it, and a service module wrapping the two `user_profiles` queries this slice needs.

### Changes Required

#### 1. Add zod dependency

**File**: `package.json`

**Intent**: Enable schema validation per AGENTS.md's "validate all input with zod" rule — first real usage in this repo.

**Contract**: Add `"zod"` to `dependencies`; run `npm install`.

#### 2. Shared onboarding option vocabulary

**File**: `src/lib/onboarding-options.ts`

**Intent**: Single source of truth for the five fields' selectable values and display labels, consumed by both the zod schema and the UI components.

**Contract**: Exported readonly arrays of `{ value: string; label: string }` — `TRAINING_GOALS`, `EXPERIENCE_LEVELS`, `PREFERRED_STYLES`, `EQUIPMENT_OPTIONS` — whose `value`s exactly match the string literals in `src/types.ts`'s `TrainingGoal`/`ExperienceLevel`/`PreferredStyle` unions and the DB `CHECK` constraint's equipment list. Also export `SESSIONS_PER_WEEK_MIN = 1` and `SESSIONS_PER_WEEK_MAX = 7`.

#### 3. Validation schema

**File**: `src/lib/validation/profile.ts`

**Intent**: The server-side source of truth for onboarding submissions.

**Contract**: `onboardingSchema = z.object({...})` with `training_goal`/`experience_level`/`preferred_style` as `z.enum` built from the `onboarding-options.ts` value arrays, `equipment: z.array(z.enum(...)).min(1)`, and `sessions_per_week: z.coerce.number().int().min(SESSIONS_PER_WEEK_MIN).max(SESSIONS_PER_WEEK_MAX)`. Export `type OnboardingInput = z.infer<typeof onboardingSchema>`.

#### 4. Profile service

**File**: `src/lib/services/profile.ts`

**Intent**: Extract the two `user_profiles` queries this slice needs out of route handlers, per AGENTS.md's `src/lib/services/` convention. First module in this directory.

**Contract**: `getUserProfile(supabase: SupabaseClient, userId: string): Promise<UserProfile | null>` (select by PK, `.maybeSingle()`), and `createUserProfile(supabase: SupabaseClient, userId: string, input: OnboardingInput): Promise<UserProfile>` (plain `insert` with `id: userId`, `.select().single()`, throws on error — no upsert, per the duplicate-submission decision above). On error, rethrow the Postgrest error object returned by the client unmodified (do not wrap it in `new Error(...)`) so its `.code` field survives — Phase 3 needs `.code === "23505"` to detect a unique-violation specifically.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- `zod` present in `package.json` and `package-lock.json`

#### Manual Verification

- Exercise `onboardingSchema.safeParse` with a valid payload and confirm `success: true`
- Exercise it with an out-of-vocabulary `equipment` value and an out-of-range `sessions_per_week` and confirm both are rejected with field-level errors

---

## Phase 2: Middleware Gating & Auth Redirect Targets

### Overview

Wire the actual routing rule: signed-in users without a saved profile get bounced to `/onboarding`; sign-in stops dead-ending on the unrelated starter Welcome page.

### Changes Required

#### 1. Profile-completeness gate

**File**: `src/middleware.ts`

**Intent**: Extend the existing auth gate so it also enforces profile completeness on the routes that need it, and bring `/onboarding` under the existing auth requirement.

**Contract**: `PROTECTED_ROUTES` grows to `["/dashboard", "/onboarding"]` (auth required for both). A new `PROFILE_REQUIRED_ROUTES = ["/dashboard"]` is checked only after the existing auth check passes: if `context.locals.user` exists and the pathname matches `PROFILE_REQUIRED_ROUTES`, call `getUserProfile(supabase, user.id)` and redirect to `/onboarding` when it returns `null`. `/onboarding` itself gets no profile-based redirect here — Phase 4's page component decides form-vs-read-only-view directly, since it needs the full profile row anyway, not just an existence check. This keeps the added DB query scoped to the one route that needs it rather than running on every request.

#### 2. Sign-in redirect target

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Point post-sign-in at the authenticated app so the profile gate above actually gets a chance to run.

**Contract**: Change `return context.redirect("/")` to `return context.redirect("/dashboard")`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- Sign in as a user with no `user_profiles` row → land on `/onboarding`
- Sign in as a user with an existing row → land on `/dashboard`
- While signed in with no profile, type `/dashboard` directly in the URL bar → redirected to `/onboarding`
- While signed out, type `/onboarding` directly in the URL bar → redirected to `/auth/signin`

**Implementation Note**: Pause here for manual confirmation before proceeding — this phase's redirect logic is the foundation every later phase's manual testing depends on.

---

## Phase 3: Submit API Route

### Overview

The endpoint the survey form (Phase 4) posts to: validate, persist, redirect.

### Changes Required

#### 1. Profile submission endpoint

**File**: `src/pages/api/profile.ts`

**Intent**: Accept the onboarding form submission, validate it, persist it, and redirect based on outcome — following the exact POST-and-redirect convention of `src/pages/api/auth/signup.ts`.

**Contract**: `export const prerender = false;` and `export const POST: APIRoute`. Requires `context.locals.user` (redirect to `/auth/signin` if absent — defense-in-depth alongside the Phase 2 gate). Creates its own Supabase client via `createClient(context.request.headers, context.cookies)` (mirroring `signup.ts`), redirecting to `/auth/signin?error=...` if it's `null`. Reads `context.request.formData()`, builds a plain object from it (`equipment` via `formData.getAll("equipment")`, everything else via `formData.get(...)`), parses with `onboardingSchema.safeParse`. On parse failure: redirect to `/onboarding?error=<first issue message>`. On success: call `createUserProfile` in a try/catch; catch block checks `(err as PostgrestError).code === "23505"` — on that specific code, redirect to `/dashboard` (profile already exists — see Critical Implementation Details), on any other error redirect to `/onboarding?error=...`; on success redirect to `/dashboard?saved=1`.

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification

- POST a request missing a required field (e.g. via browser devtools or curl with a session cookie) → redirected to `/onboarding` with an `error` query param
- POST a complete, valid submission → a new row appears in `user_profiles` in Supabase Studio, scoped to the correct `user_id`/`id`, and the response redirects to `/dashboard?saved=1`
- POST a second valid submission for a user who already has a profile → redirected to `/dashboard` with no duplicate row created and no unhandled error

---

## Phase 4: Onboarding UI

### Overview

The survey page and its five field controls, plus the read-only revisit view and the dashboard success acknowledgment.

### Changes Required

#### 1. Radio-card group (single-select)

**File**: `src/components/onboarding/RadioCardGroup.tsx`

**Intent**: Reusable single-select control rendering real radio inputs as selectable glass cards, styled consistently with the app's existing `bg-white/10` / gradient aesthetic. Reused for `training_goal`, `experience_level`, and `preferred_style`.

**Contract**: Props `{ name: string; legend: string; options: readonly { value: string; label: string }[]; value: string; onChange: (v: string) => void; error?: string }`; renders a `<fieldset>` with one `<label>` per option wrapping a visually-hidden `<input type="radio" name={name}>`, so the native POST carries the selected value under `name`.

#### 2. Equipment field (multi-select)

**File**: `src/components/onboarding/EquipmentField.tsx`

**Intent**: Multi-select control for `equipment`, styled as toggle chips per the "Equipment UI" decision.

**Contract**: Renders one checkbox per `EQUIPMENT_OPTIONS` entry, all sharing `name="equipment"`; controlled via a `string[]` value/onChange pair.

#### 3. Sessions-per-week field

**File**: `src/components/onboarding/SessionsPerWeekField.tsx`

**Intent**: Segmented 1–7 picker, same radio-input-as-styled-button pattern as `RadioCardGroup` but laid out horizontally.

**Contract**: `name="sessions_per_week"`, options generated from `SESSIONS_PER_WEEK_MIN` to `SESSIONS_PER_WEEK_MAX`.

#### 4. Onboarding form

**File**: `src/components/onboarding/OnboardingForm.tsx`

**Intent**: Assemble the five fields plus submit/error UI into the full survey form, following `SignUpForm.tsx`'s controlled-state + `validate()` + `ServerError` + `SubmitButton` pattern.

**Contract**: `<form method="POST" action="/api/profile">`; one `useState` per field; a `validate()` mirroring `SignUpForm`'s shape that requires every field non-empty (equipment non-empty array) before allowing submit; reuses the existing `ServerError` and `SubmitButton` components directly.

#### 5. Read-only profile summary

**File**: `src/components/onboarding/ProfileSummary.tsx`

**Intent**: Read-only display of an existing profile for users who revisit `/onboarding` after completing it (the "Read-only pre-filled view" decision) — no inputs, no submit, no edit affordance.

**Contract**: Props `{ profile: UserProfile }`; renders each of the five saved answers as static labeled text (looked up via `onboarding-options.ts`), inside the same glass-card layout as the form, with a link back to `/dashboard`.

#### 6. Onboarding page

**File**: `src/pages/onboarding.astro`

**Intent**: The survey page; branches between the form and the read-only summary based on whether a profile already exists.

**Contract**: Frontmatter creates its own Supabase client via `createClient(Astro.request.headers, Astro.cookies)` (mirroring `signup.ts`), redirecting to `/auth/signin?error=...` if it's `null`, then calls `getUserProfile(supabase, user.id)`; renders `<ProfileSummary profile={profile} client:load />` when non-null, else `<OnboardingForm serverError={error} client:load />` where `error` comes from `Astro.url.searchParams.get("error")` (same pattern as `signup.astro`). Same `Layout` + `bg-cosmic` glass-card wrapper as `dashboard.astro`/`signup.astro`.

#### 7. Dashboard success acknowledgment

**File**: `src/pages/dashboard.astro`

**Intent**: Acknowledge a just-completed survey with a one-time success message (the "Dashboard with success banner" decision).

**Contract**: Reads `Astro.url.searchParams.get("saved")`; when `"1"`, renders a small inline success line inside the existing glass card, visually consistent with `ServerError`'s style (not the top-of-page `Banner.astro`, which is reserved for site-wide config warnings).

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- `astro check` / `astro sync` passes with no type errors

#### Manual Verification

- Full walkthrough: sign up → confirm (or dev auto-confirm) → sign in → land on `/onboarding` → fill all five fields → submit → land on `/dashboard?saved=1` with the success message visible → confirm the row in Supabase Studio
- Revisit `/onboarding` after completion → read-only summary renders the saved answers, no form controls present
- Resize to mobile width → all controls (radio cards, chips, segmented buttons) remain usable without horizontal scrolling
- Keyboard-only pass (Tab/Space/Enter) can reach and toggle every control, consistent with `eslint-plugin-jsx-a11y` being enabled in this repo

**Implementation Note**: Pause here for manual confirmation before considering the slice done — this is the full user-facing flow the roadmap's risk note calls out ("if survey routing isn't gated correctly, the primary flow breaks at the very first step").

---

## Testing Strategy

### Manual Testing Steps

1. New user end-to-end: sign up → sign in → `/onboarding` → complete survey → `/dashboard` with confirmation → verify DB row.
2. Returning user: sign in with an existing profile → land directly on `/dashboard` (no detour through `/onboarding`).
3. Direct-URL edge cases: `/dashboard` with no profile → bounced to `/onboarding`; `/onboarding`/`/dashboard` while signed out → bounced to `/auth/signin`.
4. Revisit-after-completion: `/onboarding` after a saved profile → read-only summary, not the form.
5. Malformed submission (devtools/curl): missing field, out-of-vocabulary equipment value, out-of-range sessions_per_week → each rejected with a clean redirect, no unhandled 500 or raw DB constraint error surfaced to the user.
6. Duplicate submission: valid POST for a user who already has a profile → no duplicate row, redirected to `/dashboard`.

### Edge Cases Covered

- Out-of-vocabulary / out-of-range values caught by zod before reaching the DB `CHECK` constraints.
- Duplicate insert attempts handled without a raw Postgres error reaching the user.
- Unauthenticated access to both new routes.

## Performance Considerations

The profile-completeness check in middleware (Phase 2) runs only for `PROFILE_REQUIRED_ROUTES` (currently just `/dashboard`), not on every request — a single indexed primary-key lookup, well within the PRD's p95 < 1s NFR.

## Migration Notes

No new Supabase migration is required. `user_profiles`, its RLS policies, and its `CHECK` constraints already exist from F-01 (`supabase/migrations/20260529000000_core_schema.sql`).

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01, lines 75-85)
- PRD: `context/foundation/prd.md` (FR-001–005, US-01)
- Schema: `supabase/migrations/20260529000000_core_schema.sql:88-97`
- Pattern to imitate: `src/components/auth/SignUpForm.tsx`, `src/components/auth/FormField.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Foundation — Shared Vocabulary, Validation Schema, Profile Service

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — b8ec3a7
- [x] 1.2 Build passes: `npm run build` — b8ec3a7
- [x] 1.3 `zod` present in `package.json` and `package-lock.json` — b8ec3a7

#### Manual

- [x] 1.4 `onboardingSchema.safeParse` accepts a valid payload — b8ec3a7
- [x] 1.5 `onboardingSchema.safeParse` rejects out-of-vocabulary equipment and out-of-range sessions_per_week — b8ec3a7

### Phase 2: Middleware Gating & Auth Redirect Targets

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 4bb0d46
- [x] 2.2 Build passes: `npm run build` — 4bb0d46

#### Manual

- [x] 2.3 Sign in with no profile → lands on `/onboarding` — 4bb0d46
- [x] 2.4 Sign in with existing profile → lands on `/dashboard` — 4bb0d46
- [x] 2.5 Direct `/dashboard` visit with no profile → redirected to `/onboarding` — 4bb0d46
- [x] 2.6 Direct `/onboarding` visit while signed out → redirected to `/auth/signin` — 4bb0d46

### Phase 3: Submit API Route

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 2756261
- [x] 3.2 Build passes: `npm run build` — 2756261

#### Manual

- [x] 3.3 Missing-field POST → redirected to `/onboarding` with `error` param — 2756261
- [x] 3.4 Valid POST → row created in `user_profiles`, redirected to `/dashboard?saved=1` — 2756261
- [x] 3.5 Duplicate POST for existing profile → redirected to `/dashboard`, no duplicate row — 2756261

### Phase 4: Onboarding UI

#### Automated

- [x] 4.1 Lint passes: `npm run lint`
- [x] 4.2 Build passes: `npm run build`
- [x] 4.3 `astro check` / `astro sync` passes

#### Manual

- [x] 4.4 Full walkthrough: signup → signin → onboarding → submit → dashboard confirmation → DB row verified
- [x] 4.5 Revisit `/onboarding` after completion shows read-only summary
- [x] 4.6 Mobile width: all controls usable without horizontal scrolling
- [x] 4.7 Keyboard-only pass reaches and toggles every control
