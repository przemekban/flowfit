# AI-Generated Weekly Training Plan — Implementation Plan

## Overview

Implement S-02: generate a personalized weekly training plan from the user's onboarding survey profile using the Google Gemini API (`gemini-3.1-flash-lite`, structured outputs via `responseJsonSchema`), persist it transactionally, and display it on `/dashboard`. This is the first AI integration and the first client-driven async (fetch-based) UI flow in the codebase.

> **Provider pivot (2026-07-10, same day as initial implementation):** this plan was originally written and implemented against the Anthropic API per ORQ-2. That decision was reversed the same day — Anthropic's API is not free, and the project requires a $0 AI provider — in favor of the Google Gemini API free tier. All phase text below reflects the final Gemini-based implementation; see `context/changes/ai-plan-generation/change.md` for the pivot narrative and `context/foundation/tech-stack.md` for the updated ORQ-2 record.

## Current State Analysis

- `user_profiles`, `exercises` (814 seeded rows), `workouts`, `workout_exercises`, `user_plan`, `workout_sessions` all exist with per-operation RLS (`supabase/migrations/20260529000000_core_schema.sql`).
- `workouts.id` cannot be hard-deleted once a `workout_sessions` row references it (`ON DELETE RESTRICT`), so regeneration must archive (`is_archived = true`) rather than delete workouts, and must clear/rebuild `user_plan` (the only table safe to delete from).
- `src/middleware.ts` already redirects to `/onboarding` when `getUserProfile()` returns null for a protected route; `/dashboard` is gated this way today.
- `src/pages/dashboard.astro` is currently a static placeholder with no plan-awareness.
- No JSON/fetch-based API route exists yet — `src/pages/api/profile.ts` (the only precedent) does form POST → redirect. This change introduces the app's first `fetch()`-driven client flow.
- No AI SDK dependency exists yet; no AI-provider API key is declared in `astro.config.mjs`'s `env.schema`.
- Provider, model, and structured-output mechanism (ORQ-2): originally decided as Anthropic SDK direct (`claude-sonnet-5`), **reversed 2026-07-10** because Anthropic's API is not free and the project requires a $0 AI provider. Final: Google Gemini API direct via `@google/genai`, model `gemini-3.1-flash-lite`, structured output via `responseJsonSchema` (built from the Zod schema with `z.toJSONSchema()`), non-streaming (`client.models.generateContent()`).
- NFR: any operation over 2s needs continuous visible progress feedback — the AI call will exceed this.
- Cloudflare free-tier 10ms CPU ceiling is a known, unmitigated risk for compute-heavy SSR routes (`context/foundation/infrastructure.md`); this plan stays on the free tier and minimizes in-isolate work rather than requiring a paid-tier upgrade.

## Desired End State

A first-time user who completes onboarding and lands on `/dashboard` immediately sees a generation-in-progress UI, and within roughly 5-20 seconds sees their personalized weekly plan: `sessions_per_week` workouts, each with 4-8 exercises drawn only from the seeded catalog, matched to their equipment and experience level. Regeneration is not exposed in MVP — once a plan exists, `/dashboard` always shows it. If generation fails, the user sees a retry action and can attempt again without re-doing onboarding.

**Verification**: sign up → complete onboarding → land on `/dashboard` → observe staged loading messages → see the generated plan rendered with `sessions_per_week` workouts, each showing exercises with sets/reps or sets/duration as appropriate to `tracking_type`.

### Key Discoveries:

- `experience_level_enum` and `difficulty` share the same three values in the same declared order (`beginner`, `intermediate`, `advanced`), so Postgres's native enum ordering lets a plain `<=` comparison filter exercises at-or-below the user's level (`supabase/migrations/20260529000000_core_schema.sql:16-20,56-63`).
- `exercises.equipment` is a single `TEXT` value (not an array), so candidate filtering is `equipment = ANY(profile.equipment)`, i.e. `.in("equipment", profile.equipment)` in supabase-js (`supabase/migrations/20260529000000_core_schema.sql:61`).
- `WorkoutWithExercises` in `src/types.ts:118-120` already has the right shape for plan display; only a `position` field (from `user_plan`) needs to be layered on for rendering order.
- `src/lib/supabase.ts` returns `null` when config is missing rather than throwing — the Gemini client factory should follow the same pattern for consistency.
- Gemini's `responseJsonSchema` only supports a documented subset of JSON Schema keywords (`type`, `format`, `enum`, `items`, `minItems`/`maxItems`, `minimum`/`maximum`, `properties`, `additionalProperties`, `required`, etc.) — `z.toJSONSchema()`'s output must have its `$schema` key stripped before being sent, since that key isn't in the supported list.
- Gemini was empirically found to choke on a large string enum nested inside a repeated array item (small/flat enums work, large nested ones fail) — ruling out a direct `exercise_id` enum/uuid field in the generation-time schema. See the index-based workaround in Phase 3.

## What We're NOT Doing

- No "regenerate plan" action or UI — this is a one-time auto-trigger per user for MVP (PRD Non-Goals; OQ-001 defers profile/plan changes to V2).
- No profile editing.
- No streaming of the AI response to the client (SDK call is non-streaming per the ORQ-2 decision).
- No upgrade to Cloudflare Workers Standard as part of this change — defensive design stays on the free tier; a tier upgrade is a follow-up if 1101 errors surface in production.
- No workout template browsing/cloning (`workout_templates` stays unseeded, per F-01 scope).
- No skeleton-screen plan preview — loading state is staged text messages only.

## Implementation Approach

Server-authoritative generation: the API route does all AI calling, validation, and persistence; the client island only triggers the request and displays progress/error/retry state, then does a full page reload on success so the plan renders through the existing server-rendered path (consistent with the rest of the app's POST → reload pattern). All plan-shape guarantees (workout count, exercises-per-workout bounds, set/rep ranges, exercise referential integrity) are enforced server-side before any DB write, and the DB write itself is one atomic RPC call so a mid-write failure can never leave a user with a half-archived, half-new plan.

## Critical Implementation Details

**Referential integrity is a two-pass check, not a Zod concern.** The structured-output Zod schema can only validate that `exercise_id` is a well-formed UUID and that numeric fields are in range — it cannot verify the UUID actually belongs to a candidate exercise, or that `target_reps`/`target_duration_seconds` matches that exercise's `tracking_type` (this depends on data fetched from the DB, not on the schema alone). After the schema-level parse succeeds, cross-check every returned `exercise_id` against the candidate exercise map fetched earlier in the request; a miss, or a reps/duration field mismatched against the exercise's own `tracking_type`, is treated as a validation failure and routed into the same `ai_error` retry path.

**Exercise/workout position is assigned by the app, not requested from the AI.** Asking the model to also emit `position` risks gaps, duplicates, or out-of-range values that would violate the `UNIQUE(workout_id, position)` / `UNIQUE(user_id, position)` constraints. The Zod schema omits position entirely; the service derives `workout_exercises.position` from each exercise's array index within its workout, and `user_plan.position` from each workout's array index within the top-level `workouts` array.

**Exercises are requested by candidate array index, not by `exercise_id` UUID.** Gemini's structured-output schema enforcement breaks down on a large string enum/uuid field nested inside a repeated array item (verified empirically: works flat, works nested-small, fails nested-large). `buildPlanGenerationSchema` therefore asks the model for a numeric `id` in `0..candidates.length-1` instead; `generateTrainingPlan` maps each returned index back to the real `exercise_id` UUID via `candidates[id].id` before re-validating the mapped plan against the canonical `buildPlanSchema` (uuid-based) shape. The candidate list is sent to the model as compact pipe-delimited lines (`id|name|muscle_group|tracking_type`) rather than a verbose per-field description, keeping the prompt small.

**Guard against a duplicate POST on mount.** The `PlanGenerator` island fires its request from a `useEffect` with an empty dependency array; a ref-based guard (`hasFiredRef`) must prevent a second POST if the effect re-runs (e.g. fast refresh in dev, or any future re-render before the request settles). Without it, two concurrent generations could both archive-and-insert, leaving the user with only the later one's plan active but two full sets of `is_archived = true` orphan workouts from the interleaving.

## Phase 1: Environment & Dependencies

### Overview

Wire the Google Gen AI SDK and its secret through the existing `astro:env/server` + Cloudflare pattern, following exactly how `SUPABASE_URL`/`SUPABASE_KEY` are declared today.

### Changes Required:

#### 1. Add the Google Gen AI SDK dependency

**File**: `package.json`

**Intent**: Add `@google/genai` as a runtime dependency.

**Contract**: New entry under `dependencies`. Run `npm install @google/genai` rather than hand-editing the version pin.

#### 2. Declare the server secret

**File**: `astro.config.mjs`

**Intent**: Declare `GEMINI_API_KEY` the same way `SUPABASE_URL`/`SUPABASE_KEY` are declared, so it's available via `astro:env/server` and absent safely in environments (e.g. CI lint) where it isn't set.

**Contract**: Add `GEMINI_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` to `env.schema`.

#### 3. Document the new local env var

**File**: `.env.example`

**Intent**: Keep the example file in sync so local setup instructions in `README.md` remain accurate.

**Contract**: Add `GEMINI_API_KEY=###` following the existing two-line format.

#### 4. Gemini client factory

**File**: `src/lib/ai/gemini.ts` (new)

**Intent**: Central place to construct the Google Gen AI SDK client from the env-provided key, mirroring `src/lib/supabase.ts`'s `createClient()` — returns `null` when the key is absent instead of throwing, so callers decide how to degrade.

**Contract**: `export function createGeminiClient(): GoogleGenAI | null`, reading `GEMINI_API_KEY` from `astro:env/server`.

### Success Criteria:

#### Automated Verification:

- Dependency installs cleanly: `npm install`
- Type checking / Astro sync passes: `npx astro sync`
- Linting passes: `npm run lint`
- Build succeeds (with `GEMINI_API_KEY` unset, matching CI's current secret scoping): `npm run build`

#### Manual Verification:

- `GEMINI_API_KEY` added to local `.dev.vars`, and `npx wrangler secret put GEMINI_API_KEY` run for the Cloudflare production environment before this change ships
- `GEMINI_API_KEY` added as a GitHub Actions secret if the build step is later changed to require it (not required by this phase's `npm run build`, since the key stays optional)

---

## Phase 2: Database — Transactional Save RPC

### Overview

Add a single Postgres function that atomically archives the user's current active workouts, clears their rotation, and inserts the newly generated plan — so the API route never performs multi-step inserts against PostgREST directly.

### Changes Required:

#### 1. `save_generated_training_plan` migration

**File**: `supabase/migrations/20260710120000_save_generated_training_plan_rpc.sql` (new)

**Intent**: One transactional entry point for persisting a generated plan: archive old workouts, delete old rotation entries, insert new workouts/workout_exercises/user_plan rows in order — all in one statement so a mid-write failure can't leave a partially-replaced plan.

**Contract**: `SECURITY INVOKER` function (runs as the calling user's role, so existing RLS policies on `workouts`/`workout_exercises`/`user_plan` continue to gate every write — no privilege escalation needed). Takes `p_user_id uuid` and `p_workouts jsonb` (shape: `{"workouts": [{"name": ..., "description": ..., "exercises": [{"exercise_id": ..., "target_sets": ..., "target_reps": ..., "target_duration_seconds": ...}]}]}`). Explicitly guards `p_user_id = auth.uid()` for a clear error rather than relying solely on the RLS failure message. Loops over the jsonb array with `jsonb_array_elements`, using array index to assign `workout_exercises.position` and `user_plan.position`. Grants `EXECUTE` to `authenticated` only, revoked from `PUBLIC`:

```sql
CREATE OR REPLACE FUNCTION save_generated_training_plan(p_user_id uuid, p_workouts jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_workout   jsonb;
  v_exercise  jsonb;
  v_workout_id uuid;
  v_position  smallint := 0;
  v_ex_position smallint;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  UPDATE workouts SET is_archived = true, updated_at = now()
    WHERE user_id = p_user_id AND is_archived = false;

  DELETE FROM user_plan WHERE user_id = p_user_id;

  FOR v_workout IN SELECT * FROM jsonb_array_elements(p_workouts->'workouts')
  LOOP
    v_position := v_position + 1;

    INSERT INTO workouts (user_id, name, description, source)
      VALUES (p_user_id, v_workout->>'name', v_workout->>'description', 'ai')
      RETURNING id INTO v_workout_id;

    v_ex_position := 0;
    FOR v_exercise IN SELECT * FROM jsonb_array_elements(v_workout->'exercises')
    LOOP
      v_ex_position := v_ex_position + 1;
      INSERT INTO workout_exercises (workout_id, exercise_id, position, target_sets, target_reps, target_duration_seconds)
        VALUES (
          v_workout_id,
          (v_exercise->>'exercise_id')::uuid,
          v_ex_position,
          (v_exercise->>'target_sets')::smallint,
          (v_exercise->>'target_reps')::smallint,
          (v_exercise->>'target_duration_seconds')::smallint
        );
    END LOOP;

    INSERT INTO user_plan (user_id, workout_id, position)
      VALUES (p_user_id, v_workout_id, v_position);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION save_generated_training_plan(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_generated_training_plan(uuid, jsonb) TO authenticated;
```

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a fresh local stack: `npx supabase db reset`
- Linting passes (SQL files aren't linted by `npm run lint`, but the repo build must still pass): `npm run build`

#### Manual Verification:

- In Supabase Studio (`http://localhost:54323`), manually call `select save_generated_training_plan('<test-user-uuid>', '{"workouts":[...]}'::jsonb)` as an authenticated test user and confirm: old workouts flip to `is_archived = true`, old `user_plan` rows are gone, new `workouts`/`workout_exercises`/`user_plan` rows exist with correct `position` ordering
- Confirm a second call (simulating regeneration) does not violate any unique constraint and correctly re-archives the first call's output

---

## Phase 3: Plan Generation Service

### Overview

The core business logic: fetch candidate exercises, build the prompt and the per-request Zod schemas, call Gemini, and validate the result before it's ever handed to the DB layer.

### Changes Required:

#### 1. Candidate exercise query

**File**: `src/lib/services/plan.ts` (new)

**Intent**: Fetch only exercises the user can actually perform, keeping the prompt small and guaranteeing every candidate is usable.

**Contract**: `getCandidateExercises(supabase, profile: UserProfile): Promise<Pick<Exercise, "id"|"name"|"muscle_group"|"equipment"|"difficulty"|"tracking_type">[]>` — filters `equipment` by `profile.equipment` (`.in`) and `difficulty` by `profile.experience_level` (`.lte`, relying on the enums' shared declared ordering).

#### 2. Plan output schema with guardrails

**File**: `src/lib/validation/plan.ts` (new)

**Intent**: Build the structured-output schema dynamically per request so `workouts.length` exactly matches the user's `sessions_per_week`, and bound exercise count / sets / reps / duration to keep AI output actionable regardless of what the model decides.

**Contract**: Two schema builders sharing the same workout/exercise shape (`name`, optional `description`, `exercises: z.array(exerciseSchema).min(4).max(8)`; each exercise has `target_sets` (2-5) and optional `target_reps` (5-20) / `target_duration_seconds` (15-180) — no `position` field, see Critical Implementation Details):
- `buildPlanSchema(sessionsPerWeek: number)`: the canonical shape, `exercise_id` as a `uuid`. `workouts` is `z.array(workoutSchema).length(sessionsPerWeek)`. Used to validate the final, index-mapped plan before persistence. Export `PlanOutput = z.infer<...>` for use by the service and API route.
- `buildPlanGenerationSchema(sessionsPerWeek: number, candidateCount: number)`: the shape actually requested from Gemini — identical, except each exercise carries a numeric `id` (`0..candidateCount-1`) indexing into the candidate array instead of an `exercise_id` UUID (see Critical Implementation Details for why). Export `PlanGenerationOutput = z.infer<...>`.

#### 3. Prompt construction and Gemini call

**File**: `src/lib/services/plan.ts`

**Intent**: Build a system/user prompt that gives Gemini the user's profile and the filtered candidate list as compact pipe-delimited lines (`id|name|muscle_group|tracking_type`, `id` being the candidate's array index), instructs it to reference exercises only by that numeric `id`, respect `preferred_style` (e.g. `full_body` may reasonably repeat compound lifts across sessions; `push_pull_legs`/`upper_lower` should specialize each workout by muscle group), and avoid excessive repetition otherwise. Call the SDK's structured-output path, then map the index-based result back to real `exercise_id`s and re-validate against the canonical schema.

**Contract**: `generateTrainingPlan(client: GoogleGenAI, profile: UserProfile, candidates: CandidateExercise[]): Promise<PlanOutput>`, requesting the index-based `buildPlanGenerationSchema` shape via `responseJsonSchema` (built from the Zod schema with `z.toJSONSchema()`, with the unsupported `$schema` key stripped):

```ts
if (candidates.length < MIN_EXERCISES_PER_WORKOUT) {
  throw new PlanValidationError(`Not enough exercises match your equipment and experience level...`);
}

const generationSchema = buildPlanGenerationSchema(profile.sessions_per_week, candidates.length);
const jsonSchema: Record<string, unknown> = z.toJSONSchema(generationSchema);
delete jsonSchema.$schema;

const response = await client.models.generateContent({
  model: "gemini-3.1-flash-lite",
  contents: buildUserPrompt(profile, candidates),
  config: {
    systemInstruction: buildSystemPrompt(),
    responseMimeType: "application/json",
    responseJsonSchema: jsonSchema,
  },
});

const generationResult = generationSchema.safeParse(JSON.parse(response.text!));
// map each candidate-array index back to its real exercise_id UUID
const plan: PlanOutput = {
  workouts: generationResult.data.workouts.map((workout) => ({
    ...workout,
    exercises: workout.exercises.map(({ id, ...rest }) => ({
      ...rest,
      exercise_id: candidates[id].id,
    })),
  })),
};
return buildPlanSchema(profile.sessions_per_week).parse(plan);
```

#### 4. Referential integrity + tracking-type validation + duplicate guard

**File**: `src/lib/services/plan.ts`

**Intent**: Enforce the two-pass check described in Critical Implementation Details — every `exercise_id` must be in the candidate set, its reps/duration field must match that exercise's `tracking_type`, and it must not repeat within the same workout. Also guard the candidate pool size before ever calling Gemini, so a too-narrow equipment/experience combination fails with a clear, actionable message instead of wasting an AI call.

**Contract**:
- `generateTrainingPlan(...)` guards `candidates.length < MIN_EXERCISES_PER_WORKOUT` (4) up front and throws `PlanValidationError` with a user-facing message ("Not enough exercises match your equipment and experience level... Try selecting more equipment types during onboarding.") before building the prompt or calling the model.
- `validatePlanAgainstCandidates(plan: PlanOutput, candidates: CandidateExercise[]): PlanOutput` (returns the plan unchanged on success) or throws a typed `PlanValidationError` the API route maps to the `ai_error` response — now also rejects a workout containing the same `exercise_id` more than once.

**Discovered defect (manual test 3.4, fixed same day):** with a very narrow candidate pool (e.g. only 1 matching exercise for an equipment/experience combination), Gemini's `min(4)` array-length constraint on `exercises` was schema-satisfiable by repeating the same candidate index 4+ times — this passed both schema validation and the original (repeat-blind) referential-integrity check, producing a nonsensical plan with the same exercise listed several times instead of failing cleanly. Fixed by (a) the candidate-pool preflight guard above, which now catches this before any AI call for pools smaller than the per-workout minimum, and (b) the duplicate-`exercise_id`-per-workout check, which also guards larger-but-still-tight pools (e.g. exactly 4-7 candidates) where repetition could otherwise still slip through.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync` then `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Manually invoke the service against a real local Supabase instance + real Gemini API key for 2-3 different profiles (varying `equipment`, `experience_level`, `sessions_per_week`, `preferred_style`) and confirm: workout count matches `sessions_per_week`, every exercise is within the candidate set, reps/duration fields match each exercise's `tracking_type`
- Confirm a deliberately malformed candidate set (e.g. empty candidates for an unrealistic equipment combination) fails validation with a clear error rather than crashing

---

## Phase 4: API Route

### Overview

Wire the service and RPC together behind `POST /api/plan`, with typed error responses so the client can distinguish "retry-worthy" failures from unexpected ones in server logs (even though the user sees one generic retry message either way, per the error-handling decision).

### Changes Required:

#### 1. `POST /api/plan`

**File**: `src/pages/api/plan.ts` (new)

**Intent**: Auth-guard, fetch the caller's profile, generate and validate the plan, persist it via the RPC, and respond with a minimal success/error JSON body (no plan data in the response — the client reloads the page to render the server-side view).

**Contract**: `export const prerender = false; export const POST: APIRoute`. Returns `401` if unauthenticated, `409`-style `{ error: "profile_missing" }` if no `user_profiles` row exists (shouldn't normally be reachable since middleware already gates `/dashboard` on profile presence, but the route must not assume it), `502 { error: "ai_error", message }` for Gemini call failures or validation failures from Phase 3 step 4 (logged server-side with `console.error` including the user id and underlying cause), `500 { error: "db_error", message }` for RPC failures, `200 { success: true }` on success.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `curl -X POST http://localhost:4321/api/plan` while signed in with a completed profile returns `200 { success: true }`, and `user_plan`/`workouts`/`workout_exercises` are populated correctly in Studio
- Temporarily using an invalid `GEMINI_API_KEY` produces a `502 ai_error` response and a clear server log line, not an unhandled exception / Cloudflare 1101
- Calling the route while signed out returns `401`

---

## Phase 5: Dashboard Integration & UI

### Overview

Branch the dashboard on plan presence, add the generation-in-progress island with staged progress messages and retry, and render the plan once it exists.

### Changes Required:

#### 1. Active plan query

**File**: `src/lib/services/plan.ts`

**Intent**: Fetch the user's current rotation, ordered, with exercises nested — reusing the existing `WorkoutWithExercises` DTO shape plus rotation position.

**Contract**: `getActivePlan(supabase, userId): Promise<ActivePlanWorkout[]>` where `ActivePlanWorkout = WorkoutWithExercises & { position: number }`, querying `user_plan` joined to `workouts` (`is_archived = false`) and `workout_exercises` → `exercises`, ordered by `position`.

#### 2. New DTO type

**File**: `src/types.ts`

**Intent**: Add the `ActivePlanWorkout` type used by `getActivePlan` and `PlanDisplay`.

**Contract**: `export type ActivePlanWorkout = WorkoutWithExercises & { position: number };`

#### 3. Dashboard branching

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the static placeholder with plan-aware rendering — call `getActivePlan`; if empty, render the generator island; otherwise render the plan.

**Contract**: Server-side `if (activePlan.length === 0) { render PlanGenerator island } else { render PlanDisplay }`, keeping the existing `Layout`/sign-out affordance.

#### 4. `PlanGenerator` island

**File**: `src/components/plan/PlanGenerator.tsx` (new)

**Intent**: On mount, fire the generation request exactly once (ref-guarded per Critical Implementation Details), cycle staged progress messages while waiting, and on success reload the page so the server-rendered `PlanDisplay` path takes over; on failure, show a retry action.

**Contract**: `client:load` React island. `useEffect` (empty deps) + `hasFiredRef` guard calls `fetch("/api/plan", { method: "POST" })`; a `setInterval`-driven message cycle (e.g. "Analyzing your profile…" → "Selecting exercises…" → "Finalizing your plan…") runs independently of the fetch and is cleared on settle; on non-2xx response, stop the message cycle and show the error state with a button that resets `hasFiredRef` and re-fires; on 2xx, `window.location.reload()`.

#### 5. `PlanDisplay` component

**File**: `src/components/plan/PlanDisplay.astro` (new)

**Intent**: Server-rendered display of the active plan — no client interactivity needed, so this is an Astro component per the repo's "Astro for static content" convention.

**Contract**: Props: `workouts: ActivePlanWorkout[]`. Renders each workout labeled by rotation position ("Workout 1", "Workout 2", …) with its AI-generated `name`/`description` as secondary text, followed by its exercises in `position` order showing `target_sets` plus `target_reps` or `target_duration_seconds` depending on which is present.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Fresh signup → onboarding → `/dashboard` shows the staged progress messages, then the generated plan, with no manual refresh needed
- Reloading `/dashboard` after a plan exists renders `PlanDisplay` directly with no generator flash
- Killing the network mid-generation (or using an invalid API key) surfaces the retry button; clicking it successfully retries without requiring a full page reload first
- Rapid re-render of the `PlanGenerator` island (e.g. React fast refresh in dev) does not fire a second concurrent `POST /api/plan`
- Visual check in Chrome and Safari per the NFR's supported-browser requirement

---

## Testing Strategy

### Unit Tests:

No automated test suite is configured in this repo (per `AGENTS.md`); correctness here relies on Zod schema validation (Phase 3), the two-pass referential/tracking-type check (Phase 3 step 4), and the manual verification steps in each phase.

### Integration Tests:

None configured — manual verification via `curl` (Phase 4) and full end-to-end browser flow (Phase 5) substitute for integration coverage.

### Manual Testing Steps:

1. Complete onboarding with a profile using a restrictive equipment set (e.g. only `bodyweight`) and confirm candidate filtering still returns enough exercises to build a valid plan.
2. Complete onboarding with `sessions_per_week = 7` and confirm the schema's `.length(7)` constraint is satisfiable and the RPC inserts exactly 7 workouts.
3. Confirm a `duration`-tracked exercise (e.g. plank) never receives a `target_reps` value and a `reps`-tracked exercise never receives `target_duration_seconds`.
4. Confirm signing in as a second, separate test user does not see the first user's plan (RLS spot-check).

## Performance Considerations

Per the CPU-risk decision: keep in-isolate work in `/api/plan` limited to Zod validation of the (small, schema-bounded) AI response and simple property mapping — the multi-row DB write happens inside the Postgres RPC, not as sequential Worker-side inserts, keeping the CPU-heavy portion of the request in the database rather than the Cloudflare isolate. If Cloudflare 1101 errors are observed in production, the documented mitigation (`infrastructure.md`) is to upgrade to Workers Standard ($5/mo) — out of scope for this change.

## Migration Notes

No existing production data is affected — this is a new RPC and new API surface with no changes to existing tables' shapes. The RPC is additive (new function only); no down-migration is needed beyond `DROP FUNCTION save_generated_training_plan(uuid, jsonb)` if rollback is required.

## References

- Related research: `context/changes/ai-plan-generation/research.md`
- Provider/model decision: `context/foundation/tech-stack.md` (ORQ-2)
- Archival vs. deletion constraint: `context/changes/ai-plan-generation/research.md` (Follow-up Research section)
- Existing form → redirect precedent: `src/pages/api/profile.ts:44-56`
- Existing "return-null-on-missing-config" client pattern: `src/lib/supabase.ts:5-8`
- Cloudflare CPU risk register: `context/foundation/infrastructure.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Environment & Dependencies

#### Automated

- [x] 1.1 Dependency installs cleanly: `npm install` — abc975b
- [x] 1.2 Type checking / Astro sync passes: `npx astro sync` — abc975b
- [x] 1.3 Linting passes: `npm run lint` (pre-existing `astro-eslint-parser` crash on `src/pages/onboarding.astro`, confirmed present on `main` before this change; unrelated to Phase 1 files) — abc975b
- [x] 1.4 Build succeeds: `npm run build` — abc975b

#### Manual

- [ ] 1.5 `GEMINI_API_KEY` added to local `.dev.vars` and Cloudflare production secret via `wrangler secret put` (local `.dev.vars` confirmed done; production `wrangler secret put` still pending before this ships)
- [ ] 1.6 `GEMINI_API_KEY` added as a GitHub Actions secret if a future build step requires it

### Phase 2: Database — Transactional Save RPC

#### Automated

- [x] 2.1 Migration applies cleanly: `npx supabase db reset` — 81a20a4
- [x] 2.2 Build succeeds: `npm run build` — 81a20a4

#### Manual

- [x] 2.3 Manual RPC call in Studio confirms archive/clear/insert behavior and correct `position` ordering (verified indirectly via app flow + Table Editor inspection, not raw SQL invocation — `SECURITY INVOKER` + `auth.uid()` guard makes a direct Studio SQL Editor call fail auth as expected, since that runs as the `postgres` superuser) — 81a20a4
- [x] 2.4 Second manual RPC call confirms clean re-archival with no constraint violations (same verification method as 2.3) — 81a20a4

### Phase 3: Plan Generation Service

#### Automated

- [x] 3.1 Type checking passes: `npx astro sync` then `npm run build` — 64bbba9
- [x] 3.2 Linting passes: `npm run lint` (targeted `npx eslint` on new files clean; repo-wide run hits the pre-existing `onboarding.astro` crash noted in Phase 1) — 64bbba9

#### Manual

- [x] 3.3 Manual invocation against 2-3 varied profiles confirms workout count, candidate membership, and tracking-type consistency — 64bbba9
- [x] 3.4 Deliberately empty/unrealistic candidate set fails validation cleanly — **initial test failed** (`resistance_band`-only equipment, 1 matching candidate, produced a plan repeating the same exercise instead of a clean error); root-caused and fixed same day (candidate-pool preflight guard + duplicate-`exercise_id`-per-workout check, see Phase 3 step 4 and Critical Implementation Details); re-verified and confirmed acceptable — user notes the failure is currently a dead-end retry (no profile editing in MVP), tracked as a follow-up in `context/foundation/roadmap.md` — 64bbba9

### Phase 4: API Route

#### Automated

- [x] 4.1 Type checking passes: `npx astro sync` — 8544375
- [x] 4.2 Linting passes: `npm run lint` (targeted `npx eslint` on new files clean, only `no-console` warnings matching the existing `api/profile.ts` pattern; repo-wide run hits the pre-existing `onboarding.astro` crash noted in Phase 1) — 8544375
- [x] 4.3 Build succeeds: `npm run build` — 8544375

#### Manual

- [x] 4.4 `curl -X POST /api/plan` while authenticated returns `200` and persists correctly (verified via browser Network tab against the live dashboard flow rather than raw `curl`, since the route is cookie-session-authenticated) — 8544375
- [x] 4.5 Invalid API key produces `502 ai_error` with a clear server log, not a crash — 8544375
- [x] 4.6 Unauthenticated request returns `401` — 8544375

### Phase 5: Dashboard Integration & UI

#### Automated

- [x] 5.1 Type checking passes: `npx astro sync` — 9a16ca6
- [x] 5.2 Linting passes: `npm run lint` (targeted `npx eslint` on new/changed files clean; repo-wide run hits the pre-existing `onboarding.astro` crash noted in Phase 1) — 9a16ca6
- [x] 5.3 Build succeeds: `npm run build` — 9a16ca6

#### Manual

- [x] 5.4 Fresh signup → onboarding → dashboard shows staged progress then the generated plan — 9a16ca6
- [x] 5.5 Reload after plan exists renders `PlanDisplay` directly with no generator flash — 9a16ca6
- [x] 5.6 Network/API-key failure surfaces retry; retry succeeds without a full page reload first — 9a16ca6
- [x] 5.7 No duplicate `POST /api/plan` fires on rapid re-render — 9a16ca6
- [x] 5.8 Visual check in Chrome and Safari — 9a16ca6
