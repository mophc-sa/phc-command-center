-- Grants Development Manager (bd_manager) and System Administrator
-- (system_admin) full add/edit authority on the core CRM record tables at
-- the RLS layer, matching the client-side capability already granted via
-- src/lib/roles.ts's canCreateSalesRecords/canManageSalesPipeline.
--
-- Two gaps existed before this migration:
--   1. system_admin was completely absent from every INSERT/UPDATE policy
--      on companies/contacts/projects/opportunities. The frontend never
--      hid create/edit buttons from system_admin (no role check there),
--      so a system_admin user could open the form and submit, but the
--      write would silently fail at the RLS layer.
--   2. bd_manager was missing specifically from opportunities' UPDATE
--      policy (present on INSERT, and on every other core table's
--      INSERT+UPDATE), an inconsistency relative to its own INSERT grant.
--
-- Hard-delete authority is NOT touched here: DELETE was already fully
-- REVOKEd from `authenticated` on every one of these tables by
-- 20260711160000_rbac_record_lifecycle_hardening.sql, which deliberately
-- funnels all deletion through the governed request_delete -> decide_approval
-- -> execute_delete Edge Function flow (service-role, bypasses RLS). That
-- flow's role gates live in application code
-- (src/lib/roles.ts / supabase/functions/_shared/roles.ts), not RLS, and are
-- updated separately alongside this migration.

-- ---- companies --------------------------------------------------------
DROP POLICY IF EXISTS "Companies insertable by sales team" ON public.companies;
CREATE POLICY "Companies insertable by sales team" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo','system_admin']::public.app_role[]));

DROP POLICY IF EXISTS "Companies updatable by owner or BD/Manager" ON public.companies;
CREATE POLICY "Companies updatable by owner or BD/Manager" ON public.companies FOR UPDATE TO authenticated
  USING (account_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]))
  WITH CHECK (account_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]));

-- ---- contacts -----------------------------------------------------------
DROP POLICY IF EXISTS "Contacts insertable by sales team" ON public.contacts;
CREATE POLICY "Contacts insertable by sales team" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo','system_admin']::public.app_role[]));

DROP POLICY IF EXISTS "Contacts updatable by owner or BD/Manager" ON public.contacts;
CREATE POLICY "Contacts updatable by owner or BD/Manager" ON public.contacts FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]));

-- ---- projects -------------------------------------------------------------
-- Was role-based via is_sales_contributor(); add system_admin alongside it
-- rather than editing that shared helper (used elsewhere for narrower
-- "sales contributor" semantics that should not silently pick up
-- system_admin as a side effect).
DROP POLICY IF EXISTS "Projects insertable by sales team" ON public.projects;
CREATE POLICY "Projects insertable by sales team" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));

DROP POLICY IF EXISTS "Projects updatable by sales team" ON public.projects;
CREATE POLICY "Projects updatable by sales team" ON public.projects FOR UPDATE TO authenticated
  USING (public.is_sales_contributor(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]))
  WITH CHECK (public.is_sales_contributor(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));

-- ---- opportunities --------------------------------------------------------
DROP POLICY IF EXISTS "BD/Manager/CEO can insert opportunities" ON public.opportunities;
CREATE POLICY "BD/Manager/CEO can insert opportunities" ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]));

DROP POLICY IF EXISTS "Owner or Manager/CEO can update" ON public.opportunities;
CREATE POLICY "Owner or Manager/CEO can update" ON public.opportunities FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]));
