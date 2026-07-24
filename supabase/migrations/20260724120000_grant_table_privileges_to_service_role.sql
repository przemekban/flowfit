-- =============================================================================
-- Grant table privileges to service_role
-- =============================================================================
-- service_role bypasses RLS (BYPASSRLS) but Postgres still checks table-level
-- GRANTs before RLS is even evaluated — same class of bug as the missing
-- `authenticated` grants documented in lessons.md. A freshly-provisioned
-- Supabase instance (e.g. CI's `supabase start`) grants service_role no
-- privileges on tables created by app migrations, so any service_role client
-- (admin scripts, the E2E seed fixture) fails with "permission denied for
-- table ..." even though service_role is meant to have full access.
-- =============================================================================

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
