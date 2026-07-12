-- =========================================================
-- Sprint 1D: Role Model Cleanup — Replace raw `ceo` role arrays
--
-- Problem (B-05):
--   ~20 RLS policies across 15+ tables still contain raw
--   ARRAY['...,ceo,...'] checks. Adding or retiring a role
--   requires hunting every policy manually — fragile and error-prone.
--
-- What this migration does:
--   Replaces every remaining raw-role-array policy with the
--   SECURITY DEFINER helpers introduced in 20260708130010:
--     · is_pipeline_operator(uuid) — BD/Ops and above (not system_admin)
--     · is_commercial_manager(uuid) — executive + sales_manager
--     · is_sales_contributor(uuid)  — everyone who drives day-to-day sales
--
--   Also drops two stale FOR ALL policies on boqs and quotations
--   that were superseded by 20260711160000 without being dropped.
--
-- Tables touched:
--   stakeholders, tasks, artifacts, evidence_sources, source_registry,
--   boq_items, boqs (drop-only), quotations (drop-only),
--   vendors, reference_projects, recommendations,
--   knowledge_chunks, tender_contractors, opportunity_flags,
--   award_evidence, stage_transition_history, operations_handovers,
--   storage.objects
-- =========================================================

-- -------------------------------------------------------
-- STAKEHOLDERS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Stakeholders editable by BD/Manager/CEO" ON public.stakeholders;
CREATE POLICY "Stakeholders editable by pipeline operator" ON public.stakeholders
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- TASKS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Tasks editable by owner or Manager/CEO" ON public.tasks;
CREATE POLICY "Tasks editable by owner or pipeline operator" ON public.tasks
  FOR ALL TO authenticated
  USING  (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- ARTIFACTS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Artifacts editable by BD/Manager/CEO" ON public.artifacts;
CREATE POLICY "Artifacts editable by pipeline operator" ON public.artifacts
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- EVIDENCE SOURCES
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Evidence editable by BD/Manager/CEO" ON public.evidence_sources;
CREATE POLICY "Evidence editable by pipeline operator" ON public.evidence_sources
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- SOURCE REGISTRY
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Source registry writable by Manager/CEO" ON public.source_registry;
CREATE POLICY "Source registry writable by commercial manager" ON public.source_registry
  FOR ALL TO authenticated
  USING  (public.is_commercial_manager(auth.uid()))
  WITH CHECK (public.is_commercial_manager(auth.uid()));

-- -------------------------------------------------------
-- BOQ ITEMS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "BOQ items editable by BD/Manager/CEO" ON public.boq_items;
CREATE POLICY "BOQ items editable by pipeline operator" ON public.boq_items
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- BOQS — stale FOR ALL superseded by 20260711160000.
-- That migration added INSERT + UPDATE policies but missed DELETE.
-- Drop the raw-role FOR ALL; add a targeted DELETE policy.
-- -------------------------------------------------------
DROP POLICY IF EXISTS "BOQs editable by BD/Manager/CEO" ON public.boqs;
CREATE POLICY "BOQs deletable by commercial manager" ON public.boqs
  FOR DELETE TO authenticated
  USING (public.is_commercial_manager(auth.uid()));

-- -------------------------------------------------------
-- QUOTATIONS — stale INSERT policy superseded by 20260711160000
-- which already creates "Quotations insertable by sales team".
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Quotations insertable by BD/Manager/CEO" ON public.quotations;

-- -------------------------------------------------------
-- VENDORS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Vendors full access by managers" ON public.vendors;
CREATE POLICY "Vendors full access by pipeline operator" ON public.vendors
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- REFERENCE PROJECTS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Reference projects editable by BD/Manager" ON public.reference_projects;
CREATE POLICY "Reference projects editable by pipeline operator" ON public.reference_projects
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- RECOMMENDATIONS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Recommendations insertable by BD/Manager" ON public.recommendations;
CREATE POLICY "Recommendations insertable by pipeline operator" ON public.recommendations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Recommendations updatable by owner or manager" ON public.recommendations;
CREATE POLICY "Recommendations updatable by owner or pipeline operator" ON public.recommendations
  FOR UPDATE TO authenticated
  USING  (suggested_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (suggested_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Recommendations deletable by manager" ON public.recommendations;
CREATE POLICY "Recommendations deletable by commercial manager" ON public.recommendations
  FOR DELETE TO authenticated
  USING (public.is_commercial_manager(auth.uid()));

-- -------------------------------------------------------
-- KNOWLEDGE CHUNKS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Knowledge writable by managers" ON public.knowledge_chunks;
CREATE POLICY "Knowledge writable by pipeline operator" ON public.knowledge_chunks
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- TENDER CONTRACTORS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Tender contractors editable by sales team" ON public.tender_contractors;
CREATE POLICY "Tender contractors editable by sales contributor" ON public.tender_contractors
  FOR ALL TO authenticated
  USING  (public.is_sales_contributor(auth.uid()))
  WITH CHECK (public.is_sales_contributor(auth.uid()));

-- -------------------------------------------------------
-- OPPORTUNITY FLAGS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Flags editable by sales team" ON public.opportunity_flags;
CREATE POLICY "Flags editable by sales contributor" ON public.opportunity_flags
  FOR ALL TO authenticated
  USING  (public.is_sales_contributor(auth.uid()))
  WITH CHECK (public.is_sales_contributor(auth.uid()));

-- -------------------------------------------------------
-- AWARD EVIDENCE
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Award evidence editable by sales team" ON public.award_evidence;
CREATE POLICY "Award evidence editable by sales contributor" ON public.award_evidence
  FOR ALL TO authenticated
  USING  (public.is_sales_contributor(auth.uid()))
  WITH CHECK (public.is_sales_contributor(auth.uid()));

-- -------------------------------------------------------
-- STAGE TRANSITION HISTORY
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Transition history appendable" ON public.stage_transition_history;
CREATE POLICY "Transition history appendable by sales contributor" ON public.stage_transition_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

-- -------------------------------------------------------
-- OPERATIONS HANDOVERS
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Handovers editable by manager" ON public.operations_handovers;
CREATE POLICY "Handovers editable by pipeline operator" ON public.operations_handovers
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- -------------------------------------------------------
-- STORAGE — attachments bucket
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Attachments insertable by sales team" ON storage.objects;
CREATE POLICY "Attachments insertable by sales team" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND public.is_sales_contributor(auth.uid())
  );

DROP POLICY IF EXISTS "Attachments deletable by uploader or manager" ON storage.objects;
CREATE POLICY "Attachments deletable by uploader or manager" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (owner = auth.uid() OR public.is_commercial_manager(auth.uid()))
  );
