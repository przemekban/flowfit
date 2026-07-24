-- =============================================================================
-- Allow a user to delete their own user_profiles row (profile reset)
-- =============================================================================
-- core_schema.sql intentionally omitted DELETE on user_profiles ("owner only,
-- no DELETE in MVP"). This migration adds it to support the profile reset
-- flow (GitHub issue #9 / OQ-001). Per the GRANT-alongside-RLS lesson, the
-- policy and its GRANT ship together in one migration.
-- =============================================================================

CREATE POLICY "user_profiles_delete" ON user_profiles
  FOR DELETE USING (auth.uid() = id);

GRANT DELETE ON user_profiles TO authenticated;
