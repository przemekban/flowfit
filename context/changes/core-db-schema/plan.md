# Core Database Schema Implementation Plan

## Overview

Create the complete Supabase database foundation for FlowFit: 9 tables, 6 custom ENUMs, per-operation RLS policies, performance indexes, exercise library seed data, and hand-written TypeScript entity types. Every downstream slice (S-01 through S-05) blocks on this foundation — no application code can be written until these migrations apply cleanly.

## Current State Analysis

- `supabase/migrations/` does not exist — no migrations have been written
- `supabase/seed.sql` path is declared in `supabase/config.toml` but the file does not exist
- `src/types.ts` does not exist — Supabase client in `src/lib/supabase.ts` is untyped
- Supabase CLI is configured (`supabase/config.toml`, `project_id = "10x-astro-starter"`)
- Auth tables (`auth.users`) are provided by Supabase — not created in migrations

## Desired End State

After this plan completes, `npx supabase db reset` applies the migration cleanly, seeds ~72 exercises, and leaves all 9 tables with RLS active. `npm run lint` and `astro sync` pass with `src/types.ts` in place. A developer can verify the schema in Supabase Studio (`http://localhost:54323`) and confirm that an authenticated user can read exercises but cannot read another user's workouts.

### Key Discoveries

- AGENTS.md rule: "Every new Supabase table requires RLS enabled with per-operation, per-role policies in `supabase/migrations/`"
- Migration naming convention: `YYYYMMDDHHmmss_short_description.sql` (from AGENTS.md)
- Seed config: `supabase/config.toml` declares `sql_paths = ["./seed.sql"]` — seed file must be at `supabase/seed.sql`
- Path alias `@/*` → `src/*`; use it in types import statements
- `src/lib/supabase.ts` uses `createServerClient` without a generic type argument — Phase 3 prepares types for eventual typed client (wiring up the generic is left to S-01 when the first query is written)

## What We're NOT Doing

- Generating Supabase TypeScript types via CLI (`supabase gen types`) — hand-written types are the chosen approach
- Creating `workout_templates` seed data — table is created for architectural readiness; seeding is V2 when the template browser UI is built
- Creating API routes or UI components — schema only
- Wiring the Supabase generic type parameter in `src/lib/supabase.ts` — deferred to S-01
- Creating edge functions, triggers for `updated_at` auto-update — application code sets `updated_at` explicitly on writes

## Implementation Approach

Single migration file containing ENUMs, tables, constraints, indexes, and all RLS policies in dependency order. Seed data in a separate `supabase/seed.sql`. TypeScript types in `src/types.ts` written to match the migration exactly.

## Critical Implementation Details

**ENUM creation order matters**: ENUMs must be created before any table that references them. All 6 ENUMs go at the top of the migration.

**RLS policy pattern for child tables**: `workout_exercises` and `workout_sets` rows are owned indirectly — ownership is checked via a subquery to the parent table (`workouts` or `workout_sessions`). Use `USING (auth.uid() = (SELECT user_id FROM parent_table WHERE id = parent_id))`. This subquery runs once per row and is acceptable at MVP scale.

**workout_template_exercises RLS**: system data — only SELECT is permitted for authenticated users; no INSERT/UPDATE/DELETE policies for the `authenticated` role.

**exercises.equipment vs user_profiles.equipment**: `exercises.equipment` is a single `TEXT` value (what equipment this exercise requires); `user_profiles.equipment` is `TEXT[]` (what the user has available). Values must use a shared controlled vocabulary so AI matching works: `'barbell'`, `'dumbbell'`, `'bodyweight'`, `'machine'`, `'cable'`, `'resistance_band'`, `'kettlebell'`.

---

## Phase 1: Database Migration

### Overview

Create all ENUMs, 9 tables with FK constraints and CHECK constraints, performance indexes, enable RLS on all tables, and write per-operation policies.

### Changes Required

#### 1. Migration file

**File**: `supabase/migrations/20260529000000_core_schema.sql`

**Intent**: Single migration that establishes the full schema in dependency order (ENUMs → system tables → user tables → child tables → indexes → RLS).

**Contract**: The migration must be idempotent-safe (use `CREATE TYPE ... IF NOT EXISTS`, `CREATE TABLE ... IF NOT EXISTS`). Sections in order:

**1a. ENUMs**

- `training_goal_enum`: `'strength'`, `'hypertrophy'`, `'cardio_endurance'`, `'fat_loss'`, `'general_fitness'`
- `experience_level_enum`: `'beginner'`, `'intermediate'`, `'advanced'`
- `preferred_style_enum`: `'full_body'`, `'push_pull_legs'`, `'upper_lower'`, `'circuit'`
- `muscle_group_enum`: `'chest'`, `'back'`, `'shoulders'`, `'arms'`, `'core'`, `'legs'`, `'glutes'`, `'cardio'`
- `workout_status_enum`: `'active'`, `'completed'`, `'abandoned'`
- `workout_source_enum`: `'ai'`, `'template'`, `'custom'`

**1b. System tables (no user_id)**

`exercises`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `name TEXT NOT NULL`
- `muscle_group muscle_group_enum NOT NULL`
- `difficulty experience_level_enum NOT NULL`
- `equipment TEXT NOT NULL CHECK (equipment IN ('barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'resistance_band', 'kettlebell'))`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

`workout_templates`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `name TEXT NOT NULL`
- `description TEXT`
- `target_goal training_goal_enum`
- `difficulty experience_level_enum`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

`workout_template_exercises`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `template_id UUID NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE`
- `exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT`
- `position SMALLINT NOT NULL CHECK (position > 0)`
- `target_sets SMALLINT CHECK (target_sets > 0)`
- `target_reps SMALLINT CHECK (target_reps > 0)`
- `UNIQUE (template_id, position)`

**1c. User-owned tables**

`user_profiles`:
- `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
- `training_goal training_goal_enum NOT NULL`
- `experience_level experience_level_enum NOT NULL`
- `equipment TEXT[] NOT NULL DEFAULT '{}' CHECK (equipment <@ ARRAY['barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'resistance_band', 'kettlebell']::text[])`
- `preferred_style preferred_style_enum NOT NULL`
- `sessions_per_week SMALLINT NOT NULL CHECK (sessions_per_week BETWEEN 1 AND 7)`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

`workouts`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `description TEXT`
- `source workout_source_enum NOT NULL DEFAULT 'ai'`
- `template_id UUID REFERENCES workout_templates(id) ON DELETE SET NULL`
- `is_archived BOOLEAN NOT NULL DEFAULT FALSE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `UNIQUE (user_id, id)`

`workout_exercises`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE`
- `exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT`
- `position SMALLINT NOT NULL CHECK (position > 0)`
- `target_sets SMALLINT CHECK (target_sets > 0)`
- `target_reps SMALLINT CHECK (target_reps > 0)`
- `UNIQUE (workout_id, position)`

`user_plan`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
- `workout_id UUID NOT NULL`
- `position SMALLINT NOT NULL CHECK (position > 0)`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `UNIQUE (user_id, position) DEFERRABLE INITIALLY DEFERRED`
- `UNIQUE (user_id, workout_id)`
- `FOREIGN KEY (user_id, workout_id) REFERENCES workouts(user_id, id) ON DELETE CASCADE`

`workout_sessions`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
- `workout_id UUID NOT NULL`
- `status workout_status_enum NOT NULL DEFAULT 'active'`
- `started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `completed_at TIMESTAMPTZ`
- `FOREIGN KEY (user_id, workout_id) REFERENCES workouts(user_id, id) ON DELETE RESTRICT`

`workout_sets`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `workout_session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE`
- `exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT`
- `set_number SMALLINT NOT NULL CHECK (set_number > 0)`
- `reps SMALLINT CHECK (reps >= 0)`
- `weight_kg DECIMAL(6,2) CHECK (weight_kg >= 0)`
- `duration_seconds SMALLINT CHECK (duration_seconds > 0)`
- `notes TEXT`
- `logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `UNIQUE (workout_session_id, exercise_id, set_number)`

**1d. Indexes**

- `CREATE INDEX idx_workout_sessions_user_completed ON workout_sessions (user_id, completed_at DESC)` — S-04 history query key
- `CREATE INDEX idx_workout_sessions_user_status ON workout_sessions (user_id, status)` — filter active sessions
- `CREATE INDEX idx_workout_sets_session ON workout_sets (workout_session_id)` — fetch sets for a session
- `CREATE INDEX idx_workout_exercises_workout ON workout_exercises (workout_id, position)` — ordered exercises in a workout
- `CREATE INDEX idx_user_plan_user_position ON user_plan (user_id, position)` — rotation order
- `CREATE INDEX idx_workouts_user ON workouts (user_id)` — user's workout list

**1e. RLS — enable on all tables, then per-operation policies**

Enable RLS: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY` for all 9 tables.

Policy pattern for system tables (`exercises`, `workout_templates`, `workout_template_exercises`):
- One SELECT policy per table: `USING (auth.role() = 'authenticated')` — all authenticated users can read
- No INSERT/UPDATE/DELETE policies for the `authenticated` role

Policy pattern for user_profiles:
- SELECT: `USING (auth.uid() = id)`
- INSERT: `WITH CHECK (auth.uid() = id)`
- UPDATE: `USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`
- (No DELETE — profile is permanent in MVP)

Policy pattern for workouts, user_plan, workout_sessions (direct `user_id` column):
- SELECT: `USING (auth.uid() = user_id)`
- INSERT: `WITH CHECK (auth.uid() = user_id)`
- UPDATE: `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`
- DELETE: `USING (auth.uid() = user_id)`

Policy pattern for workout_exercises (ownership via `workouts.user_id`):
- SELECT, INSERT, UPDATE, DELETE: all use `USING (auth.uid() = (SELECT user_id FROM workouts WHERE id = workout_id))`; INSERT also needs `WITH CHECK` with the same subquery

Policy pattern for workout_sets (ownership via `workout_sessions.user_id`):
- SELECT, INSERT, UPDATE, DELETE: all use `USING (auth.uid() = (SELECT user_id FROM workout_sessions WHERE id = workout_session_id))`; INSERT also needs `WITH CHECK`

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `npx supabase db reset` exits 0
- All 9 tables exist in the `public` schema: verify via `npx supabase db diff` showing no pending changes
- `npm run lint` passes (no TS errors introduced by schema artifacts)

#### Manual Verification

- Open Supabase Studio (`http://localhost:54323`), navigate to Table Editor — all 9 tables visible
- In SQL Editor, run `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename` — confirm all 9 table names appear
- RLS sanity check in Studio: attempt to SELECT from `workouts` as `anon` role — should return 0 rows with no error (RLS silently filters)
- Confirm all 6 ENUMs are listed under Database → Types in Studio

**Implementation Note**: Pause after automated verification passes and manual verification is complete before proceeding to Phase 2.

---

## Phase 2: Exercise Seed Data

### Overview

Populate `supabase/seed.sql` with ~72 exercises covering all 8 muscle groups at all 3 difficulty levels (~3 exercises per muscle_group × difficulty combination). Equipment values must be drawn from the controlled vocabulary: `'barbell'`, `'dumbbell'`, `'bodyweight'`, `'machine'`, `'cable'`, `'resistance_band'`, `'kettlebell'`.

### Changes Required

#### 1. Seed file

**File**: `supabase/seed.sql`

**Intent**: Insert exercises that give the AI enough variety to match any user profile combination (training_goal × experience_level × preferred_style × equipment). At least one exercise per muscle_group × difficulty cell. Bodyweight exercises must exist for users with `equipment = '{bodyweight}'`.

**Contract**: All INSERTs target the `exercises` table. Each row specifies `name`, `muscle_group` (one of the 8 enum values), `difficulty` (one of the 3 enum values), and `equipment` (one value from the controlled vocabulary). The seed file is safe to re-run after `db reset` because `db reset` drops and recreates tables first. No `ON CONFLICT` clause needed.

Target distribution:
- `chest` (beginner: Push-up, Incline Push-up, Chest Dip; intermediate: Bench Press, Dumbbell Fly, Cable Crossover; advanced: Weighted Dip, Barbell Incline Press, Decline Bench Press)
- `back` (beginner: Band Pull-Apart, Inverted Row, Superman; intermediate: Dumbbell Row, Lat Pulldown, Cable Row; advanced: Deadlift, Pull-up, Barbell Bent Row)
- `shoulders` (beginner: Band Lateral Raise, Pike Push-up, Shoulder Tap; intermediate: Dumbbell Shoulder Press, Lateral Raise, Front Raise; advanced: Barbell Overhead Press, Arnold Press, Cable Face Pull)
- `arms` (beginner: Band Curl, Diamond Push-up, Tricep Dip; intermediate: Dumbbell Curl, Overhead Tricep Extension, Hammer Curl; advanced: Barbell Curl, Close-Grip Bench Press, Cable Pushdown)
- `core` (beginner: Crunch, Plank, Dead Bug; intermediate: Hanging Knee Raise, Russian Twist, Ab Wheel; advanced: Hanging Leg Raise, Dragon Flag, Cable Crunch)
- `legs` (beginner: Bodyweight Squat, Lunge, Step-up; intermediate: Goblet Squat, Romanian Deadlift, Leg Press; advanced: Barbell Back Squat, Barbell Front Squat, Bulgarian Split Squat)
- `glutes` (beginner: Glute Bridge, Clamshell, Donkey Kick; intermediate: Hip Thrust, Sumo Deadlift, Cable Kickback; advanced: Barbell Hip Thrust, Single-Leg Romanian Deadlift, Weighted Glute Bridge)
- `cardio` (beginner: Jumping Jacks, March in Place, Low-Impact Burpee; intermediate: Jump Rope, Box Jump, Kettlebell Swing; advanced: Battle Ropes, Assault Bike Sprint, Burpee Pull-up)

### Success Criteria

#### Automated Verification

- `npx supabase db reset` exits 0 and seeds run without error
- `SELECT COUNT(*) FROM exercises` returns ≥ 72
- `SELECT muscle_group, difficulty, COUNT(*) FROM exercises GROUP BY 1, 2 ORDER BY 1, 2` — each of the 24 cells has ≥ 3 rows

#### Manual Verification

- In Supabase Studio Table Editor, scan exercises rows — names are readable, no obvious data errors
- Verify at least one `equipment = 'bodyweight'` exercise per muscle_group (critical for users with no equipment)

**Implementation Note**: Pause after seed verification before proceeding to Phase 3.

---

## Phase 3: TypeScript Types

### Overview

Write `src/types.ts` containing ENUM union types, entity interfaces matching the migration schema exactly, and DTO types for the most common API response shapes. All downstream slices import from this file.

### Changes Required

#### 1. Types file

**File**: `src/types.ts`

**Intent**: Define TypeScript-level representations of all DB entities so that API routes and components are type-safe without requiring Supabase-generated types.

**Contract**: The file exports:

**ENUM union types** (must match migration values exactly):
- `TrainingGoal = 'strength' | 'hypertrophy' | 'cardio_endurance' | 'fat_loss' | 'general_fitness'`
- `ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'`
- `PreferredStyle = 'full_body' | 'push_pull_legs' | 'upper_lower' | 'circuit'`
- `MuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'legs' | 'glutes' | 'cardio'`
- `WorkoutStatus = 'active' | 'completed' | 'abandoned'`
- `WorkoutSource = 'ai' | 'template' | 'custom'`

**Entity interfaces** (field names = column names, types match DB types):
- `UserProfile` — all columns of `user_profiles` (equipment as `string[]`)
- `Exercise` — all columns of `exercises`
- `WorkoutTemplate` — all columns of `workout_templates`
- `WorkoutTemplateExercise` — all columns of `workout_template_exercises`
- `Workout` — all columns of `workouts` (template_id as `string | null`)
- `WorkoutExercise` — all columns of `workout_exercises`
- `UserPlanItem` — all columns of `user_plan`
- `WorkoutSession` — all columns of `workout_sessions` (completed_at as `string | null`)
- `WorkoutSet` — all columns of `workout_sets` (reps, weight_kg, duration_seconds, notes all nullable)

**DTO types** for API response shapes used by downstream slices:
- `WorkoutWithExercises` — `Workout & { exercises: (WorkoutExercise & { exercise: Exercise })[] }` — used by S-02 and S-03
- `WorkoutSessionWithSets` — `WorkoutSession & { workout: Workout; sets: (WorkoutSet & { exercise: Exercise })[] }` — used by S-03 and S-04

No imports from external packages in this file — pure TypeScript type definitions only.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with zero errors (`astro check` and `eslint` both clean)
- `astro sync` exits 0 (no type import errors in Astro components)

#### Manual Verification

- Import `Exercise` in any `.ts` file and confirm IDE autocomplete shows all fields

**Implementation Note**: After lint passes, the plan is complete.

---

## Testing Strategy

### Manual Testing Steps

1. Run `npx supabase start` then `npx supabase db reset` — confirm it applies cleanly
2. Open Studio (`http://localhost:54323`) → Table Editor — verify all 9 tables
3. SQL Editor: `SELECT muscle_group, difficulty, COUNT(*) FROM exercises GROUP BY 1, 2` — confirm distribution
4. SQL Editor: test RLS by switching role to `anon` and attempting `SELECT * FROM workouts` — confirm 0 rows returned (not an error)
5. Run `npm run lint` from project root — confirm clean

## Migration Notes

- `supabase/migrations/` directory must be created before adding the migration file (it doesn't exist yet)
- The seed file path `supabase/seed.sql` is already declared in `supabase/config.toml` — just create the file, no config change needed
- If local Supabase is not running: `npx supabase start` before `npx supabase db reset`

## References

- Roadmap F-01: `context/foundation/roadmap.md`
- PRD: `context/foundation/prd.md`
- AGENTS.md RLS rule: every table needs per-operation, per-role policies
- Supabase config: `supabase/config.toml` (seed path, port 54321, Studio port 54323)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Database Migration

#### Automated

- [ ] 1.1 Migration applies cleanly: `npx supabase db reset` exits 0
- [ ] 1.2 All 9 tables exist: `SELECT tablename FROM pg_tables WHERE schemaname = 'public'` confirms all names
- [ ] 1.3 `npm run lint` passes

#### Manual

- [ ] 1.4 All 9 tables visible in Supabase Studio Table Editor
- [ ] 1.5 All 6 ENUMs visible under Database → Types in Studio
- [ ] 1.6 RLS check: SELECT from `workouts` as `anon` role returns 0 rows

### Phase 2: Exercise Seed Data

#### Automated

- [ ] 2.1 `npx supabase db reset` exits 0 with seed
- [ ] 2.2 `SELECT COUNT(*) FROM exercises` ≥ 72
- [ ] 2.3 Each of 24 muscle_group × difficulty cells has ≥ 3 rows

#### Manual

- [ ] 2.4 Exercise names are readable and correct in Studio
- [ ] 2.5 At least one `equipment = 'bodyweight'` exercise per muscle_group

### Phase 3: TypeScript Types

#### Automated

- [ ] 3.1 `npm run lint` passes with zero errors
- [ ] 3.2 `astro sync` exits 0

#### Manual

- [ ] 3.3 Import `Exercise` in any `.ts` file and confirm IDE autocomplete shows all fields
