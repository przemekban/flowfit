# Core Database Schema — Plan Brief

> Full plan: `context/changes/core-db-schema/plan.md`

## What & Why

Establish the complete Supabase database foundation for FlowFit: 9 tables, 6 ENUMs, per-operation RLS policies, performance indexes, an exercise library seed, and hand-written TypeScript types. Every downstream slice (S-01 through S-05) is blocked until this migration applies cleanly — getting the schema right here eliminates expensive rework across all future phases.

## Starting Point

No migrations exist today (`supabase/migrations/` is absent). The Supabase client is configured and auth works, but the entire application data layer is missing. `src/types.ts` does not exist.

## Desired End State

`npx supabase db reset` applies three migrations cleanly, seeds 820+ exercises (scraped from SmartWorkout in Polish) and 8 workout templates, and leaves all 9 tables with RLS active. `npm run lint` and `astro sync` pass with `src/types.ts` in place. A developer can open Supabase Studio and confirm that an authenticated user can read exercises but cannot access another user's workouts.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Plan storage (exercise list in workout) | Separate join table `workout_exercises` | FK integrity and clean per-exercise querying for S-05 personal records |
| Survey answers format | Typed columns + Postgres ENUMs | Type-safe, directly usable as AI prompt inputs without JSON parsing |
| Equipment (survey) | `TEXT[]` multi-select | Users realistically have multiple equipment types |
| Workout session state | `status ENUM` + `completed_at` | `completed_at` is the history index key; status distinguishes abandoned from active |
| TypeScript types | Hand-written in `src/types.ts` | Zero tooling overhead; single import point for all downstream slices |
| Workout rotation (plan) | Position-based `user_plan` table | Ordered rotation without calendar binding; "next suggested" = next position after last completed session |
| `workout_sessions.workout_id` | NOT NULL | Every logged session must reference a source workout for history display |
| Workout metadata | `name NOT NULL` + `description` nullable | AI generates the name; description is optional context |
| System templates | `workout_templates` table created and seeded with 8 templates | Full matrix of goal × style × level; AI fallback still works when no template matches |

## Scope

**In scope:**
- 7 custom ENUMs (including `tracking_type_enum` added in migration 3)
- 9 tables: `user_profiles`, `exercises`, `workout_templates`, `workout_template_exercises`, `workouts`, `workout_exercises`, `user_plan`, `workout_sessions`, `workout_sets`
- Per-operation RLS policies on all tables
- 6 performance indexes (including the load-bearing `workout_sessions(user_id, completed_at)`)
- Exercise seed data (820+ exercises scraped from SmartWorkout in Polish, covering all 24 muscle_group × difficulty cells)
- 8 workout template seeds covering the full goal × style × experience_level matrix
- `src/types.ts` with entity interfaces and DTO types

**Out of scope:**
- API routes and UI components (downstream slices)
- Supabase generic type wiring in `src/lib/supabase.ts` (deferred to S-01)
- `updated_at` triggers (application code sets this explicitly)

## Architecture / Approach

Single migration file in dependency order: ENUMs → system tables → user tables → child tables → indexes → RLS. Seed in a separate `supabase/seed.sql` (already declared in config). TypeScript types are pure definitions — no imports, no Supabase SDK dependency.

The data model separates **plan** (what the user intends to do) from **log** (what they actually did): `workouts` + `workout_exercises` define the plan; `workout_sessions` + `workout_sets` log the execution. `user_plan` holds the ordered rotation. `workout_sessions.workout_id NOT NULL` ensures history is always traceable to a source workout.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database Migration | 9 tables + 6 ENUMs + indexes + RLS all applied | Wrong FK structure or RLS gap cascades into every downstream slice |
| 2. Exercise Detail Fields | 6 nullable detail columns added to `exercises` (Polish content) | Column type mismatch with seed data in Phase 3 |
| 3. Exercise Seed Data | 820+ exercises + `tracking_type_enum` migration + 8 workout templates | Thin coverage in a muscle_group × difficulty cell breaks AI matching |
| 4. TypeScript Types | `src/types.ts` with 7 ENUM types, 9 entity interfaces, 2 DTO types | Type drift from migration if a column is renamed post-Phase 1 |

**Prerequisites:** Local Supabase stack running (`npx supabase start`), Docker available  
**Estimated effort:** ~2 sessions across 4 phases

## Open Risks & Assumptions

- RLS subquery pattern on `workout_exercises` and `workout_sets` (ownership via parent table JOIN) adds per-row overhead — acceptable at MVP scale but worth monitoring as data grows
- `equipment TEXT[]` on `user_profiles` is enforced by a DB `CHECK (equipment <@ ARRAY['barbell',...]::text[])` constraint — application code must use the same vocabulary constants or writes will fail at the DB layer
- `workout_templates` is intentionally empty after seed; if S-02 implementation assumes templates exist, it will need to generate workouts from scratch via AI only

## Success Criteria (Summary)

- `npx supabase db reset` applies cleanly end-to-end with seed
- All 24 muscle_group × difficulty cells have ≥ 3 seeded exercises
- `npm run lint` passes with `src/types.ts` in place
