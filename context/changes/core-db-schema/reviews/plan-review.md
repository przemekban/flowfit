<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Core Database Schema Implementation Plan

- **Plan**: context/changes/core-db-schema/plan.md
- **Reviews run**: 2 (2026-05-29 pre-implementation · 2026-06-12 post-implementation)
- **Verdict**: SOUND (all findings resolved across both reviews)

---

## Review 1 — 2026-05-29 (pre-implementation)

- **Mode**: Deep
- **Verdict**: SOUND (originally REVISE → all 7 findings resolved during triage)
- **Findings**: 1 critical | 5 warnings | 1 observation — all FIXED

### Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

### Grounding

5/5 paths ✓, 5/5 symbols ✓, brief↔plan ✓

### Findings

#### F1.1 — Phase 3 Progress Checklist Gap

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Progress section
- **Detail**: Phase 3 contained a manual verification step ("Import `Exercise` in any `.ts` file and confirm IDE autocomplete shows all fields") under "Manual Verification", but it was completely omitted from the `### Phase 3` checklist in the `## Progress` section. This mechanical inconsistency would cause `/10x-implement` to fail validation.
- **Fix**: Add `- [ ] 3.3 Import Exercise in any .ts file and confirm IDE autocomplete shows all fields` under `### Phase 3` in `## Progress`.
- **Decision**: FIXED via Fix in plan

#### F1.2 — Lack of Database Constraints on Equipment Vocabulary

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — exercises and user_profiles table definitions
- **Detail**: The AI matching engine relies on a strict controlled equipment vocabulary on both `exercises.equipment` and `user_profiles.equipment`. The tables defined these as plain `TEXT` and `TEXT[]` without constraints. Typographical errors would be silently accepted by the DB and cause silent matching bugs at runtime.
- **Fix A ⭐ Recommended**: Add CHECK constraints in the migration to restrict allowed equipment values.
  - Strength: Enforces data integrity at SQL layer; prevents silent seed/application bugs.
  - Tradeoff: Adding new equipment in future requires updating DB constraints.
  - Confidence: HIGH — standard PostgreSQL best practice.
  - Blind spot: None.
- **Fix B**: Define equipment as a custom ENUM type.
  - Strength: Native strong typing.
  - Tradeoff: ENUM arrays harder to type in PostgREST/Supabase client; ENUM modifications cannot run inside transactions.
  - Confidence: MEDIUM.
- **Decision**: FIXED via Fix A

#### F1.3 — Workout Deletion Blocks Historic Logged Sessions

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — workout_sessions table definition
- **Detail**: `workout_sessions.workout_id NOT NULL REFERENCES workouts(id) ON DELETE RESTRICT` makes it impossible for a user to delete a custom workout if they have ever logged a session against it — the FK violation would surface at UI level.
- **Fix A ⭐ Recommended**: Add `is_archived BOOLEAN` column to `workouts` for soft deletion.
  - Strength: Preserves complete transactional history; no orphaned sessions; clean data model.
  - Tradeoff: UI/application code must filter active workouts by `is_archived = FALSE`.
  - Confidence: HIGH — standard solution for user templates.
  - Blind spot: None.
- **Fix B**: Make `workout_sessions.workout_id` nullable `ON DELETE SET NULL`.
  - Strength: DB hard deletion works; no changes to active workout queries.
  - Tradeoff: Deleting a workout orphans its historic sessions.
  - Confidence: HIGH.
- **Decision**: FIXED via Fix A

#### F1.4 — Plan Rotation Reordering Triggers Uniqueness Violations

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — user_plan table constraints
- **Detail**: `user_plan` enforced `UNIQUE (user_id, position)`. Swapping positions (e.g. 1 ↔ 2) via ORM updates would temporarily trigger unique violations and fail the transaction without a convoluted three-step workaround.
- **Fix**: Mark the UNIQUE constraint as `DEFERRABLE INITIALLY DEFERRED` in the SQL.
  - Strength: Allows reordering in a single transaction; drastically simplifies API code.
  - Tradeoff: None.
  - Confidence: HIGH.
- **Decision**: FIXED via Fix in plan

#### F1.5 — Duplicate Exercise Positions in Workouts/Templates

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — `workout_exercises` and `workout_template_exercises`
- **Detail**: No uniqueness constraint on `(workout_id, position)` or `(template_id, position)`, making duplicate position indexes possible via application bugs.
- **Fix**: Add `UNIQUE (workout_id, position)` and `UNIQUE (template_id, position)` constraints.
- **Decision**: FIXED via Fix in plan

#### F1.6 — Cross-Tenant Workout Association in User Plan & Sessions

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — user_plan and workout_sessions table definitions
- **Detail**: `user_plan` and `workout_sessions` had `user_id` + `workout_id` columns, but the foreign keys only verified that the workout existed — not that it belonged to the same user. This would allow user A to add user B's custom workouts to their rotation.
- **Fix A ⭐ Recommended**: Add `UNIQUE (user_id, id)` on `workouts` and enforce composite FKs in `user_plan` and `workout_sessions` referencing `workouts(user_id, id)`.
  - Strength: Guarantees tenant isolation at the DB schema layer.
  - Tradeoff: Slightly more verbose FKs and one extra composite unique key.
  - Confidence: HIGH — standard multi-tenant Postgres technique.
  - Blind spot: None.
- **Fix B**: Rely on application-level checks in API endpoints.
  - Strength: Simpler schema.
  - Tradeoff: High risk of future developers forgetting the check, causing cross-tenant leaks.
  - Confidence: LOW.
- **Decision**: FIXED via Fix A

#### F1.7 — Duplicate Set Numbers in Workout Sets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — workout_sets table definition
- **Detail**: No uniqueness constraint on `(workout_session_id, exercise_id, set_number)`. An application glitch could save duplicate rows for "set 1" of the same exercise, breaking volume calculations and personal record tracking.
- **Fix**: Add `UNIQUE (workout_session_id, exercise_id, set_number)` constraint.
- **Decision**: FIXED via Fix in plan

---

## Review 2 — 2026-06-12 (post-implementation)

- **Mode**: Deep
- **Verdict**: SOUND (originally REVISE → all 3 findings resolved during triage)
- **Findings**: 0 critical | 2 warnings | 1 observation — all FIXED

### Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F2.3 fixed) |
| Plan Completeness | WARNING → PASS (F2.1, F2.2 fixed) |

### Grounding

5/5 migration/output paths ✓, 3/3 migration files ✓, brief↔plan FAIL (divergence fixed via F2.1)

### Findings

#### F2.1 — plan-brief.md is significantly stale

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: plan-brief.md — Scope, Key Decisions, Phases at a Glance
- **Detail**: Brief diverged from implemented reality on four counts: exercise count (~72 vs 820+), template scope (explicitly out-of-scope vs 8 seeded), ENUM count (6 vs 7), and phase structure (3 vs 4 phases). Represented an earlier draft never updated when the scraping approach and template seeding were added.
- **Fix**: Update plan-brief.md — rewrite Scope table, Phases at a Glance, Key Decisions template row, and Desired End State.
- **Decision**: FIXED — updated all four divergence points in plan-brief.md.

#### F2.2 — tracking_type migration has no backing phase

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Changes Required
- **Detail**: `supabase/migrations/20260529000002_tracking_type.sql` was committed with Phase 3 but had no entry in Phase 3's Changes Required section. Phase 4 referenced these columns as "added in migration 3" without a backing plan entry. An implementer following only the document would not know to create this file.
- **Fix**: Add a Migration file Changes Required item to Phase 3 for `20260529000002_tracking_type.sql`.
- **Decision**: FIXED — added Changes Required entry to Phase 3 with the full SQL contract.

#### F2.3 — Brief's equipment validation risk is misleading

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: plan-brief.md — Open Risks
- **Detail**: Brief said equipment validation was "validated by the application, not a DB ENUM constraint". The migration has `CHECK (equipment <@ ARRAY[...]::text[])` enforcing it at DB level. The framing could cause future developers to add redundant app validation or assume the CHECK is safe to drop.
- **Fix**: Correct the Open Risks entry to note the DB CHECK constraint.
- **Decision**: FIXED — updated the Open Risks entry in plan-brief.md.
