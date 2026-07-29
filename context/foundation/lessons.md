# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Grant table privileges explicitly alongside RLS policies

- **Context**: Any Supabase migration that enables RLS on a new table (supabase/migrations/*.sql)
- **Problem**: Postgres checks table-level GRANTs before RLS policies are evaluated. A table with correct RLS policies but no GRANT to authenticated/anon fails every query with 'permission denied for table X' — this caused FlowFit's /dashboard and /onboarding to 500 for every logged-in user in production, since core_schema.sql wrote RLS policies but never issued the accompanying GRANTs.
- **Rule**: Every migration that CREATE TABLEs with RLS enabled must also GRANT the relevant privileges (SELECT/INSERT/UPDATE/DELETE as appropriate) to the roles that need it, scoped to match what the RLS policies allow. Verify with: SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('authenticated','anon') against the linked project before considering the migration complete.
- **Applies to**: plan, implement, impl-review

## Test fixtures must scope every delete to an exact, self-created identifier

- **Context**: Any test fixture or teardown script that uses a service-role/admin client against a local or shared dev Supabase instance (e.g. `tests/e2e/fixtures/seed.ts`, `tests/integration/fixtures/*.ts`)
- **Problem**: A local/dev Supabase database is not exclusive to the test suite — it commonly also holds the developer's own manually-created accounts and data. A fixture that lists users/rows and deletes by anything looser than an exact match on an identifier the fixture itself generated (a prefix match, a "delete all except X", a broad `listUsers()` sweep filtered by a loose condition) risks silently destroying data the developer created by hand, with no warning and no easy recovery.
- **Rule**: Every fixture/teardown delete must be scoped to an exact identifier the fixture itself created and controls (e.g. a full, fixture-specific email string it generated, or a UUID it received back from its own insert/create call) — never a prefix, wildcard, substring, or exclusion-based match. Before trusting a fixture's cleanup logic, verify with the target instance's audit trail (for Supabase: `SELECT * FROM auth.audit_log_entries WHERE payload->>'action' = 'user_deleted' ORDER BY created_at DESC` via `docker exec <db-container> psql -U postgres -d postgres -c "..."`) that only fixture-owned identifiers were ever deleted.
- **Applies to**: plan, implement, impl-review

## Never Prescribe `supabase db reset` to Verify Migrations

- **Context**: Any /10x-plan phase that adds a new file under supabase/migrations/, specifically its 'Automated Verification' checklist step.
- **Problem**: `npx supabase db reset` rebuilds the local Postgres volume from migrations+seed.sql; seed.sql never seeds user accounts, so every manually-registered auth.users row is destroyed. This recurred across multiple plans and even affected a separate git worktree, since the stack is shared (same project_id/ports).
- **Rule**: Future 'Automated Verification' checklists must NOT prescribe `npx supabase db reset` as a migration-verification step; use `npx supabase migration up` instead, which applies only pending migrations without wiping existing data.
- **Applies to**: plan, plan-review
