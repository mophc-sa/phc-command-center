-- =============================================================================
-- A deal's correspondence summary is read by the deal's people, not only by
-- whoever pressed Refresh.
--
-- ai_agent_outputs is readable by the requester (while they still own the
-- entity) and platform admins. For deal_correspondence_summary the user chose
-- (2026-09-29, design §6a) "whoever can read the deal": the salesperson, the
-- pipeline operators, estimation and finance — can_read_boq, the same rule
-- that already decides who reads the deal's emails. This adds one permissive
-- SELECT policy for that agent only; every other agent keeps its rule.
-- =============================================================================

DROP POLICY IF EXISTS "Correspondence summary readable by the deal's people" ON public.ai_agent_outputs;
CREATE POLICY "Correspondence summary readable by the deal's people"
  ON public.ai_agent_outputs FOR SELECT TO authenticated
  USING (
    agent_key = 'deal_correspondence_summary'
    AND entity_type = 'opportunities'
    AND entity_id IS NOT NULL
    AND public.can_read_boq(entity_id, (SELECT auth.uid()))
  );
