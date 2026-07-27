-- =========================================================
-- Sales data isolation — client spec (2026-07-27, "متطلبات الصلاحيات
-- وعزل بيانات المبيعات"): a salesperson must only see their own
-- accounts/RFQs/tenders and personal performance data, never another
-- rep's. Confirmed with the user: this applies to opportunities, RFQs,
-- tenders, quotations, and follow-ups (the actual deal/pipeline records) —
-- NOT companies/contacts, which stay org-wide readable so duplicate-
-- detection when creating a new record keeps working (isolating the
-- shared company/contact directory would make it impossible for one rep
-- to know a company was already entered by another, defeating the
-- system's existing dedup safeguards).
--
-- "Department" scoping from the spec has no existing concept in this
-- schema at all (no teams/departments table) — there is a single flat
-- sales org today, so every role the spec names as seeing aggregate data
-- (system_admin, sales_manager, bd_manager, general_manager/managing_
-- director/ceo) simply sees everything, matching how commercial authority
-- already works everywhere else in this codebase (is_commercial_manager,
-- is_platform_admin). sales_ops and finance_manager are also included
-- here (not explicitly named in the spec's aggregate-visibility list,
-- which was about management dashboards specifically) because they
-- already have — and must keep — full pipeline visibility to do their
-- existing job (sales_ops assists across the whole pipeline today;
-- finance_manager must be able to reach any RFQ to set its Total Value,
-- the very capability this same request grants them).
-- =========================================================

CREATE OR REPLACE FUNCTION public.can_view_all_sales_data(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY[
      'system_admin', 'managing_director', 'general_manager', 'ceo',
      'sales_manager', 'bd_manager', 'sales_ops', 'finance_manager'
    ]::public.app_role[]
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_all_sales_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_all_sales_data(uuid) TO authenticated;

DROP POLICY IF EXISTS "Opportunities readable by any authenticated" ON public.opportunities;
CREATE POLICY "Opportunities readable by owner or manager" ON public.opportunities
  FOR SELECT TO authenticated
  USING (
    public.is_active_user((SELECT auth.uid()))
    AND (owner_id = (SELECT auth.uid()) OR public.can_view_all_sales_data((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "RFQs readable" ON public.rfqs;
CREATE POLICY "RFQs readable by owner or manager" ON public.rfqs
  FOR SELECT TO authenticated
  USING (
    public.is_active_user((SELECT auth.uid()))
    AND (sales_owner_id = (SELECT auth.uid()) OR public.can_view_all_sales_data((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "Tenders readable" ON public.tenders;
CREATE POLICY "Tenders readable by owner or manager" ON public.tenders
  FOR SELECT TO authenticated
  USING (
    public.is_active_user((SELECT auth.uid()))
    AND (tender_owner_id = (SELECT auth.uid()) OR public.can_view_all_sales_data((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "Quotations readable" ON public.quotations;
CREATE POLICY "Quotations readable by owner or manager" ON public.quotations
  FOR SELECT TO authenticated
  USING (
    public.is_active_user((SELECT auth.uid()))
    AND (owner_id = (SELECT auth.uid()) OR public.can_view_all_sales_data((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "Follow-ups readable" ON public.follow_ups;
CREATE POLICY "Follow-ups readable by owner or manager" ON public.follow_ups
  FOR SELECT TO authenticated
  USING (
    public.is_active_user((SELECT auth.uid()))
    AND (owner_id = (SELECT auth.uid()) OR public.can_view_all_sales_data((SELECT auth.uid())))
  );
