-- =========================================================
-- SECURITY HOTFIX — take the write surface away from `anon`.
--
-- WHAT WAS FOUND
-- --------------
-- The unauthenticated role held INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
-- and TRIGGER on ~106 public tables: 312 DML grants in total. These are
-- Supabase's default privileges, not something anyone chose here.
--
-- IS IT EXPLOITABLE TODAY? NO — AND THAT IS THE POINT
-- ---------------------------------------------------
-- This was checked before writing anything rather than assumed either way.
-- Every public table has RLS enabled (0 without), and the twelve tables
-- carrying a policy that admits `{public}` all have predicates resolving
-- through auth.uid(), which is NULL for anon. So RLS closes it.
--
-- The grant is the second lock being left off. Today RLS is the only thing
-- between an anonymous request and a write; one policy written `USING (true)`
-- on one table — and this project has just finished removing five of those —
-- would be enough. Defence in depth means the grant should not be there to
-- begin with.
--
-- It also closes a real divergence: security_baseline.test.sql asserts "anon
-- has no direct DML grants on public application tables", CI passes it against
-- a fresh Supabase, and production fails it. A test that is green in CI and
-- false in production is worse than no test.
--
-- SELECT IS DELIBERATELY KEPT
-- ---------------------------
-- Only the write privileges go. Revoking anon's SELECT as well would be
-- tidier and riskier: a pre-auth read path — a sign-in screen resolving
-- something, a public page — would fail with a permission error rather than
-- an empty result, and RLS already returns nothing to anon on every table
-- checked. The write surface is where the asymmetry is: nothing in this
-- system is supposed to be written by someone who has not signed in.
--
-- error-ingest is the one unauthenticated write path in the codebase, and it
-- inserts into client_errors as the SERVICE role, which bypasses both RLS and
-- these grants. It is unaffected. This was verified in the function source,
-- not inferred.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Existing tables ============
DO $$
DECLARE _t RECORD; _n INT := 0;
BEGIN
  FOR _t IN
    -- Views and materialised views too, not just tables. An auto-updatable
    -- view is writable, and a view without security_invoker executes with its
    -- OWNER's rights — so a write grant on one is a way round the revoke on
    -- the table beneath it. A first pass covered only 'r' and 'p' and left 192
    -- grants standing.
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  LOOP
    -- All six on every relkind. TRUNCATE and TRIGGER are meaningless on a view
    -- but Postgres records them there anyway, and REVOKE accepts them without
    -- complaint — skipping them for views left 64 grants standing.
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon',
      _t.relname);
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'revoked anon write privileges on % tables', _n;
END $$;

-- Sequences too: nextval without INSERT is useless, but leaving it is the same
-- kind of loose end.
DO $$
DECLARE _s RECORD;
BEGIN
  FOR _s IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE UPDATE ON SEQUENCE public.%I FROM anon', _s.relname);
  END LOOP;
END $$;

-- ============ 2. Tables created from here on ============
-- ALTER DEFAULT PRIVILEGES only governs objects created by the role that runs
-- it. Migrations run as this role, so every future migration's tables are
-- covered; a table created by hand through the dashboard as a different role
-- would not be, which is one more reason out-of-band DDL is a problem in this
-- project. security_baseline.test.sql is the backstop that would catch it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE UPDATE ON SEQUENCES FROM anon;
