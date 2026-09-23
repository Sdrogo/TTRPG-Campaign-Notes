-- The parts of a Supabase database that this project's migrations rely on,
-- recreated on a plain Postgres so CI can run the whole test suite against a
-- throwaway database instead of the live project. Applied once, before
-- `alembic upgrade head` (see .github/workflows/ci.yml).
--
-- Only what the migrations touch is mirrored. A new migration that reaches
-- further into Supabase (another `auth` column, the `storage` schema, ...)
-- fails CI here first, and belongs in this file too.

-- The Data API roles. Migrations c9d4e7b1f352 and f1c8a2e6d493 revoke from
-- and deny them, and tests/test_database_security.py checks the result.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

-- Supabase grants every new table in `public` to those roles by default.
-- Mirrored so the early migrations create tables that really are exposed,
-- and the lockdown migration has real grants to revoke - otherwise the
-- security tests would pass on a database that was never open to begin with.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated;

-- Supabase Auth's user table, reduced to the columns the migrations use:
-- 4ebaee6990ba adds (later dropped) foreign keys to `id`, d3e8a1f4c2b7
-- backfills `email`, and e5a3b8d2c671 drops a trigger on the table.
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email varchar(255)
);
