# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Grant table privileges explicitly alongside RLS policies

- **Context**: Any Supabase migration that enables RLS on a new table (supabase/migrations/*.sql)
- **Problem**: Postgres checks table-level GRANTs before RLS policies are evaluated. A table with correct RLS policies but no GRANT to authenticated/anon fails every query with 'permission denied for table X' — this caused FlowFit's /dashboard and /onboarding to 500 for every logged-in user in production, since core_schema.sql wrote RLS policies but never issued the accompanying GRANTs.
- **Rule**: Every migration that CREATE TABLEs with RLS enabled must also GRANT the relevant privileges (SELECT/INSERT/UPDATE/DELETE as appropriate) to the roles that need it, scoped to match what the RLS policies allow. Verify with: SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('authenticated','anon') against the linked project before considering the migration complete.
- **Applies to**: plan, implement, impl-review
