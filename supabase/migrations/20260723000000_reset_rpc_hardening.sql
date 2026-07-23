-- =============================================================================
-- Harden reset_user_profile and de-duplicate archive-and-clear logic
-- =============================================================================
-- Code review on PR #10 found:
--
-- 1. The "no active workout session" rule was only checked in the Astro API
--    route (src/pages/api/profile/reset.ts) as a separate, non-transactional
--    SELECT before the RPC call. That's racy (a session can start in the gap
--    between the check and the RPC call) and fully bypassable (any
--    authenticated client can call reset_user_profile directly via
--    PostgREST, skipping the route entirely). The rule must be enforced
--    inside the RPC's own transaction to be a real guarantee. The app-layer
--    check stays as a fast-path for a quick error without touching the lock,
--    but it is no longer the only thing enforcing this.
--
-- 2. reset_user_profile and save_generated_training_plan raced: if a reset
--    commits (deleting the profile, archiving the plan) while a concurrent
--    POST /api/plan is mid-Gemini-call (having already passed its own
--    getUserProfile check before the reset happened), save_generated_training_plan
--    had no way to notice the profile was gone and would insert a fresh
--    active plan for a user with zero user_profiles rows -- reproducing the
--    exact stale-plan bug this feature exists to fix. It now re-checks that
--    the profile still exists, inside its own transaction, immediately
--    before writing.
--
-- 3. reset_user_profile and save_generated_training_plan had copy-pasted the
--    same archive-and-clear statements (UPDATE workouts ...; DELETE FROM
--    user_plan ...). Both now call one shared archive_active_plan() function
--    so the two operations can't drift out of sync.
-- =============================================================================

CREATE OR REPLACE FUNCTION archive_active_plan(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE workouts SET is_archived = true, updated_at = now()
    WHERE user_id = p_user_id AND is_archived = false;

  DELETE FROM user_plan WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION archive_active_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_active_plan(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION reset_user_profile(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  IF EXISTS (
    SELECT 1 FROM workout_sessions WHERE user_id = p_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'active_workout_session';
  END IF;

  DELETE FROM user_profiles WHERE id = p_user_id;

  PERFORM archive_active_plan(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION reset_user_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_user_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION save_generated_training_plan(p_user_id uuid, p_workouts jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_workout   jsonb;
  v_exercise  jsonb;
  v_workout_id uuid;
  v_position  smallint := 0;
  v_ex_position smallint;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  IF NOT (p_workouts ? 'workouts') OR jsonb_array_length(p_workouts->'workouts') = 0 THEN
    RAISE EXCEPTION 'workouts payload is empty';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'profile_missing';
  END IF;

  PERFORM archive_active_plan(p_user_id);

  FOR v_workout IN SELECT * FROM jsonb_array_elements(p_workouts->'workouts')
  LOOP
    v_position := v_position + 1;

    INSERT INTO workouts (user_id, name, description, source)
      VALUES (p_user_id, v_workout->>'name', v_workout->>'description', 'ai')
      RETURNING id INTO v_workout_id;

    v_ex_position := 0;
    FOR v_exercise IN SELECT * FROM jsonb_array_elements(v_workout->'exercises')
    LOOP
      v_ex_position := v_ex_position + 1;
      INSERT INTO workout_exercises (workout_id, exercise_id, position, target_sets, target_reps, target_duration_seconds)
        VALUES (
          v_workout_id,
          (v_exercise->>'exercise_id')::uuid,
          v_ex_position,
          (v_exercise->>'target_sets')::smallint,
          (v_exercise->>'target_reps')::smallint,
          (v_exercise->>'target_duration_seconds')::smallint
        );
    END LOOP;

    INSERT INTO user_plan (user_id, workout_id, position)
      VALUES (p_user_id, v_workout_id, v_position);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION save_generated_training_plan(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_generated_training_plan(uuid, jsonb) TO authenticated;
