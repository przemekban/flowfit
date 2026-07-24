-- =============================================================================
-- Transactional Reset RPC for profile reset
-- =============================================================================
-- A plain client-side DELETE on user_profiles (added in
-- 20260717000000_add_user_profiles_delete_policy.sql) is not enough: the
-- dashboard only renders PlanGenerator (the sole entry point that triggers
-- save_generated_training_plan) when the user has no active plan. Deleting
-- only the profile row leaves the old plan active, so after retaking the
-- survey the user is stuck viewing their stale plan with no way to trigger a
-- new one. Reset must therefore also archive the active plan, using the same
-- archive-and-clear statements save_generated_training_plan already uses, in
-- the same atomic transaction as the profile delete.
--
-- Same advisory lock pattern as save_generated_training_plan (keyed on
-- p_user_id) guards against a concurrent generation call (e.g. a second tab)
-- interleaving with this reset.
-- =============================================================================

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

  DELETE FROM user_profiles WHERE id = p_user_id;

  UPDATE workouts SET is_archived = true, updated_at = now()
    WHERE user_id = p_user_id AND is_archived = false;

  DELETE FROM user_plan WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION reset_user_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_user_profile(uuid) TO authenticated;
