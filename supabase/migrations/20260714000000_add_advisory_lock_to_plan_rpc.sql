-- =============================================================================
-- Serialize concurrent plan generations per user + reject empty payloads
-- =============================================================================
-- A transaction-scoped advisory lock keyed on the user id prevents two
-- overlapping save_generated_training_plan calls (e.g. multi-tab, client
-- retry) from each archiving-and-inserting independently, which could
-- otherwise leave the losing call's new workouts neither archived nor
-- referenced by user_plan. The lock is acquired first so the whole
-- archive/delete/insert sequence runs serialized per user; it auto-releases
-- at transaction end (commit or rollback).
--
-- Also guards against a missing/malformed `workouts` key: jsonb_array_elements
-- silently loops zero times on such input, which previously let a direct RPC
-- call (bypassing the app's Zod validation) archive/clear a user's active
-- plan while inserting nothing.
-- =============================================================================

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

  UPDATE workouts SET is_archived = true, updated_at = now()
    WHERE user_id = p_user_id AND is_archived = false;

  DELETE FROM user_plan WHERE user_id = p_user_id;

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
