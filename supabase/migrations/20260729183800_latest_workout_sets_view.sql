-- =============================================================================
-- Latest workout sets view for optimized pre-fill lookup
-- =============================================================================
-- Implements O(1) row scaling per exercise when fetching the single most
-- recent set per exercise in the user's history, bypassing linear memory scanning.
-- Enforces RLS of underlying tables via security_invoker = true.
-- =============================================================================

CREATE OR REPLACE VIEW latest_workout_sets 
WITH (security_invoker = true) AS
SELECT DISTINCT ON (ws.exercise_id, s.user_id)
  ws.id,
  ws.workout_session_id,
  ws.exercise_id,
  ws.set_number,
  ws.reps,
  ws.weight_kg,
  ws.duration_seconds,
  ws.notes,
  ws.logged_at,
  s.user_id
FROM workout_sets ws
JOIN workout_sessions s ON ws.workout_session_id = s.id
ORDER BY ws.exercise_id, s.user_id, ws.logged_at DESC;

GRANT SELECT ON latest_workout_sets TO authenticated;
GRANT SELECT ON latest_workout_sets TO anon;
