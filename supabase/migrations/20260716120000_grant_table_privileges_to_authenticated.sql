-- =============================================================================
-- Grant base table privileges to authenticated
-- =============================================================================
-- core_schema.sql enabled RLS and wrote per-operation policies on every table
-- but never issued the accompanying GRANTs. Postgres checks table-level
-- privileges before RLS policies are evaluated, so every authenticated query
-- against these tables failed with "permission denied for table ..." in
-- production regardless of how correct the RLS policies were. Grants below
-- mirror what each table's existing policies already allow.
-- =============================================================================

GRANT SELECT ON exercises, workout_templates, workout_template_exercises TO authenticated;

GRANT SELECT, INSERT, UPDATE ON user_profiles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON workouts, workout_exercises, user_plan, workout_sessions, workout_sets TO authenticated;
