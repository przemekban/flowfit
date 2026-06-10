CREATE TYPE tracking_type_enum AS ENUM ('reps', 'duration');

ALTER TABLE exercises
  ADD COLUMN tracking_type tracking_type_enum NOT NULL DEFAULT 'reps';

ALTER TABLE workout_template_exercises
  ADD COLUMN target_duration_seconds SMALLINT CHECK (target_duration_seconds > 0);

ALTER TABLE workout_exercises
  ADD COLUMN target_duration_seconds SMALLINT CHECK (target_duration_seconds > 0);
