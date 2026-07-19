-- =========================================================
-- Phase B Completion: Replace last two raw-role-array RLS policies
--
-- Problem:
--   Two policies survived both the commercial_authority_helpers migration
--   (20260708130010) and the ceo_rls_cleanup migration (20260713120000):
--
--   1. communication_templates — "Communication templates editable by managers"
--      Used ARRAY['system_admin','managing_director','general_manager',
--                 'ceo','sales_manager','bd_manager']
--      Excludes: sales_ops (pipeline operator)
--
--   2. profiles — "Admins can update any profile"
--      Used ARRAY['system_admin','managing_director','general_manager',
--                 'ceo','sales_manager']
--      This is the exact definition of is_platform_admin().
--
-- Fix:
--   Replace both with the existing SECURITY DEFINER capability predicates
--   so future role additions only require updating the predicate function,
--   not hunting RLS policies.
--
-- Predicate reference (20260708130010_commercial_authority_helpers.sql):
--   is_platform_admin  → system_admin, managing_director, general_manager,
--                        ceo, sales_manager
--   is_pipeline_operator → managing_director, general_manager, ceo,
--                          sales_manager, bd_manager, sales_ops
--
-- Tables touched: communication_templates, profiles
-- =========================================================

-- -------------------------------------------------------
-- COMMUNICATION TEMPLATES
-- -------------------------------------------------------
-- Old array: ['system_admin','managing_director','general_manager',
--             'ceo','sales_manager','bd_manager']
-- Maps to: is_pipeline_operator (covers managing_director, general_manager,
--          ceo, sales_manager, bd_manager, sales_ops)
--          + system_admin separately (not in is_pipeline_operator).
DROP POLICY IF EXISTS "Communication templates editable by managers" ON public.communication_templates;
CREATE POLICY "Communication templates editable by pipeline operator" ON public.communication_templates
  FOR ALL TO authenticated
  USING (
    public.is_pipeline_operator(auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[])
  )
  WITH CHECK (
    public.is_pipeline_operator(auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[])
  );

-- -------------------------------------------------------
-- PROFILES
-- -------------------------------------------------------
-- Old array: ['system_admin','managing_director','general_manager',
--             'ceo','sales_manager']
-- Exact match for is_platform_admin().
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING  (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));
