<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Core Database Schema

- **Plan**: context/changes/core-db-schema/plan.md
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: SOUND (originally REVISE, all findings resolved during triage)
- **Findings**: 0 pending (originally 1 critical, 5 warnings, 1 observation)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding
Grounding: 5/5 paths ✓, 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — Phase 3 Progress Checklist Gap

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Progress section
- **Detail**: Phase 3 contains a manual verification step ("Import `Exercise` in any `.ts` file and confirm IDE autocomplete shows all fields") under "Manual Verification", but this is completely omitted from the "Phase 3: TypeScript Types" checklist in the `## Progress` section at the end of the plan file. This mechanical inconsistency will cause automated tools like `/10x-implement` to fail validation.
- **Fix**: Add `- [ ] 3.3 Import Exercise in any .ts file and confirm IDE autocomplete shows all fields` under `### Phase 3: TypeScript Types` in the `## Progress` section of the plan.
- **Decision**: FIXED via Fix in plan

### F2 — Lack of Database Constraints on Equipment Vocabulary

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — exercises and user_profiles table definitions
- **Detail**: The AI matching engine relies on a strict controlled equipment vocabulary ('barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'resistance_band', 'kettlebell') on both `exercises.equipment` and `user_profiles.equipment` to function correctly. However, the tables define these as plain `TEXT` and `TEXT[]` without constraints. Typographical errors will be silently accepted by the DB and cause silent matching bugs at runtime.
- **Fix A ⭐ Recommended**: Add CHECK constraints in the migration file to restrict allowed equipment values.
  - Strength: Enforces data integrity at SQL layer; prevents silent application/seed bugs.
  - Tradeoff: Adding new equipment in the future requires updating DB constraints.
  - Confidence: HIGH — standard PostgreSQL best practice for array/string domains.
  - Blind spot: None.
- **Fix B**: Define equipment as a custom ENUM type.
  - Strength: Native strong typing.
  - Tradeoff: ENUM arrays can be harder to type in PostgREST/Supabase client, and ENUM modifications cannot be run inside transactions.
  - Confidence: MEDIUM.
- **Decision**: FIXED via Fix A

### F3 — Workout Deletion Blocks Historic Logged Sessions

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — workout_sessions table definition
- **Detail**: `workout_sessions.workout_id` is defined as `NOT NULL REFERENCES workouts(id) ON DELETE RESTRICT`. This makes it impossible for a user to delete a custom workout if they have ever logged a session against it. Deleting the workout will trigger a foreign key violation.
- **Fix A ⭐ Recommended**: Add an `is_archived BOOLEAN` column to the `workouts` table for soft deletion.
  - Strength: Preserves complete transactional history; zero orphaned sessions; clean data model.
  - Tradeoff: UI/application code must filter active workouts by `is_archived = FALSE`.
  - Confidence: HIGH — standard enterprise-grade solution for user templates.
  - Blind spot: None.
- **Fix B**: Make `workout_sessions.workout_id` nullable `ON DELETE SET NULL`.
  - Strength: Database hard deletion works; no changes to active workout queries.
  - Tradeoff: Deleting a workout orphans its historic sessions (shows as "Unknown Workout" in history).
  - Confidence: HIGH.
- **Decision**: FIXED via Fix A

### F4 — Plan Rotation Reordering Triggers Uniqueness Violations

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — user_plan table constraints
- **Detail**: `user_plan` enforces `UNIQUE (user_id, position)`. Swapping positions in the workout rotation (e.g. 1 ↔ 2) via application ORM updates will temporarily trigger unique violations and fail the transaction unless done in a convoluted three-step way.
- **Fix**: Mark the UNIQUE constraint as `DEFERRABLE INITIALLY DEFERRED` in the SQL.
  - Strength: Allows reordering updates in a single transaction; drastically simplifies frontend/API code.
  - Tradeoff: None.
  - Confidence: HIGH.
- **Decision**: FIXED via Fix in plan

### F5 — Duplicate Exercise Positions in Workouts/Templates

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — `workout_exercises` and `workout_template_exercises`
- **Detail**: The schema does not enforce uniqueness on `(workout_id, position)` or `(template_id, position)`. This makes it possible for bugs to introduce duplicate position indexes in a single workout/template.
- **Fix**: Add `UNIQUE (workout_id, position)` and `UNIQUE (template_id, position)` constraints.
- **Decision**: FIXED via Fix in plan

### F6 — Cross-Tenant Workout Association in User Plan & Sessions

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — user_plan and workout_sessions table definitions
- **Detail**: Currently, `user_plan` has `user_id` and `workout_id`, and `workout_sessions` has `user_id` and `workout_id`. Although `workouts` has its own `user_id`, the foreign keys only verify that the workout exists — they do not enforce that it belongs to the same user. This allows user A to add user B's custom workouts to their rotation or log sessions against them.
- **Fix A ⭐ Recommended**: Add `UNIQUE (user_id, id)` on `workouts`, and enforce composite FKs:
  - In `user_plan`: `FOREIGN KEY (user_id, workout_id) REFERENCES workouts (user_id, id) ON DELETE CASCADE`
  - In `workout_sessions`: `FOREIGN KEY (user_id, workout_id) REFERENCES workouts (user_id, id) ON DELETE RESTRICT`
  - Strength: Guarantees tenant isolation at the database schema layer; eliminates any cross-user leakage bugs before application code is written.
  - Tradeoff: Slightly more verbose foreign keys and adding a redundant composite unique key.
  - Confidence: HIGH — Postgres standard technique for multi-tenant relational schema integrity.
  - Blind spot: None.
- **Fix B**: Rely on application-level checks in API endpoints/middleware.
  - Strength: Simpler database schema without composite keys.
  - Tradeoff: High risk of future developers forgetting the check, causing cross-tenant leaks.
  - Confidence: LOW — application checks are notoriously prone to bypasses.
  - Blind spot: None.
- **Decision**: FIXED via Fix A

### F7 — Duplicate Exercise Positions in Workout Sets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — workout_sets table definition
- **Detail**: The `workout_sets` table tracks `set_number`, `reps`, `weight_kg`, etc. per exercise in a session, but has no uniqueness constraint. An application glitch could save duplicate rows for "set 1" of the same exercise, breaking volume calculations, history views, and personal record tracking.
- **Fix**: Add a `UNIQUE (workout_session_id, exercise_id, set_number)` constraint.
  - Strength: Ensures data integrity and prevents duplicate workout sets in a session.
  - Tradeoff: None.
  - Confidence: HIGH.
  - Blind spot: None.
- **Decision**: FIXED via Fix in plan
