-- =============================================================================
-- Cross-session exercise-bests RPC (FR-012 / S-05 progress indicators)
-- =============================================================================
-- Returns, per exercise, the best aggregated value from the most recent prior
-- completed/abandoned session (excluding a given reference session). Backs the
-- "Improved" badge on both the history screen (excludes the newest session
-- itself) and the active session screen (excludes the not-yet-completed
-- session, a no-op since it never matches status IN ('completed','abandoned')).
-- =============================================================================

CREATE OR REPLACE FUNCTION get_previous_exercise_bests(p_exercise_ids uuid[], p_before_session_id uuid)
RETURNS TABLE (exercise_id uuid, best_weight_kg decimal(6,2), best_duration_seconds smallint)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH ranked AS (
    SELECT
      ws.exercise_id,
      s.id AS session_id,
      MAX(ws.weight_kg) AS best_weight_kg,
      MAX(ws.duration_seconds) AS best_duration_seconds,
      ROW_NUMBER() OVER (
        PARTITION BY ws.exercise_id
        ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
      ) AS rn
    FROM workout_sets ws
    JOIN workout_sessions s ON s.id = ws.workout_session_id
    WHERE s.user_id = auth.uid()
      AND s.status IN ('completed', 'abandoned')
      AND s.id <> p_before_session_id
      AND ws.exercise_id = ANY(p_exercise_ids)
    GROUP BY ws.exercise_id, s.id, s.completed_at, s.started_at
  )
  SELECT exercise_id, best_weight_kg, best_duration_seconds
  FROM ranked
  WHERE rn = 1;
$$;

REVOKE ALL ON FUNCTION get_previous_exercise_bests(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_previous_exercise_bests(uuid[], uuid) TO authenticated;
