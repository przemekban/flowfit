-- =============================================================================
-- Tracking Type
-- =============================================================================
-- Adds tracking_type_enum to distinguish rep-counted exercises from
-- duration-counted ones (e.g., planks, cardio). Existing exercises default
-- to 'reps' — the correct value for the entire pre-existing exercise catalog.
-- Adds target_duration_seconds to template and workout exercise join tables
-- so duration targets can be stored alongside rep targets.
-- =============================================================================

CREATE TYPE tracking_type_enum AS ENUM ('reps', 'duration');

ALTER TABLE exercises
  ADD COLUMN tracking_type tracking_type_enum NOT NULL DEFAULT 'reps';

ALTER TABLE workout_template_exercises
  ADD COLUMN target_duration_seconds SMALLINT CHECK (target_duration_seconds > 0);

ALTER TABLE workout_exercises
  ADD COLUMN target_duration_seconds SMALLINT CHECK (target_duration_seconds > 0);
