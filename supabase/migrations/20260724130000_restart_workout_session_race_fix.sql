-- =============================================================================
-- Fix restart_workout_session race on concurrent "Start Over" calls
-- =============================================================================
-- Two near-simultaneous restart calls (double-click, two tabs) can both pass
-- the "existing session is active" check, then race on the final INSERT of
-- the new active session. Without handling, the losing call has already
-- abandoned/deleted the original session before its INSERT fails on the
-- idx_one_active_session_per_workout partial unique index, leaving that
-- request's user with no session at all. Catch unique_violation and fall
-- back to the session the winning call created, mirroring the client-side
-- 23505 fallback already used by createSession() in src/lib/services/session.ts.
-- =============================================================================

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

  BEGIN
    INSERT INTO workout_sessions (user_id, workout_id, status)
      VALUES (p_user_id, p_workout_id, 'active')
      RETURNING id INTO v_new_session_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_new_session_id
      FROM workout_sessions
      WHERE user_id = p_user_id AND workout_id = p_workout_id AND status = 'active';
  END;

  RETURN v_new_session_id;
END;
$$;

REVOKE ALL ON FUNCTION restart_workout_session(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restart_workout_session(uuid, uuid, uuid) TO authenticated;
