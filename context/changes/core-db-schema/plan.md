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

## Phase 2: Exercise Detail Fields Migration

### Overview

Add six detail columns to the `exercises` table so each exercise can carry its full Polish-language content (description, instructions, muscles, tips, mistakes). These columns are populated in Phase 3 from SmartWorkout scraping. All columns are nullable so the migration does not break the Phase 1 data already in the table.

### Changes Required

#### 1. Migration file

**File**: `supabase/migrations/20260529000001_exercise_detail_fields.sql`

**Intent**: Extend `exercises` with one column per content section, preserving all existing rows.

**Contract**:

```sql
ALTER TABLE exercises
  ADD COLUMN description      TEXT,
  ADD COLUMN instructions     TEXT[],
  ADD COLUMN muscles_primary  TEXT[],
  ADD COLUMN muscles_secondary TEXT[],
  ADD COLUMN tips             TEXT[],
  ADD COLUMN common_mistakes  TEXT[];
```

No new RLS policies are needed — the existing `exercises_select` policy covers all columns on the table.

### Success Criteria

#### Automated Verification

- `npx supabase db reset` exits 0 (both migrations apply cleanly)
- `SELECT column_name FROM information_schema.columns WHERE table_name = 'exercises' ORDER BY ordinal_position` — all 12 columns present (6 original + 6 new)

#### Manual Verification

- Studio → Table Editor → `exercises` — new columns visible with NULL values for seeded rows

**Implementation Note**: Pause after automated verification and manual check before proceeding to Phase 3.

---

## Phase 3: Exercise Seed Data

### Overview

Populate `supabase/seed.sql` with ~820 exercises scraped from SmartWorkout.app (all detail fields in Polish, copied directly from the source), plus cardio exercises and workout templates authored by a professional trainer. The result seeds three tables: `exercises`, `workout_templates`, `workout_template_exercises`.

Full scraping strategy and Claude prompts are documented in `context/changes/core-db-schema/exercise-scraping.md`.

### Changes Required

#### 1. Scraper script

**File**: `scripts/scrape-exercises.mjs`

**Intent**: Fetch 9 category listing pages from SmartWorkout, then each exercise's detail page, and output `exercises-raw.json` with one object per exercise containing all scraped Polish-language fields.

**Output fields per exercise**:
- `name` — Polish name (copied from page h1)
- `muscle_group` — assigned from category URL context
- `tags` — SmartWorkout tags (e.g. `["Siła", "Ciągnące"]`) — used to infer difficulty/equipment
- `description` — intro paragraph (Polish, copied verbatim)
- `instructions` — array of step strings (Polish, copied verbatim)
- `muscles_primary` — array of primary muscle names (Polish, copied verbatim)
- `muscles_secondary` — array of secondary muscle names (Polish, copied verbatim)
- `tips` — array of tip strings (Polish, copied verbatim)
- `common_mistakes` — array of mistake strings (Polish, copied verbatim)

**Notes**: `exercises-raw.json` is gitignored (intermediate artifact). ~820 HTTP requests with 500 ms throttle ≈ 7 minutes runtime.

#### 2. Seed file

**File**: `supabase/seed.sql`

**Intent**: Three ordered INSERT blocks that fully populate the exercise library and template system.

**Block 1 — exercises**: ~820 rows from SmartWorkout (scraped data, Polish) + 9 cardio exercises (authored by a professional trainer, Polish, all detail fields included). Each row covers all 12 columns of `exercises`. `equipment` and `difficulty` are inferred by Claude from exercise name and tags — see `exercise-scraping.md` Faza 2 for the prompt and mapping rules.

Cardio exercises (9 total, 3 per difficulty) are selected as a professional trainer would: movements proven effective for cardiovascular conditioning, appropriate to skill level, achievable without specialized equipment where possible. All cardio rows carry full description/instructions/muscles/tips/common_mistakes in Polish.

**Block 2 — workout_templates**: 8 templates authored by a professional trainer covering the full matrix of `target_goal × preferred_style × experience_level`. Templates must represent programs a certified personal trainer would confidently prescribe — scientifically grounded exercise selection, appropriate volume/intensity for the stated difficulty, balanced muscle group coverage. Full list in `exercise-scraping.md` Faza 3.

**Block 3 — workout_template_exercises**: FK references resolved via `SELECT id FROM exercises WHERE name = '...'` subqueries (avoids hardcoded UUIDs). Each template: 6–8 exercises with `target_sets` and `target_reps` matching the training goal.

**Contract**: All three INSERT blocks must succeed in a single `db reset`. Block 3 must follow blocks 1 and 2 due to FK dependencies.

### Success Criteria

#### Automated Verification

- `npx supabase db reset` exits 0 with all three seed blocks
- `SELECT COUNT(*) FROM exercises` ≥ 820
- `SELECT muscle_group, difficulty, COUNT(*) FROM exercises GROUP BY 1, 2 ORDER BY 1, 2` — each of 24 cells ≥ 3 rows
- `SELECT COUNT(*) FROM workout_templates` = 8
- `SELECT wt.name, COUNT(wte.id) FROM workout_templates wt JOIN workout_template_exercises wte ON wte.template_id = wt.id GROUP BY wt.name` — each template has 6–8 exercises

#### Manual Verification

- Studio → exercises: Polish names, readable descriptions, all 6 detail columns populated (no unexpected NULLs)
- Studio → exercises: at least one `equipment = 'bodyweight'` per muscle_group (critical for users with no equipment)
- Studio → workout_templates: 8 rows with sensible names, target_goal, difficulty
- Studio → workout_template_exercises: exercises in each template are logically consistent with the template's goal and difficulty

**Implementation Note**: Pause after seed verification before proceeding to Phase 4.

---

## Phase 4: TypeScript Types

### Overview

Write `src/types.ts` containing ENUM union types, entity interfaces matching the full migration schema (including the six new exercise detail columns added in Phase 2), and DTO types for the most common API response shapes. All downstream slices import from this file.

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
- `Exercise` — all columns of `exercises`; detail fields nullable: `description: string | null`, `instructions: string[] | null`, `muscles_primary: string[] | null`, `muscles_secondary: string[] | null`, `tips: string[] | null`, `common_mistakes: string[] | null`
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

- Import `Exercise` in any `.ts` file and confirm IDE autocomplete shows all 12 fields including the six detail columns

**Implementation Note**: After lint passes, the plan is complete.

---

## Testing Strategy

### Manual Testing Steps

1. Run `npx supabase start` then `npx supabase db reset` — confirm both migrations apply and seed runs cleanly
2. Open Studio (`http://localhost:54323`) → Table Editor — verify all 9 tables and 12 columns on `exercises`
3. SQL Editor: `SELECT muscle_group, difficulty, COUNT(*) FROM exercises GROUP BY 1, 2` — confirm distribution
4. SQL Editor: test RLS by switching role to `anon` and attempting `SELECT * FROM workouts` — confirm 0 rows returned (not an error)
5. SQL Editor: `SELECT name, description, instructions FROM exercises LIMIT 5` — confirm Polish content, arrays properly stored
6. SQL Editor: `SELECT wt.name, COUNT(wte.id) FROM workout_templates wt JOIN workout_template_exercises wte ON wte.template_id=wt.id GROUP BY wt.name` — confirm all 8 templates have exercises
7. Run `npm run lint` from project root — confirm clean

## Migration Notes

- `supabase/migrations/` directory already created in Phase 1
- Two migration files apply in filename order: `20260529000000_core_schema.sql` then `20260529000001_exercise_detail_fields.sql`
- The seed file path `supabase/seed.sql` is already declared in `supabase/config.toml`
- If local Supabase is not running: `npx supabase start` before `npx supabase db reset`
- `exercises-raw.json` (scraper output) must be added to `.gitignore` before committing Phase 3

## References

- Roadmap F-01: `context/foundation/roadmap.md`
- PRD: `context/foundation/prd.md`
- AGENTS.md RLS rule: every table needs per-operation, per-role policies
- Supabase config: `supabase/config.toml` (seed path, port 54321, Studio port 54323)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Database Migration

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` exits 0 — ef76eee
- [x] 1.2 All 9 tables exist: `SELECT tablename FROM pg_tables WHERE schemaname = 'public'` confirms all names — ef76eee
- [x] 1.3 `npm run lint` passes — ef76eee

#### Manual

- [x] 1.4 All 9 tables visible in Supabase Studio Table Editor — ef76eee
- [x] 1.5 All 6 ENUMs visible under Database → Types in Studio — ef76eee
- [x] 1.6 RLS check: SELECT from `workouts` as `anon` role returns 0 rows — ef76eee

### Phase 2: Exercise Detail Fields Migration

#### Automated

- [ ] 2.1 `npx supabase db reset` exits 0 (both migrations apply)
- [ ] 2.2 All 12 columns present on `exercises` table (`information_schema.columns` check)

#### Manual

- [ ] 2.3 New columns visible in Studio Table Editor with NULL values for existing rows

### Phase 3: Exercise Seed Data

#### Automated

- [ ] 3.1 `npx supabase db reset` exits 0 with all seed blocks
- [ ] 3.2 `SELECT COUNT(*) FROM exercises` ≥ 820
- [ ] 3.3 Each of 24 muscle_group × difficulty cells has ≥ 3 rows
- [ ] 3.4 `SELECT COUNT(*) FROM workout_templates` = 8
- [ ] 3.5 Each template has 6–8 exercises in `workout_template_exercises`

#### Manual

- [ ] 3.6 Polish exercise names, readable descriptions, detail columns populated in Studio
- [ ] 3.7 At least one `equipment = 'bodyweight'` exercise per muscle_group
- [ ] 3.8 Workout templates are logically consistent (goal × difficulty × exercise selection)

### Phase 4: TypeScript Types

#### Automated

- [ ] 4.1 `npm run lint` passes with zero errors
- [ ] 4.2 `astro sync` exits 0

#### Manual

- [ ] 4.3 Import `Exercise` in any `.ts` file and confirm IDE autocomplete shows all 12 fields
