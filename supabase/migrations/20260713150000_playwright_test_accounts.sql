-- =========================================================
-- Playwright test account provisioning
--
-- PRE-CONDITION (human step — must be done before applying):
--   Create all 9 accounts in Supabase Dashboard →
--   Authentication → Users → Create new user (email + password,
--   no email confirmation required). Use the emails and a strong
--   random password; store the password in GitHub Actions secrets
--   per docs/playwright-test-setup.md.
--
-- Account roster (all at pw-*@phc-playwright.test):
--   pw-system-admin        → role: system_admin      status: active
--   pw-managing-director   → role: managing_director status: active
--   pw-general-manager     → role: general_manager   status: active
--   pw-sales-manager       → role: sales_manager     status: active
--   pw-bd-manager          → role: bd_manager        status: active
--   pw-salesperson         → role: salesperson       status: active
--   pw-viewer              → role: viewer            status: active
--   pw-pending             → NO role               status: pending_approval
--   pw-suspended           → NO role               status: suspended
--
-- Safe to re-run — idempotent throughout (ON CONFLICT DO NOTHING,
-- UPDATE only when value differs). Skips any account not yet created.
-- =========================================================

DO $$
DECLARE
  _uid uuid;
BEGIN

  -- ── Helper: activate + role-grant ─────────────────────────────────────────
  -- For active role accounts

  -- system_admin
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-system-admin@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-system-admin not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW System Admin'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW System Admin');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'system_admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-system-admin provisioned (system_admin, active).';
  END IF;

  -- managing_director
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-managing-director@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-managing-director not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Managing Director'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Managing Director');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'managing_director')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-managing-director provisioned (managing_director, active).';
  END IF;

  -- general_manager
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-general-manager@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-general-manager not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW General Manager'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW General Manager');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'general_manager')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-general-manager provisioned (general_manager, active).';
  END IF;

  -- sales_manager
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-sales-manager@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-sales-manager not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Sales Manager'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Sales Manager');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'sales_manager')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-sales-manager provisioned (sales_manager, active).';
  END IF;

  -- bd_manager
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-bd-manager@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-bd-manager not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW BD Manager'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW BD Manager');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'bd_manager')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-bd-manager provisioned (bd_manager, active).';
  END IF;

  -- salesperson
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-salesperson@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-salesperson not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Salesperson'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Salesperson');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'salesperson')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-salesperson provisioned (salesperson, active).';
  END IF;

  -- viewer
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-viewer@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-viewer not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'active', full_name = 'PW Viewer'
      WHERE id = _uid AND (status <> 'active' OR full_name IS DISTINCT FROM 'PW Viewer');
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'viewer')
      ON CONFLICT (user_id, role) DO NOTHING;
    RAISE NOTICE 'Playwright test: pw-viewer provisioned (viewer, active).';
  END IF;

  -- ── Status-quarantine accounts (no role granted) ───────────────────────────

  -- pending — stays at pending_approval (Sprint 1B default); no role
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-pending@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-pending not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'pending_approval', full_name = 'PW Pending User'
      WHERE id = _uid AND (status <> 'pending_approval' OR full_name IS DISTINCT FROM 'PW Pending User');
    -- Ensure no stale role rows exist for this test account
    DELETE FROM public.user_roles WHERE user_id = _uid;
    RAISE NOTICE 'Playwright test: pw-pending provisioned (no role, pending_approval).';
  END IF;

  -- suspended — status = suspended; no role
  SELECT id INTO _uid FROM public.profiles
    WHERE email = 'pw-suspended@phc-playwright.test' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'Playwright test: pw-suspended not found — create via Supabase Dashboard.';
  ELSE
    UPDATE public.profiles SET status = 'suspended', full_name = 'PW Suspended User'
      WHERE id = _uid AND (status <> 'suspended' OR full_name IS DISTINCT FROM 'PW Suspended User');
    DELETE FROM public.user_roles WHERE user_id = _uid;
    RAISE NOTICE 'Playwright test: pw-suspended provisioned (no role, suspended).';
  END IF;

END $$;

-- ── Verification query ────────────────────────────────────────────────────────
-- Run after applying to confirm all 9 accounts are correctly provisioned.
--
-- SELECT p.email, p.full_name, p.status,
--        coalesce(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
-- FROM public.profiles p
-- LEFT JOIN public.user_roles ur ON ur.user_id = p.id
-- WHERE p.email LIKE '%@phc-playwright.test'
-- GROUP BY p.email, p.full_name, p.status
-- ORDER BY p.email;
--
-- Expected output:
--   pw-bd-manager@...        | PW BD Manager         | active           | {bd_manager}
--   pw-general-manager@...   | PW General Manager    | active           | {general_manager}
--   pw-managing-director@... | PW Managing Director  | active           | {managing_director}
--   pw-pending@...           | PW Pending User       | pending_approval | {}
--   pw-salesperson@...       | PW Salesperson        | active           | {salesperson}
--   pw-sales-manager@...     | PW Sales Manager      | active           | {sales_manager}
--   pw-suspended@...         | PW Suspended User     | suspended        | {}
--   pw-system-admin@...      | PW System Admin       | active           | {system_admin}
--   pw-viewer@...            | PW Viewer             | active           | {viewer}
