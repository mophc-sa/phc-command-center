-- =========================================================
-- Restrict account emails to @phc-sa.com — creation AND changes
--
-- Applies at the auth.users row level, both BEFORE INSERT and
-- BEFORE UPDATE OF email, so it covers every path that sets or changes
-- a user's email — self-signup, invite, admin-created, AND a later
-- self-service email change via supabase.auth.updateUser({ email }).
-- That last path matters: GoTrue implements email changes as an
-- UPDATE on auth.users (not an INSERT), and it's a generic
-- client-callable Supabase Auth API available to any authenticated
-- session — not gated by any app UI. An INSERT-only trigger would
-- stop new external-domain signups but let an existing @phc-sa.com
-- account move its email to any external domain afterward. Not just
-- the public signUp() form either (which is trivially bypassable if
-- validated client-side only, in src/routes/auth.tsx).
--
-- @phc-playwright.test is explicitly allowlisted: those are the 9 E2E
-- test accounts documented in docs/playwright-test-setup.md and
-- provisioned by 20260713150000_playwright_test_accounts.sql. Blocking
-- that domain would break CI's ability to (re)create test accounts.
--
-- @phc-local.test is also allowlisted: it's the fixture domain used by
-- supabase/tests/rls_role_matrix.test.sql (pgTAP), which inserts five
-- synthetic auth.users rows directly to exercise the RLS role matrix.
-- Blocking it fails that suite's setup outright (28/28 subtests never
-- run) — confirmed by running it against this trigger.
--
-- Note: Supabase's GoTrue layer may surface a generic
-- "Database error saving new user" (or "...updating user") to the
-- client rather than this function's exact message — the write is
-- still blocked either way. This is a straightforward Postgres
-- trigger, not Supabase's newer "Before User Created" Auth Hook
-- (which would need [auth.hook.*] wiring in supabase/config.toml —
-- skipped here because this project's config.toml currently has no
-- [auth] section at all, i.e. auth is entirely dashboard-managed, and
-- pushing a partial [auth] block via `supabase config push` risks
-- clobbering dashboard settings not mirrored in this repo). This
-- trigger achieves the same outcome without touching that surface —
-- and unlike the Auth Hook, a plain trigger with `UPDATE OF email`
-- naturally covers email changes too, not just creation.
-- =========================================================

CREATE OR REPLACE FUNCTION public.enforce_signup_email_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email !~* '@phc-sa\.com$'
     AND NEW.email !~* '@phc-playwright\.test$'
     AND NEW.email !~* '@phc-local\.test$' THEN
    RAISE EXCEPTION 'Account email must be an @phc-sa.com address'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_signup_email_domain ON auth.users;
CREATE TRIGGER trg_enforce_signup_email_domain
  BEFORE INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_signup_email_domain();
