-- =========================================================
-- Restrict account creation to @phc-sa.com email addresses
--
-- Applies at the auth.users insert level (BEFORE INSERT), so it covers
-- every path that creates a user — self-signup, invite, admin-created —
-- not just the public signUp() form (which is trivially bypassable if
-- validated client-side only, in src/routes/auth.tsx).
--
-- @phc-playwright.test is explicitly allowlisted: those are the 9 E2E
-- test accounts documented in docs/playwright-test-setup.md and
-- provisioned by 20260713150000_playwright_test_accounts.sql. Blocking
-- that domain would break CI's ability to (re)create test accounts.
--
-- Note: Supabase's GoTrue layer may surface a generic
-- "Database error saving new user" to the client rather than this
-- function's exact message — the signup is still blocked either way.
-- This is a straightforward Postgres trigger, not Supabase's newer
-- "Before User Created" Auth Hook (which would need [auth.hook.*] wiring
-- in supabase/config.toml — skipped here because this project's
-- config.toml currently has no [auth] section at all, i.e. auth is
-- entirely dashboard-managed, and pushing a partial [auth] block via
-- `supabase config push` risks clobbering dashboard settings not
-- mirrored in this repo). This trigger achieves the same outcome
-- without touching that surface.
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
     AND NEW.email !~* '@phc-playwright\.test$' THEN
    RAISE EXCEPTION 'Signup is restricted to @phc-sa.com accounts'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_signup_email_domain ON auth.users;
CREATE TRIGGER trg_enforce_signup_email_domain
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_signup_email_domain();
