-- =========================================================
-- PHC Sales OS — RFQ, JIH, Tender Award & Contract logic
--
-- Non-destructive extension. Adds a controlled RFQ/JIH sales workflow and a
-- separate Tender-monitoring workflow, plus cross-workflow overlays (flags,
-- win-confidence), award evidence, a stage-transition audit trail, and
-- operations handovers. True pipeline STAGES are enums; classifications /
-- confidence / flags are NOT stages. Sensitive transitions are enforced by the
-- backend layer (sales-os-api) + approvals; nothing here is destructive.
-- =========================================================

-- ============ ENUMS (stages) ============
CREATE TYPE public.flow_type AS ENUM ('direct_rfq', 'tender_converted', 'manual');

CREATE TYPE public.sales_stage AS ENUM (
  'rfq_received',
  'jih',                 -- Job In Hand: a true opportunity stage
  'under_negotiation',
  'verbally_awarded',
  'contract_received',
  'won',
  'lost',
  'on_hold'
);

CREATE TYPE public.tender_stage AS ENUM (
  'tender_identified',
  'tender_under_process',
  'award_negotiation',
  'awarded_to_contractor',
  'converted_to_jih',
  'tender_lost_or_archived'
);

CREATE TYPE public.rfq_status AS ENUM ('open', 'converted', 'lost', 'on_hold');
CREATE TYPE public.handover_status AS ENUM ('pending', 'ready', 'handed_over');

-- ============ ENUMS (overlays — NOT stages) ============
-- Sure Win is a confidence indicator, never a pipeline stage.
CREATE TYPE public.win_confidence AS ENUM ('low', 'possible', 'strong', 'sure_win');

CREATE TYPE public.action_type AS ENUM (
  'request_boq',
  'request_scope_clarification',
  'follow_up_required',
  'site_visit_required',
  'price_approval_required',
  'discount_approval_required',
  'technical_review_required',
  'vendor_quotation_required',
  'contract_review_required',
  'contact_verification_required',
  'tender_decision_required',
  'project_stage_verification_required',
  'finance_or_risk_review_required'
);

CREATE TYPE public.risk_flag AS ENUM (
  'boq_missing',
  'source_unverified',
  'contact_not_confirmed',
  'project_stage_unverified',
  'package_may_be_closed',
  'payment_risk',
  'margin_risk',
  'follow_up_overdue',
  'contract_pending',
  'approval_pending'
);

CREATE TYPE public.flag_kind AS ENUM ('action_required', 'risk');
CREATE TYPE public.flag_status AS ENUM ('open', 'resolved');

-- A/B/C classifications reuse the existing priority_tier enum ('A','B','C').

-- ============ EXTEND opportunities ============
ALTER TABLE public.opportunities
  ADD COLUMN flow_type public.flow_type NOT NULL DEFAULT 'manual',
  ADD COLUMN sales_stage public.sales_stage,
  ADD COLUMN win_confidence public.win_confidence,
  ADD COLUMN action_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN action_priority public.priority_tier,
  ADD COLUMN expected_contract_date DATE,
  ADD COLUMN verbal_award_date DATE,
  ADD COLUMN verbal_award_contact_name TEXT,
  ADD COLUMN verbal_award_contact_title TEXT,
  ADD COLUMN verbal_award_method TEXT,
  ADD COLUMN verbal_award_evidence TEXT,
  ADD COLUMN contract_received_date DATE,
  ADD COLUMN contract_reference_number TEXT,
  ADD COLUMN contract_value NUMERIC(16,2),
  ADD COLUMN handover_status public.handover_status,
  ADD COLUMN loss_reason TEXT,
  ADD COLUMN loss_notes TEXT,
  ADD COLUMN hold_reason TEXT,
  ADD COLUMN hold_review_date DATE;

CREATE INDEX idx_opportunities_sales_stage ON public.opportunities(sales_stage);
CREATE INDEX idx_opportunities_flow_type ON public.opportunities(flow_type);
CREATE INDEX idx_opportunities_action_required ON public.opportunities(action_required) WHERE action_required;

-- ============ EXTEND approvals (polymorphic link; opportunity optional) ============
-- Tender-to-JIH approvals reference a tender before any opportunity exists.
ALTER TABLE public.approvals
  ADD COLUMN linked_record_type TEXT,
  ADD COLUMN linked_record_id UUID;
ALTER TABLE public.approvals ALTER COLUMN related_opportunity_id DROP NOT NULL;

-- ============ RFQs ============
CREATE TABLE public.rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number TEXT,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_type TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  sales_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  response_due_date DATE,
  estimated_value NUMERIC(16,2),
  document_url TEXT,
  status public.rfq_status NOT NULL DEFAULT 'open',
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfqs TO authenticated;
GRANT ALL ON public.rfqs TO service_role;
ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "RFQs readable" ON public.rfqs FOR SELECT TO authenticated USING (true);
CREATE POLICY "RFQs insertable by sales team" ON public.rfqs FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "RFQs updatable by owner or manager" ON public.rfqs FOR UPDATE TO authenticated
  USING (sales_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (sales_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "RFQs deletable by manager" ON public.rfqs FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_rfqs_updated_at BEFORE UPDATE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_rfqs_owner ON public.rfqs(sales_owner_id);
CREATE INDEX idx_rfqs_status ON public.rfqs(status);

-- ============ TENDERS ============
CREATE TABLE public.tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_name TEXT NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  source TEXT,
  tender_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tender_stage public.tender_stage NOT NULL DEFAULT 'tender_identified',
  tender_priority_classification public.priority_tier,
  expected_award_date DATE,
  estimated_project_value NUMERIC(16,2),
  signage_potential public.confidence_level,
  main_contractor_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  award_evidence TEXT,
  next_follow_up_date DATE,
  converted_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  archive_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenders TO authenticated;
GRANT ALL ON public.tenders TO service_role;
ALTER TABLE public.tenders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenders readable" ON public.tenders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tenders insertable by sales team" ON public.tenders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Tenders updatable by owner or manager" ON public.tenders FOR UPDATE TO authenticated
  USING (tender_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (tender_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Tenders deletable by manager" ON public.tenders FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_tenders_updated_at BEFORE UPDATE ON public.tenders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_tenders_stage ON public.tenders(tender_stage);
CREATE INDEX idx_tenders_class ON public.tenders(tender_priority_classification);
CREATE INDEX idx_tenders_owner ON public.tenders(tender_owner_id);

-- ============ TENDER CONTRACTORS ============
CREATE TABLE public.tender_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES public.tenders(id) ON DELETE CASCADE,
  contractor_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contractor_status TEXT,
  win_likelihood public.confidence_level,
  notes TEXT,
  source TEXT,
  last_verified_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tender_contractors TO authenticated;
GRANT ALL ON public.tender_contractors TO service_role;
ALTER TABLE public.tender_contractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tender contractors readable" ON public.tender_contractors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tender contractors editable by sales team" ON public.tender_contractors FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE INDEX idx_tender_contractors_tender ON public.tender_contractors(tender_id);

-- ============ OPPORTUNITY / RECORD FLAGS (action_required + risk) ============
CREATE TABLE public.opportunity_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_record_type TEXT NOT NULL,          -- opportunity | rfq | tender | boq | quotation | contract
  linked_record_id UUID NOT NULL,
  flag_kind public.flag_kind NOT NULL,
  action_type public.action_type,
  risk_flag public.risk_flag,
  action_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE,
  priority public.priority_tier,
  reason TEXT,
  status public.flag_status NOT NULL DEFAULT 'open',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_flags TO authenticated;
GRANT ALL ON public.opportunity_flags TO service_role;
ALTER TABLE public.opportunity_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Flags readable" ON public.opportunity_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Flags editable by sales team" ON public.opportunity_flags FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_flags_updated_at BEFORE UPDATE ON public.opportunity_flags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_flags_record ON public.opportunity_flags(linked_record_type, linked_record_id);
CREATE INDEX idx_flags_owner ON public.opportunity_flags(action_owner_id);
CREATE INDEX idx_flags_status ON public.opportunity_flags(status);

-- ============ AWARD EVIDENCE ============
CREATE TABLE public.award_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_record_type TEXT NOT NULL,          -- opportunity | tender
  linked_record_id UUID NOT NULL,
  evidence_type TEXT,                         -- verbal_award | tender_award | contract
  source TEXT,
  date_received DATE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confidence_score INT CHECK (confidence_score BETWEEN 0 AND 100),
  document_url TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_evidence TO authenticated;
GRANT ALL ON public.award_evidence TO service_role;
ALTER TABLE public.award_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Award evidence readable" ON public.award_evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY "Award evidence editable by sales team" ON public.award_evidence FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE INDEX idx_award_evidence_record ON public.award_evidence(linked_record_type, linked_record_id);

-- ============ STAGE TRANSITION HISTORY (audit trail) ============
CREATE TABLE public.stage_transition_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type TEXT NOT NULL,                  -- opportunity | tender
  record_id UUID NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  evidence TEXT,
  approval_id UUID REFERENCES public.approvals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.stage_transition_history TO authenticated;
GRANT ALL ON public.stage_transition_history TO service_role;
ALTER TABLE public.stage_transition_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Transition history readable" ON public.stage_transition_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Transition history appendable" ON public.stage_transition_history FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE INDEX idx_transition_record ON public.stage_transition_history(record_type, record_id);

-- ============ OPERATIONS HANDOVERS ============
CREATE TABLE public.operations_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  commercial_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operations_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contract_document_url TEXT,
  approved_value NUMERIC(16,2),
  handover_checklist_status TEXT NOT NULL DEFAULT 'pending',
  handover_date DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operations_handovers TO authenticated;
GRANT ALL ON public.operations_handovers TO service_role;
ALTER TABLE public.operations_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Handovers readable" ON public.operations_handovers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Handovers editable by manager" ON public.operations_handovers FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_handovers_updated_at BEFORE UPDATE ON public.operations_handovers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_handovers_opp ON public.operations_handovers(opportunity_id);
