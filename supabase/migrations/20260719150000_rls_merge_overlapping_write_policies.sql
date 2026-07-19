-- =========================================================
-- Merge remaining overlapping permissive policies (PERF)
--
-- After the previous split of FOR ALL policies, four tables
-- still have multiple permissive policies for the same command:
--
--   boq_items   — two pipeline-operator + two sales-team
--                 INSERT/UPDATE/DELETE policies (can be unioned)
--   stakeholders — same pattern as boq_items
--   profiles    — two UPDATE policies: own-row + admin-any
--   user_roles  — two SELECT policies: own-rows + admin-all
--
-- approvals INSERT (salesperson vs pipeline operator) is left as
-- two policies intentionally: the salesperson INSERT has
-- tighter WITH CHECK constraints (status=pending, self-authored)
-- that can't be safely collapsed into the manager INSERT.
-- =========================================================

-- ---- boq_items -------------------------------------------------------
-- Merge "pipeline operator" and "sales team" INSERT/UPDATE/DELETE
-- into single policies covering both role groups.

DROP POLICY IF EXISTS "BOQ items editable by pipeline operator — insert" ON public.boq_items;
DROP POLICY IF EXISTS "BOQ items editable by sales team — insert"        ON public.boq_items;
CREATE POLICY "BOQ items editable by sales team or pipeline operator — insert"
  ON public.boq_items FOR INSERT TO authenticated
  WITH CHECK (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  );

DROP POLICY IF EXISTS "BOQ items editable by pipeline operator — update" ON public.boq_items;
DROP POLICY IF EXISTS "BOQ items editable by sales team — update"        ON public.boq_items;
CREATE POLICY "BOQ items editable by sales team or pipeline operator — update"
  ON public.boq_items FOR UPDATE TO authenticated
  USING (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  )
  WITH CHECK (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  );

DROP POLICY IF EXISTS "BOQ items editable by pipeline operator — delete" ON public.boq_items;
DROP POLICY IF EXISTS "BOQ items editable by sales team — delete"        ON public.boq_items;
CREATE POLICY "BOQ items editable by sales team or pipeline operator — delete"
  ON public.boq_items FOR DELETE TO authenticated
  USING (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  );

-- ---- stakeholders ----------------------------------------------------

DROP POLICY IF EXISTS "Stakeholders editable by pipeline operator — insert" ON public.stakeholders;
DROP POLICY IF EXISTS "Stakeholders editable by sales team — insert"        ON public.stakeholders;
CREATE POLICY "Stakeholders editable by sales team or pipeline operator — insert"
  ON public.stakeholders FOR INSERT TO authenticated
  WITH CHECK (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  );

DROP POLICY IF EXISTS "Stakeholders editable by pipeline operator — update" ON public.stakeholders;
DROP POLICY IF EXISTS "Stakeholders editable by sales team — update"        ON public.stakeholders;
CREATE POLICY "Stakeholders editable by sales team or pipeline operator — update"
  ON public.stakeholders FOR UPDATE TO authenticated
  USING (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  )
  WITH CHECK (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  );

DROP POLICY IF EXISTS "Stakeholders editable by pipeline operator — delete" ON public.stakeholders;
DROP POLICY IF EXISTS "Stakeholders editable by sales team — delete"        ON public.stakeholders;
CREATE POLICY "Stakeholders editable by sales team or pipeline operator — delete"
  ON public.stakeholders FOR DELETE TO authenticated
  USING (
    is_pipeline_operator((select auth.uid()))
    OR has_any_role((select auth.uid()),
         ARRAY['salesperson'::app_role, 'bd_manager'::app_role,
               'sales_manager'::app_role, 'ceo'::app_role])
  );

-- ---- profiles UPDATE -------------------------------------------------
-- Merge "own profile" + "admin any profile" into one UPDATE policy.

DROP POLICY IF EXISTS "Users update own profile"       ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile"  ON public.profiles;
CREATE POLICY "Users update own profile or admins update any"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    (id = (select auth.uid()))
    OR is_platform_admin((select auth.uid()))
  )
  WITH CHECK (
    (id = (select auth.uid()))
    OR is_platform_admin((select auth.uid()))
  );

-- ---- user_roles SELECT -----------------------------------------------
-- Merge "own roles" + "admin view all" into one SELECT policy.

DROP POLICY IF EXISTS "Users can view their own roles"     ON public.user_roles;
DROP POLICY IF EXISTS "Platform admins can view all roles" ON public.user_roles;
CREATE POLICY "Users view own roles or admins view all"
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    (user_id = (select auth.uid()))
    OR is_platform_admin((select auth.uid()))
  );
