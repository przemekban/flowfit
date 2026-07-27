-- =============================================================================
-- Workout session logging support
-- =============================================================================
-- Closes the same reps/duration integrity gap workout_exercises already has
-- (workout_exercises_tracking_xor), adds an index supporting the "most recent
-- set logged for exercise X" pre-fill lookup, and adds an atomic RPC for the
-- "Start Over" flow (abandon-or-delete the existing active session, then
-- create a new one), following the save_generated_training_plan precedent so
-- Postgres's implicit per-call transaction gives atomicity for free.
-- =============================================================================

ALTER TABLE workout_sets
  ADD CONSTRAINT workout_sets_tracking_xor CHECK (
    (reps IS NOT NULL AND duration_seconds IS NULL) OR
    (reps IS NULL AND duration_seconds IS NOT NULL)
  );

CREATE INDEX idx_workout_sets_exercise_logged ON workout_sets (exercise_id, logged_at DESC);

CREATE OR REPLACE FUNCTION restart_workout_session(p_user_id uuid, p_existing_session_id uuid, p_workout_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_status workout_status_enum;
  v_set_count       integer;
  v_new_session_id  uuid;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  SELECT status INTO v_existing_status
    FROM workout_sessions
    WHERE id = p_existing_session_id AND user_id = p_user_id AND workout_id = p_workout_id;

  IF v_existing_status IS NULL THEN
    RAISE EXCEPTION 'existing session not found for this user/workout';
  END IF;

  IF v_existing_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'existing session is not active';
  END IF;

  SELECT count(*) INTO v_set_count FROM workout_sets WHERE workout_session_id = p_existing_session_id;

  IF v_set_count = 0 THEN
    DELETE FROM workout_sessions WHERE id = p_existing_session_id;
  ELSE
    UPDATE workout_sessions SET status = 'abandoned' WHERE id = p_existing_session_id;
  END IF;

  INSERT INTO workout_sessions (user_id, workout_id, status)
    VALUES (p_user_id, p_workout_id, 'active')
    RETURNING id INTO v_new_session_id;

  RETURN v_new_session_id;
END;
$$;

REVOKE ALL ON FUNCTION restart_workout_session(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restart_workout_session(uuid, uuid, uuid) TO authenticated;
