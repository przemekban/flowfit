-- =============================================================================
-- FlowFit Core Schema
-- =============================================================================

-- 1a. ENUMs
-- =============================================================================

CREATE TYPE training_goal_enum AS ENUM (
  'strength',
  'hypertrophy',
  'cardio_endurance',
  'fat_loss',
  'general_fitness'
);

CREATE TYPE experience_level_enum AS ENUM (
  'beginner',
  'intermediate',
  'advanced'
);

CREATE TYPE preferred_style_enum AS ENUM (
  'full_body',
  'push_pull_legs',
  'upper_lower',
  'circuit'
);

CREATE TYPE muscle_group_enum AS ENUM (
  'chest',
  'back',
  'shoulders',
  'arms',
  'core',
  'legs',
  'glutes',
  'cardio'
);

CREATE TYPE workout_status_enum AS ENUM (
  'active',
  'completed',
  'abandoned'
);

CREATE TYPE workout_source_enum AS ENUM (
  'ai',
  'template',
  'custom'
);

-- =============================================================================
-- 1b. System tables (no user_id)
-- =============================================================================

CREATE TABLE exercises (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  muscle_group muscle_group_enum NOT NULL,
  difficulty  experience_level_enum NOT NULL,
  equipment   TEXT        NOT NULL CHECK (equipment IN ('barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'resistance_band', 'kettlebell')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workout_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  target_goal training_goal_enum,
  difficulty  experience_level_enum,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workout_template_exercises (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID        NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id UUID        NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position    SMALLINT    NOT NULL CHECK (position > 0),
  target_sets SMALLINT    CHECK (target_sets > 0),
  target_reps SMALLINT    CHECK (target_reps > 0),
  UNIQUE (template_id, position)
);

-- =============================================================================
-- 1c. User-owned tables
-- =============================================================================

CREATE TABLE user_profiles (
  id               UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  training_goal    training_goal_enum NOT NULL,
  experience_level experience_level_enum NOT NULL,
  equipment        TEXT[]      NOT NULL DEFAULT '{}' CHECK (equipment <@ ARRAY['barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'resistance_band', 'kettlebell']::text[]),
  preferred_style  preferred_style_enum NOT NULL,
  sessions_per_week SMALLINT   NOT NULL CHECK (sessions_per_week BETWEEN 1 AND 7),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workouts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  source      workout_source_enum NOT NULL DEFAULT 'ai',
  template_id UUID        REFERENCES workout_templates(id) ON DELETE SET NULL,
  is_archived BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, id)
);

CREATE TABLE workout_exercises (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id  UUID        NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id UUID        NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position    SMALLINT    NOT NULL CHECK (position > 0),
  target_sets SMALLINT    CHECK (target_sets > 0),
  target_reps SMALLINT    CHECK (target_reps > 0),
  UNIQUE (workout_id, position)
);

CREATE TABLE user_plan (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id UUID        NOT NULL,
  position   SMALLINT    NOT NULL CHECK (position > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, position) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (user_id, workout_id),
  FOREIGN KEY (user_id, workout_id) REFERENCES workouts(user_id, id) ON DELETE CASCADE
);

CREATE TABLE workout_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id   UUID        NOT NULL,
  status       workout_status_enum NOT NULL DEFAULT 'active',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (user_id, workout_id) REFERENCES workouts(user_id, id) ON DELETE RESTRICT
);

CREATE TABLE workout_sets (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID        NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id        UUID        NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  set_number         SMALLINT    NOT NULL CHECK (set_number > 0),
  reps               SMALLINT    CHECK (reps >= 0),
  weight_kg          DECIMAL(6,2) CHECK (weight_kg >= 0),
  duration_seconds   SMALLINT    CHECK (duration_seconds > 0),
  notes              TEXT,
  logged_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workout_session_id, exercise_id, set_number)
);

-- =============================================================================
-- 1d. Indexes
-- =============================================================================

CREATE INDEX idx_workout_sessions_user_completed ON workout_sessions (user_id, completed_at DESC);
CREATE INDEX idx_workout_sessions_user_status    ON workout_sessions (user_id, status);
CREATE INDEX idx_workout_sets_session            ON workout_sets (workout_session_id);
CREATE INDEX idx_workout_exercises_workout       ON workout_exercises (workout_id, position);
CREATE INDEX idx_user_plan_user_position         ON user_plan (user_id, position);
CREATE INDEX idx_workouts_user                   ON workouts (user_id);

-- =============================================================================
-- 1e. RLS — enable on all tables, then per-operation policies
-- =============================================================================

ALTER TABLE exercises                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_template_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_exercises         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_plan                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sets              ENABLE ROW LEVEL SECURITY;

-- System tables: authenticated users can SELECT only
CREATE POLICY "exercises_select" ON exercises
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "workout_templates_select" ON workout_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "workout_template_exercises_select" ON workout_template_exercises
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- user_profiles: owner only (no DELETE in MVP)
CREATE POLICY "user_profiles_select" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "user_profiles_insert" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "user_profiles_update" ON user_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- workouts: owner only
CREATE POLICY "workouts_select" ON workouts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "workouts_insert" ON workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workouts_update" ON workouts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workouts_delete" ON workouts
  FOR DELETE USING (auth.uid() = user_id);

-- workout_exercises: ownership via workouts.user_id
CREATE POLICY "workout_exercises_select" ON workout_exercises
  FOR SELECT USING (auth.uid() = (SELECT user_id FROM workouts WHERE id = workout_id));

CREATE POLICY "workout_exercises_insert" ON workout_exercises
  FOR INSERT WITH CHECK (auth.uid() = (SELECT user_id FROM workouts WHERE id = workout_id));

CREATE POLICY "workout_exercises_update" ON workout_exercises
  FOR UPDATE USING (auth.uid() = (SELECT user_id FROM workouts WHERE id = workout_id))
  WITH CHECK (auth.uid() = (SELECT user_id FROM workouts WHERE id = workout_id));

CREATE POLICY "workout_exercises_delete" ON workout_exercises
  FOR DELETE USING (auth.uid() = (SELECT user_id FROM workouts WHERE id = workout_id));

-- user_plan: owner only
CREATE POLICY "user_plan_select" ON user_plan
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_plan_insert" ON user_plan
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_plan_update" ON user_plan
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_plan_delete" ON user_plan
  FOR DELETE USING (auth.uid() = user_id);

-- workout_sessions: owner only
CREATE POLICY "workout_sessions_select" ON workout_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "workout_sessions_insert" ON workout_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workout_sessions_update" ON workout_sessions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workout_sessions_delete" ON workout_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- workout_sets: ownership via workout_sessions.user_id
CREATE POLICY "workout_sets_select" ON workout_sets
  FOR SELECT USING (auth.uid() = (SELECT user_id FROM workout_sessions WHERE id = workout_session_id));

CREATE POLICY "workout_sets_insert" ON workout_sets
  FOR INSERT WITH CHECK (auth.uid() = (SELECT user_id FROM workout_sessions WHERE id = workout_session_id));

CREATE POLICY "workout_sets_update" ON workout_sets
  FOR UPDATE USING (auth.uid() = (SELECT user_id FROM workout_sessions WHERE id = workout_session_id))
  WITH CHECK (auth.uid() = (SELECT user_id FROM workout_sessions WHERE id = workout_session_id));

CREATE POLICY "workout_sets_delete" ON workout_sets
  FOR DELETE USING (auth.uid() = (SELECT user_id FROM workout_sessions WHERE id = workout_session_id));
