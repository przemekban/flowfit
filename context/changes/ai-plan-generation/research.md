---
date: 2026-07-10T18:58:00+02:00
researcher: Antigravity
git_commit: e443c42528ab9607fcc890a1ef46050f10f7ef54
branch: main
repository: przemekban/flowfit
topic: "AI-generated weekly training plan and plan display screen"
tags: [research, codebase, plan-generation, gemini-sdk, supabase, rls]
status: complete
last_updated: 2026-07-10
last_updated_by: Claude
last_updated_note: "Documented ORQ-2 provider pivot (Anthropic → Gemini) and the index-based candidate-mapping workaround for Gemini's structured-output limitation"
---

# Research: AI-generated weekly training plan and plan display screen

**Date**: 2026-07-10T18:58:00+02:00
**Researcher**: Antigravity
**Git Commit**: e443c42528ab9607fcc890a1ef46050f10f7ef54
**Branch**: main
**Repository**: przemekban/flowfit

## Research Question

Używając skilla /10x-research ai-plan-generation z .claude/skills dokonaj researche pod kątem tego zadania: AI-generated weekly training plan and plan display screen.

---

## Summary

This research outlines the architectural structure and technical integration plan for generating personalized weekly training plans using the Anthropic API (Claude 3.5 Sonnet) and rendering them on the dashboard. The core solution involves:
1. **User Input & Profiling**: Fetching the user's profile from `user_profiles` and matching it against the seeded `exercises` catalog.
2. **Anthropic SDK structured outputs**: Using `claude-sonnet-5` model constrained by a Zod schema passed to the Anthropic API via `output_config.format` to enforce a clean JSON shape matching the DB entities.
3. **Transactional Database Operations**: Overcoming the cascade restriction on `workout_sessions` (which prevents deleting old workouts) by executing a transactional PostgreSQL RPC migration that soft-archives previous workouts and inserts new ones.
4. **Cloudflare Execution Safeguards**: Avoiding local development/production CPU timeouts on Cloudflare Workers by opting for non-streaming requests and offloading multi-step inserts to a DB transaction.
5. **Dashboard-first UX**: Implementing an automatic loader page directly on `/dashboard` that fetches plan generation and updates the view upon completion.

---

## Detailed Findings

### Database Schema & RLS Constraints

The project relies on PostgreSQL tables with Row-Level Security (RLS) configured in [20260529000000_core_schema.sql](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000000_core_schema.sql).

*   **Exercises catalog**: The `exercises` table ([20260529000000_core_schema.sql#L56-L63](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000000_core_schema.sql#L56-L63)) contains 814 seeded exercises. The catalog has additional detail columns for Polish names and tips from [20260529000001_exercise_detail_fields.sql](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000001_exercise_detail_fields.sql) and the `tracking_type` enum (`reps` or `duration`) from [20260529000002_tracking_type.sql](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000002_tracking_type.sql). It is read-only for users (`SELECT` allowed only for authenticated users).
*   **User Workouts & Exercises**: Workouts are stored in `workouts` ([20260529000000_core_schema.sql#L99-L110](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000000_core_schema.sql#L99-L110)) and exercises are mapped via `workout_exercises` ([20260529000000_core_schema.sql#L112-L120](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000000_core_schema.sql#L112-L120)). Row-level security restricts access exclusively to the owner (`auth.uid() = user_id`).
*   **Rotation Plan**: The `user_plan` table ([20260529000000_core_schema.sql#L122-L131](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000000_core_schema.sql#L122-L131)) stores the rotation sequence position of active workouts for each user.
*   **Referential Restrictions on Archival**: Old workouts cannot be deleted if the user has already logged a session referencing them (due to `RESTRICT` constraint on `workout_sessions.workout_id` in [20260529000000_core_schema.sql#L140](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000000_core_schema.sql#L140)). Thus, when a plan is regenerated, the application must:
    1. Clear current rotation entries in `user_plan`.
    2. Set `is_archived = true` on the old workouts.
    3. Insert the new workouts and set up a new rotation.

### Anthropic API Structured Outputs

The integration needs to consume the official `@anthropic-ai/sdk` and call the `claude-sonnet-5` model.
*   **Structured Format via SDK**: To guarantee valid JSON matching the schema, we must configure `output_config.format` with `type: "json_schema"`. In the TypeScript SDK, we can use `zodOutputFormat(schema)` from `@anthropic-ai/sdk/helpers/zod` to infer and enforce the response shape.
*   **Zod Target Schema**: The Zod schema must demand:
    *   Workouts array (`name`, `description`).
    *   Exercises array for each workout containing `exercise_id` (a UUID from the database), `position`, `target_sets`, and optional `target_reps` / `target_duration_seconds` matching the exercise `tracking_type`.
*   **Referential Integrity Guard**: To ensure the AI selects valid exercises, we must query the `exercises` table first, filtering by the user's available equipment (e.g., bodyweight, dumbbells), and feed this list of IDs and names directly to Claude in the prompt. This ensures 100% database key alignment and avoids fuzzy matching.

### Cloudflare Environment & Timeouts

The project deploys to Cloudflare Pages (using Astro SSR with `@astrojs/cloudflare` and `workerd`).
*   **Execution Time Limits**: The Cloudflare Workers Free Tier limits CPU execution time to 10ms per request. Parsing a complex JSON structure, validating it via Zod, and running Astro SSR could hit this ceiling, resulting in a silent 1101 Workers exception. The Standard tier ($5/mo) relaxes CPU limits to 30 seconds.
*   **I/O and Wall-Clock Time**: Cloudflare does not impose a tight wall-clock timeout on pending fetch calls (unlike Netlify's 10s free limit), meaning Workers can safely await Anthropic's completion.
*   **Node.js Stream Issues**: As highlighted in infrastructure notes, the Anthropic SDK's streaming handler uses Node.js `Readable` streams, which historically caused intermittent crashes under the `nodejs_compat` polyfill in concurrent environments.
    *   *Decision*: Use non-streaming requests (`client.messages.parse()`) for robustness.
*   **Secrets Configuration**: The API key must be declared in [astro.config.mjs](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/astro.config.mjs) under `env.schema` as `ANTHROPIC_API_KEY`, mapped to `.dev.vars` locally, and deployed as a secret in Cloudflare.

---

## Code References

- [supabase/migrations/20260529000000_core_schema.sql#L56-L131](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000000_core_schema.sql#L56-L131) - Defines core exercises, workouts, and user plan rotation tables.
- [supabase/migrations/20260529000002_tracking_type.sql#L11-L20](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/supabase/migrations/20260529000002_tracking_type.sql#L11-L20) - Introduces `tracking_type` enum and `target_duration_seconds` columns.
- [src/types.ts#L30-L93](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/src/types.ts#L30-L93) - Declares entity interfaces matching the database tables.
- [astro.config.mjs#L17-L23](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/astro.config.mjs#L17-L23) - Configuration for server environment variables and Cloudflare SSR adapter.
- [src/middleware.ts#L26-L35](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/src/middleware.ts#L26-L35) - Gating system enforcing profile completion for `/dashboard`.

---

## Architecture Insights

*   **Transactional SQL RPC vs. PostgREST Calls**: Executing multiple sequential inserts from the Cloudflare Worker to Supabase (e.g. creating workouts, fetching new IDs, inserting exercises, creating plans) introduces excessive latency and risks leaving orphaned workouts if a network call fails. Offloading the database insertion block to a custom database transaction (PostgreSQL RPC function `save_generated_training_plan`) is the recommended solution. It guarantees atomicity and keeps execution speed high.
*   **Automatic Dashboard Initialization**: Upon completing the onboarding survey, the user is redirected to `/dashboard`. If `user_plan` rotation is empty, the server renders a React island loading component (`PlanGenerator`). This component immediately fires a POST fetch to `/api/plan`. Once the plan is saved, the page is reloaded, cleanly displaying the new plan.

---

## Historical Context (from prior changes)

- **Onboarding Survey Plan** [context/archive/2026-07-08-onboarding-survey/plan.md](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/context/archive/2026-07-08-onboarding-survey/plan.md) - Documented the onboarding survey structure and validation constraints, emphasizing that equipment types and sessions per week must be strictly parsed to avoid DB layer constraint violations.

---

## Related Research

- [context/archive/2026-07-08-onboarding-survey/plan-brief.md](https://github.com/przemekban/flowfit/blob/e443c42528ab9607fcc890a1ef46050f10f7ef54/context/archive/2026-07-08-onboarding-survey/plan-brief.md) - Contains structural decisions about UI components.

---

## Open Questions

- **UI Customizations**: How should the plan presentation group workouts (e.g., Day 1, Day 2 or Workout A, Workout B)? 
    *   *Recommendation*: Represent them as sequential rotation steps (e.g., "Trening 1", "Trening 2") since workouts are executed as an ordered rotation and not linked to specific calendar days.
- **Handling Generation Errors**: What if the Anthropic API call fails?
    *   *Recommendation*: The `PlanGenerator` component will display a clear error message with a "Try again" button, allowing users to re-trigger the POST request to `/api/plan` without losing their survey responses.

---

## Follow-up Research [2026-07-10T19:05:00+02:00]

### Clarification on Workout Archival vs. Deletion

During follow-up, the user raised a concern about whether old workouts should be deleted at all. Indeed, for fitness tracking, historical logs must be preserved. We confirmed that the workouts themselves are **never hard-deleted**. 

- ** workouts Table (`workouts`)**: The old workouts will have `is_archived` updated to `true`. They remain in the database so that past sessions in `workout_sessions` (which reference `workout_id`) remain valid and can be queried in the history tab.
- ** rotation Table (`user_plan`)**: The only table that undergoes deletions is `user_plan`, which serves as a junction table pointing to the user's currently *active* workout rotation. Deleting rotation entries here does not delete the workouts themselves, only their ordering in the active list.

---

## Follow-up Research [2026-07-10, same day]

### Provider pivot: Anthropic → Google Gemini (ORQ-2 reopened)

During implementation, the user discovered the Anthropic API is not free and required a $0 AI provider. Evaluated four free options: Google Gemini (free tier), OpenRouter free models, Groq free tier, and Cloudflare Workers AI. Chose **Google Gemini** for its genuinely free tier (not just trial credits), generous rate limits, and strong `responseJsonSchema` structured-output enforcement. See `context/foundation/tech-stack.md` (ORQ-2 revision history) for the full comparison and rationale.

Implementation swap: `@anthropic-ai/sdk` → `@google/genai`; `client.messages.parse()` + `zodOutputFormat` → `client.models.generateContent()` with `config.responseJsonSchema` built from the Zod schema via `z.toJSONSchema()` (Zod 4's built-in JSON Schema export — no extra dependency needed). `ANTHROPIC_API_KEY` renamed to `GEMINI_API_KEY` throughout (`astro.config.mjs`, `.env.example`, `.dev.vars`).

### Gemini structured-output limitation: large enum/uuid nested in a repeated array item

Empirically verified during manual testing: Gemini's `responseJsonSchema` enforcement breaks down when a large string enum (or a uuid-typed field meant to be constrained to a large candidate set) is nested inside a repeated array item — small/flat cases work, large nested cases fail. This ruled out asking the model for `exercise_id` (uuid) directly per exercise, which the original (Anthropic-based) schema did.

**Workaround**: the candidate exercise list is sent to the model as compact pipe-delimited lines (`id|name|muscle_group|tracking_type`, where `id` is the candidate's array index, not a UUID). The generation-time Zod schema (`buildPlanGenerationSchema`) asks for a small-range numeric `id` (`0..candidates.length-1`) instead of a uuid. After parsing, the service maps each returned index back to the real `exercise_id` UUID via `candidates[id].id`, then re-validates the mapped plan against the original uuid-based schema (`buildPlanSchema`) before it's handed to the persistence RPC — so the two-pass referential-integrity check (candidate-set membership + tracking-type match) still runs against real UUIDs, unchanged.

Model settled on `gemini-3.1-flash-lite` after testing (fastest/most budget-friendly of the current Gemini Flash family, sufficient instruction-following for this schema-bound generation task).

### Manual-test defect: narrow candidate pool produces a repeated-exercise plan instead of a clean failure

During manual verification of "3.4 — deliberately empty/unrealistic candidate set fails validation cleanly", a profile with `equipment: [resistance_band]` only (which matches exactly 1 exercise in the seeded catalog — verified via `select equipment, difficulty, count(*) from exercises group by 1,2`) did **not** fail. Instead, the generated plan repeated that single exercise 4+ times per workout to satisfy the schema's `exercises.min(4)` array-length constraint — schema-valid (the index-range and array-length constraints were technically satisfied) and passed the original referential-integrity check (every index did resolve to a real candidate), but semantically nonsensical.

**Root cause**: `min(MIN_EXERCISES_PER_WORKOUT)` on the `exercises` array bounds *count*, not *distinctness*. With a candidate pool smaller than (or barely at) that minimum, Gemini has no way to satisfy the count constraint other than repeating candidates — and nothing in the original validation forbade repeats within a workout.

**Fix** (`src/lib/services/plan.ts`):
1. `generateTrainingPlan` now guards `candidates.length < MIN_EXERCISES_PER_WORKOUT` up front and throws a `PlanValidationError` with a user-facing, actionable message — before the model is ever called, so a hopeless combination doesn't burn a free-tier API call.
2. `validatePlanAgainstCandidates` now also rejects a workout containing the same `exercise_id` more than once, catching the same failure mode for candidate pools that clear the size-4 floor but are still tight enough (4-7 candidates) that repetition could otherwise slip through.

`MIN_EXERCISES_PER_WORKOUT`/`MAX_EXERCISES_PER_WORKOUT` were extracted as exported constants in `src/lib/validation/plan.ts` so the service's preflight check and the schema bound can't drift apart.
