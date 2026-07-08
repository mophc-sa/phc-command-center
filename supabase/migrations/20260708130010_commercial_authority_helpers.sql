-- =========================================================
-- PHC Sales OS — Phase 1: consolidate role authority in the database.
--
-- Introduces three SECURITY DEFINER helper predicates that mirror the capability
-- groups in src/lib/roles.ts and supabase/functions/_shared/roles.ts, then
-- rewrites the SENSITIVE-action gates (owner protection, role management,
-- approvals, audit visibility) to use them. This is what grants the executive
-- roles (managing_director, general_manager) real commercial authority — until
-- now only 'sales_manager' and legacy 'ceo' were recognised at the DB layer.
--
-- Authority model (kept deliberately separate):
--   * is_commercial_manager  — approve / assign / change commercial state
--                              (executives + sales_manager). NOT system_admin.
--   * is_platform_admin       — administer users / audit visibility
--                              (system_admin + executives + sales_manager).
--   * is_pipeline_operator    — day-to-day pipeline work
--                              (the above + bd_manager + sales_ops).
--
-- Non-destructive: additive functions + in-place policy/trigger replacement.
-- Everyday non-sensitive per-table edit policies are broadened alongside the
-- server-side write move in a later migration (PR B).
-- =========================================================

-- ---- 1. Capability predicates ------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_commercial_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['managing_director','general_manager','ceo','sales_manager']::public.app_role[]
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::public.app_role[]
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pipeline_operator(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['managing_director','general_manager','ceo','sales_manager','bd_manager','sales_ops']::public.app_role[]
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_commercial_manager(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_pipeline_operator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_commercial_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pipeline_operator(uuid) TO authenticated;

-- ---- 2. Owner-protection triggers (opportunity + company owner changes) ------
-- Only a commercial manager may reassign a record owner directly. Salespeople /
-- BD go through the approval flow (sales-os-api). Executives now qualify.
CREATE OR REPLACE FUNCTION public.protect_opportunity_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND auth.uid() IS NOT NULL
     AND NOT public.is_commercial_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only a commercial manager can change the opportunity owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_company_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_owner_id IS DISTINCT FROM OLD.account_owner_id
     AND auth.uid() IS NOT NULL
     AND NOT public.is_commercial_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only a commercial manager can change the account owner';
  END IF;
  RETURN NEW;
END;
$$;

-- ---- 3. Role management (user_roles) — platform admins ------------------------
DROP POLICY IF EXISTS "Managers can view all roles" ON public.user_roles;
CREATE POLICY "Platform admins can view all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can grant roles" ON public.user_roles;
CREATE POLICY "Platform admins can grant roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can revoke roles" ON public.user_roles;
CREATE POLICY "Platform admins can revoke roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- Guardrail: you cannot revoke your OWN commercial-manager/admin role, and the
-- last holder of a commercial-manager role cannot be removed (avoids lockout).
CREATE OR REPLACE FUNCTION public.protect_last_manager()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  remaining INT;
  guarded public.app_role[] := ARRAY[
    'system_admin','managing_director','general_manager','ceo','sales_manager'
  ]::public.app_role[];
BEGIN
  IF OLD.role = ANY(guarded) THEN
    IF OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot revoke your own administrative/manager role';
    END IF;
  END IF;
  -- Never remove the last commercial manager (any executive or sales_manager).
  IF OLD.role IN ('managing_director','general_manager','ceo','sales_manager') THEN
    SELECT COUNT(*) INTO remaining FROM public.user_roles
      WHERE role IN ('managing_director','general_manager','ceo','sales_manager')
        AND id <> OLD.id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last commercial manager account';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

-- ---- 4. Approvals — commercial managers decide; requesters may open ----------
DROP POLICY IF EXISTS "Approvals writable by Manager/CEO" ON public.approvals;
CREATE POLICY "Approvals writable by commercial managers" ON public.approvals FOR ALL TO authenticated
  USING (public.is_commercial_manager(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- ---- 5. Audit log — visible to platform admins -------------------------------
DROP POLICY IF EXISTS "Audit log readable by Manager/CEO" ON public.audit_log;
CREATE POLICY "Audit log readable by platform admins" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
