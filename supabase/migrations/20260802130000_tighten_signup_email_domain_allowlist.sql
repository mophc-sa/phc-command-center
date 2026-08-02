-- =========================================================
-- Tighten account-email allowlist to @phc-sa.com only
-- (2026-08-02 security hardening request).
--
-- Removes the @phc-playwright.test and @phc-local.test carve-outs added by
-- 20260721110000_restrict_signup_email_domain.sql. Both test suites that
-- depended on those domains have been migrated to +tag@phc-sa.com
-- sub-addresses instead (same regex, no carve-out needed):
--   - supabase/tests/rls_role_matrix.test.sql now seeds
--     rls2-*+test@phc-sa.com synthetic auth.users rows.
--   - The 9 Playwright E2E accounts (docs/playwright-test-setup.md,
--     20260713150000_playwright_test_accounts.sql) are renamed to
--     pw-*+test@phc-sa.com — a manual Dashboard step (see
--     20260802130100_playwright_test_accounts_phc_sa_domain.sql), since
--     account creation/renaming for this project has always been a human
--     step, never a migration (raw SQL writes to auth.users are not used
--     for production account management here).
--
-- This only affects future INSERT / UPDATE OF email on auth.users — it does
-- not touch any existing row, so already-provisioned accounts (including
-- not-yet-renamed @phc-playwright.test / @phc-local.test test accounts)
-- keep signing in without interruption until they're renamed.
-- =========================================================

CREATE OR REPLACE FUNCTION public.enforce_signup_email_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email !~* '@phc-sa\.com$' THEN
    RAISE EXCEPTION 'Account email must be an @phc-sa.com address'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
