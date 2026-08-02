-- =========================================================
-- Playwright test account provisioning — @phc-sa.com sub-addresses
--
-- Companion to 20260713150000_playwright_test_accounts.sql, updated for the
-- 2026-08-02 domain-allowlist tightening: the @phc-playwright.test domain
-- is no longer allowed, so the 9 E2E accounts move to pw-*+test@phc-sa.com
-- (a "+"-tagged sub-address of the same allowed domain — no trigger
-- carve-out needed).
--
-- PRE-CONDITION (human step — must be done before this has any effect):
--   In Supabase Dashboard → Authentication → Users, rename each existing
--   pw-*@phc-playwright.test account's email to the matching
--   pw-*+test@phc-sa.com address below (Edit user → Email). Do NOT delete
--   and recreate — renaming preserves the user id, so pinned/owned test
--   fixtures and GitHub Actions secret UUID references keep working.
--   Then update the TEST_*_EMAIL GitHub Actions secrets to match.
--
-- Safe to re-run — idempotent throughout, and a no-op (only RAISE NOTICE)
-- for any account not yet renamed.
-- =========================================================

DO $$
DECLARE
  _uid uuid;
BEGIN

  -- system_admin
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-system-admin+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-system-admin+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW System Admin'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW System Admin');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'system_admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-system-admin+test@phc-sa.com provisioned (system_admin, active).';
  END IF;

  -- managing_director
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-managing-director+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-managing-director+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Managing Director'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Managing Director');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'managing_director')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-managing-director+test@phc-sa.com provisioned (managing_director, active).';
  END IF;

  -- general_manager
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-general-manager+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-general-manager+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW General Manager'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW General Manager');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'general_manager')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-general-manager+test@phc-sa.com provisioned (general_manager, active).';
  END IF;

  -- sales_manager
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-sales-manager+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-sales-manager+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Sales Manager'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Sales Manager');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'sales_manager')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-sales-manager+test@phc-sa.com provisioned (sales_manager, active).';
  END IF;

  -- bd_manager
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-bd-manager+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-bd-manager+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW BD Manager'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW BD Manager');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'bd_manager')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-bd-manager+test@phc-sa.com provisioned (bd_manager, active).';
  END IF;

  -- salesperson
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-salesperson+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-salesperson+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Salesperson'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Salesperson');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'salesperson')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-salesperson+test@phc-sa.com provisioned (salesperson, active).';
  END IF;

  -- viewer
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-viewer+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-viewer+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Viewer'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Viewer');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'viewer')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-viewer+test@phc-sa.com provisioned (viewer, active).';
  END IF;

  -- ── Status-quarantine accounts (no role granted) ───────────────────────────

  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-pending+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-pending+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'pending_approval', full_name = 'PW Pending User'
      WHERE id = _uid AND (status <> 'pending_approval' OR full_name IS DISTINCT FROM 'PW Pending User');
    DELETE FROM public.user_roles WHERE user_id = _uid;
    RAISE NOTICE 'Playwright test: pw-pending+test@phc-sa.com provisioned (no role, pending_approval).';
  END IF;

  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-suspended+test@phc-sa.com' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-suspended+test@phc-sa.com not found — rename via Supabase Dashboard first.';
  ELSE
    UPDATE public.profiles SET status = 'suspended', full_name = 'PW Suspended User'
      WHERE id = _uid AND (status <> 'suspended' OR full_name IS DISTINCT FROM 'PW Suspended User');
    DELETE FROM public.user_roles WHERE user_id = _uid;
    RAISE NOTICE 'Playwright test: pw-suspended+test@phc-sa.com provisioned (no role, suspended).';
  END IF;

END $$;
