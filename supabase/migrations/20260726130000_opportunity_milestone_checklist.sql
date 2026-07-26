-- =========================================================
-- PHC Sales OS — Phase 4: opportunity milestone checklist + technical notes.
--
-- New feature (confirmed with the user: no existing equivalent) — a
-- checklist of process milestones (RFQ Recvd, Quotation Sent, Meeting w
-- Management, BAFO Request, Discount Sent, Final Negotiation, Received
-- Contract) that can each be independently marked done, regardless of the
-- opportunity's current sales_stage. Deliberately NOT a replacement for
-- sales_stage: sales_stage is the single current-state stepper driving the
-- JIH board's Kanban columns; this is an audit/evidence checklist that can
-- have multiple items checked at once (e.g. a BAFO request and a discount
-- sent can both be true while sales_stage is still "under_negotiation").
--
-- Also unrelated to evidence_sources (a free-form document/citation log) —
-- this is a fixed 7-item checklist, not a document list.
--
-- RLS follows the already-established "sales team or pipeline operator"
-- single FOR-ALL-operations pattern (see stakeholders/evidence_sources'
-- current policies in 20260719150000_rls_merge_overlapping_write_policies.sql)
-- rather than 4 separate per-operation policies, per that same migration's
-- own lesson about merging overlapping permissive policies from the start.
-- =========================================================

CREATE TYPE public.opportunity_milestone AS ENUM (
  'rfq_received', 'quotation_sent', 'meeting_with_management',
  'bafo_request', 'discount_sent', 'final_negotiation', 'received_contract'
);

CREATE TABLE public.opportunity_milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  milestone       public.opportunity_milestone NOT NULL,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, milestone)
);

CREATE INDEX idx_opportunity_milestones_opp ON public.opportunity_milestones(opportunity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_milestones TO authenticated;
GRANT ALL ON public.opportunity_milestones TO service_role;
ALTER TABLE public.opportunity_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Opportunity milestones readable" ON public.opportunity_milestones
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Opportunity milestones editable by sales team or pipeline operator"
  ON public.opportunity_milestones FOR ALL TO authenticated
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

ALTER TABLE public.opportunities ADD COLUMN technical_notes TEXT;
COMMENT ON COLUMN public.opportunities.technical_notes IS
'Free-form technical notes, distinct from evidence_sources (document log) and the milestone checklist. Shown on the Assignment tab, editable by the same roles that can edit stakeholders.';
