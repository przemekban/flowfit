-- Prevent a user from having more than one active session per workout.
-- Partial index so completed/abandoned sessions are not affected.
CREATE UNIQUE INDEX idx_one_active_session_per_workout
  ON workout_sessions (user_id, workout_id)
  WHERE status = 'active';
