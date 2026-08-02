-- =========================================================
-- Fixes two gaps found while renaming the Playwright test accounts to
-- +test@phc-sa.com sub-addresses in production (2026-08-02):
--
-- 1. public.profiles.email does not auto-sync when auth.users.email is
--    renamed via the Admin API (no UPDATE OF email trigger exists for
--    that direction) — the previous migration's `WHERE email = '...'`
--    lookups against public.profiles silently matched zero rows for every
--    renamed account until profiles.email was corrected by hand. This
--    migration re-syncs profiles.email from auth.users for the 10 known
--    Playwright accounts so a fresh `supabase db reset` (which creates
--    auth.users rows with the correct email from the start) and this
--    migration both leave the same end state as production.
--
-- 2. pw-sales-ops@phc-playwright.test exists in production (added after
--    the original 20260713150000_playwright_test_accounts.sql, which only
--    covered 9 roles) but was missed by 20260802130100's port to
--    +test@phc-sa.com. Documented now in docs/playwright-test-setup.md too.
-- =========================================================

DO $$
DECLARE
  _uid uuid;
BEGIN
  -- Re-sync profiles.email from auth.users for every already-renamed
  -- Playwright account (harmless no-op once they already match).
  UPDATE public.profiles p
  SET email = u.email
  FROM auth.users u
  WHERE p.id = u.id
    AND u.email LIKE 'pw-%+test@phc-sa.com'
    AND p.email IS DISTINCT FROM u.email;

  -- sales_ops (missed by 20260802130100)
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-sales-ops+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-sales-ops+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Sales Ops'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Sales Ops');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'sales_ops')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-sales-ops+test@phc-sa.com provisioned (sales_ops, active).';
  END IF;
END $$;
