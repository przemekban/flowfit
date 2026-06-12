<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Core Database Schema Implementation Plan

- **Plan**: context/changes/core-db-schema/plan.md
- **Scope**: All phases (1–4)
- **Date**: 2026-06-12
- **Verdict**: NEEDS ATTENTION (upgraded from REJECTED after triage fixed critical findings)
- **Findings**: 0 critical (2 fixed) | 2 warnings (1 fixed, 1 accepted) | 2 observations (1 fixed, 1 skipped)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after fixes) |
| Architecture | PASS |
| Pattern Consistency | PASS (after fix) |
| Success Criteria | PASS |

## Findings

### F1 — auth.role() used instead of auth.uid() IS NOT NULL on system tables

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260529000000_core_schema.sql:182–189
- **Detail**: Three system table SELECT policies used `auth.role() = 'authenticated'` instead of Supabase's recommended `auth.uid() IS NOT NULL`. The latter is semantically precise (requires a real user identity, not just a role claim) and is the pattern Supabase docs consistently recommend.
- **Fix**: Replaced all three policies with `FOR SELECT USING (auth.uid() IS NOT NULL)`.
- **Decision**: FIXED

### F2 — Non-idempotent CREATE TYPE in migration 3

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260529000002_tracking_type.sql:1
- **Detail**: `CREATE TYPE tracking_type_enum` had no guard against re-running. Investigated all 3 migrations — all use the same bare CREATE TYPE / ALTER TABLE pattern, which is consistent and is the standard Supabase migration style (each migration runs exactly once via Supabase's migration versioning). The plan's "idempotent-safe" contract was over-specified vs. Supabase conventions.
- **Fix**: No code change. Accepted as Supabase convention.
- **Decision**: ACCEPTED — standard Supabase migration pattern; each migration runs exactly once via versioning.

### F3 — Per-row subquery RLS on workout_exercises and workout_sets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260529000000_core_schema.sql:215–266
- **Detail**: RLS ownership subqueries fire per-row (N+1 at scale). Plan explicitly acknowledged this as acceptable at MVP scale.
- **Fix**: No action. Document as known scaling concern.
- **Decision**: SKIPPED — plan-acknowledged trade-off.

### F4 — No cross-column CHECK enforcing tracking_type consistency

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260529000000_core_schema.sql:74–82, migration 3
- **Detail**: Schema allows inserting workout_exercise rows with both target_reps and target_duration_seconds NULL regardless of the exercise's tracking_type. PostgreSQL can't enforce cross-table CHECK constraints natively; a trigger would be needed for DB-level enforcement, but triggers are in the plan's "What We're NOT Doing" scope exclusion.
- **Fix**: Accept as application-layer invariant enforced by S-02 API validation. No DB change.
- **Decision**: ACCEPTED — application layer invariant (Fix A). Cross-table CHECK not possible without triggers; plan excludes triggers.

### F5 — No uniqueness constraint preventing duplicate active sessions per workout

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260529000000_core_schema.sql:133–141
- **Fix**: Added new migration `supabase/migrations/20260612000000_active_session_uniqueness.sql` with:
  ```sql
  CREATE UNIQUE INDEX idx_one_active_session_per_workout
    ON workout_sessions (user_id, workout_id)
    WHERE status = 'active';
  ```
- **Decision**: FIXED

### F6 — Missing structural comments in migrations 2 and 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260529000001_exercise_detail_fields.sql, supabase/migrations/20260529000002_tracking_type.sql
- **Fix**: Added header comment blocks to both migrations explaining purpose, nullable column rationale (migration 2), and DEFAULT 'reps' choice (migration 3).
- **Decision**: FIXED

### F7 — Missing indexes on workout_exercises.exercise_id and workout_sets.exercise_id

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260529000000_core_schema.sql:160–165
- **Detail**: FK columns without indexes. Fine at MVP scale; add when query profiling shows the need.
- **Decision**: SKIPPED — low priority; add in a future migration when profiling confirms need.

### F8 — Seed data had 9 kettlebell exercises labeled as 'bodyweight'

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/seed.sql (multiple locations)
- **Detail**: Nine exercises with "kettle" or "kettlem" in their names had `equipment = 'bodyweight'`. This corrupted AI equipment-matching logic. Affected exercises: Wiosłowanie kettlem w opadzie tułowia, Wiosłowanie kettlem w podporze, Zarzut podrzut z kettlem, Tureckie wstawanie, Martwy ciag z kettlem, Wymachy kettlem, Przysiad Gobleta z kettlem, Uginanie przedramion z kettlami, Skrety tułowia z kettlem.
- **Fix**: Corrected all 9 from `'bodyweight'` to `'kettlebell'` in seed.sql.
- **Decision**: FIXED
