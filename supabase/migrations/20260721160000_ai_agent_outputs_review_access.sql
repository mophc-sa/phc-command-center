-- =========================================================
-- Let system_admin read ai_agent_outputs it didn't personally request
--
-- is_platform_admin() (system_admin, managing_director, general_manager,
-- ceo, sales_manager) is already a strict superset of is_commercial_manager()
-- (managing_director, general_manager, ceo, sales_manager) — same helper
-- already used for audit_log visibility. Replacing is simpler and correct;
-- no need for a redundant third OR branch.
--
-- Without this, system_admin can't see ai_agent_outputs rows to review them
-- (the upcoming review_ai_agent_output sales-os-api handler role-gates on
-- the same admin set, but the row must be visible to the caller first).
-- =========================================================

DROP POLICY IF EXISTS "AI outputs readable by authorized users" ON public.ai_agent_outputs;

CREATE POLICY "AI outputs readable by authorized users" ON public.ai_agent_outputs
  FOR SELECT TO authenticated
  USING (
    (requested_by = auth.uid() AND (entity_id IS NULL OR public.ai_output_entity_still_owned(entity_type, entity_id, auth.uid())))
    OR public.is_platform_admin(auth.uid())
  );
