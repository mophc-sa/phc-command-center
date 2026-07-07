-- ==== 20260707100010_crm_core.sql ====
CREATE TYPE public.company_type AS ENUM (
  'main_contractor','developer','owner','consultant',
  'existing_client','previous_client','target_account','vendor','do_not_target'
);
CREATE TYPE public.account_status AS ENUM ('pending_review','active','dormant','do_not_target');
CREATE TYPE public.contact_authority AS ENUM ('decision_maker','influencer','technical_contact','unknown_authority');
CREATE TYPE public.contact_location AS ENUM ('site_office','head_office','unknown');
CREATE TYPE public.verification_status AS ENUM ('pending_verification','verified','rejected');

CREATE OR REPLACE FUNCTION public.protect_company_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_owner_id IS DISTINCT FROM OLD.account_owner_id
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only a manager can change the account owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_opportunity_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only a manager can change the opportunity owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_opportunities_protect_owner
BEFORE UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.protect_opportunity_owner();

CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_type public.company_type NOT NULL DEFAULT 'target_account',
  regions TEXT,
  account_status public.account_status NOT NULL DEFAULT 'pending_review',
  account_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  relationship_level TEXT,
  last_contact_at TIMESTAMPTZ,
  next_action TEXT,
  next_action_due DATE,
  internal_notes TEXT,
  upsell_notes TEXT,
  source TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Companies readable" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Companies insertable by sales team" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Companies updatable by owner or BD/Manager" ON public.companies FOR UPDATE TO authenticated
  USING (account_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (account_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Companies deletable by Manager/CEO" ON public.companies FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_companies_protect_owner BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.protect_company_owner();

CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  title TEXT, phone TEXT, email TEXT, linkedin TEXT,
  location public.contact_location NOT NULL DEFAULT 'unknown',
  authority public.contact_authority NOT NULL DEFAULT 'unknown_authority',
  source TEXT,
  last_verified_at TIMESTAMPTZ,
  confidence_score INT CHECK (confidence_score BETWEEN 0 AND 100),
  verification_status public.verification_status NOT NULL DEFAULT 'pending_verification',
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contacts readable" ON public.contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Contacts insertable by sales team" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Contacts updatable by owner or BD/Manager" ON public.contacts FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Contacts deletable by Manager/CEO" ON public.contacts FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT, sector TEXT,
  owner_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  main_contractor_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  consultant_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  total_value NUMERIC(16,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  project_stage public.project_stage NOT NULL DEFAULT 'unknown',
  completion_pct NUMERIC(5,2) CHECK (completion_pct BETWEEN 0 AND 100),
  signage_package_status public.signage_package_status NOT NULL DEFAULT 'unknown',
  expected_boq_date DATE, expected_signage_date DATE,
  source TEXT,
  source_confidence public.confidence_level NOT NULL DEFAULT 'low',
  verification_status public.verification_status NOT NULL DEFAULT 'pending_verification',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Projects readable" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Projects insertable by sales team" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Projects updatable by sales team" ON public.projects FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Projects deletable by Manager/CEO" ON public.projects FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.opportunities
  ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN main_contractor_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "BD/Manager/CEO can insert opportunities" ON public.opportunities;
CREATE POLICY "Sales team can insert opportunities" ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

DROP POLICY IF EXISTS "Stakeholders editable by BD/Manager/CEO" ON public.stakeholders;
CREATE POLICY "Stakeholders editable by sales team" ON public.stakeholders FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

DROP POLICY IF EXISTS "BOQs editable by BD/Manager/CEO" ON public.boqs;
CREATE POLICY "BOQs editable by sales team" ON public.boqs FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

DROP POLICY IF EXISTS "BOQ items editable by BD/Manager/CEO" ON public.boq_items;
CREATE POLICY "BOQ items editable by sales team" ON public.boq_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

DROP POLICY IF EXISTS "Quotations insertable by BD/Manager/CEO" ON public.quotations;
CREATE POLICY "Quotations insertable by sales team" ON public.quotations FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE INDEX idx_companies_type ON public.companies(company_type);
CREATE INDEX idx_companies_owner ON public.companies(account_owner_id);
CREATE INDEX idx_companies_status ON public.companies(account_status);
CREATE INDEX idx_contacts_company ON public.contacts(company_id);
CREATE INDEX idx_contacts_owner ON public.contacts(owner_id);
CREATE INDEX idx_projects_contractor ON public.projects(main_contractor_id);
CREATE INDEX idx_projects_stage ON public.projects(project_stage);
CREATE INDEX idx_opportunities_company ON public.opportunities(company_id);
CREATE INDEX idx_opportunities_project ON public.opportunities(project_id);
CREATE INDEX idx_opportunities_contractor ON public.opportunities(main_contractor_id);

INSERT INTO public.companies (name, company_type, account_status, source)
SELECT DISTINCT btrim(o.main_contractor), 'main_contractor'::public.company_type, 'active'::public.account_status, 'backfill'
FROM public.opportunities o
WHERE o.main_contractor IS NOT NULL AND btrim(o.main_contractor) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE lower(c.name) = lower(btrim(o.main_contractor)));

INSERT INTO public.companies (name, company_type, account_status, source)
SELECT DISTINCT btrim(o.client), 'existing_client'::public.company_type, 'active'::public.account_status, 'backfill'
FROM public.opportunities o
WHERE o.client IS NOT NULL AND btrim(o.client) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE lower(c.name) = lower(btrim(o.client)));

INSERT INTO public.projects (name, location, sector, project_stage, signage_package_status, main_contractor_id, source, source_confidence, verification_status)
SELECT DISTINCT ON (lower(btrim(o.project_name)))
  btrim(o.project_name), o.location, o.sector, o.project_stage, o.signage_package_status,
  (SELECT c.id FROM public.companies c WHERE lower(c.name) = lower(btrim(o.main_contractor)) LIMIT 1),
  'backfill', o.source_confidence, 'verified'::public.verification_status
FROM public.opportunities o
WHERE o.project_name IS NOT NULL AND btrim(o.project_name) <> ''
ORDER BY lower(btrim(o.project_name)), o.created_at;

UPDATE public.opportunities o SET main_contractor_id = c.id
FROM public.companies c
WHERE o.main_contractor IS NOT NULL AND lower(c.name) = lower(btrim(o.main_contractor));

UPDATE public.opportunities o SET company_id = c.id
FROM public.companies c
WHERE o.client IS NOT NULL AND lower(c.name) = lower(btrim(o.client));

UPDATE public.opportunities o SET project_id = p.id
FROM public.projects p
WHERE o.project_name IS NOT NULL AND lower(p.name) = lower(btrim(o.project_name));

-- ==== 20260707100020_activities_pipeline.sql ====
CREATE TYPE public.activity_type AS ENUM ('call','visit','meeting','email_draft','whatsapp_draft','note');
CREATE TYPE public.activity_status AS ENUM ('logged','draft','sent');
CREATE TYPE public.pipeline_step AS ENUM (
  'new_project_detected','researching','needs_verification','qualified_lead','assigned',
  'outreach_awaiting_approval','first_contact','discovery_site_validation',
  'boq_requested','boq_received','boq_verified',
  'proposal_preparation','proposal_submitted','negotiation','contract_review',
  'won','lost','hold'
);

CREATE TABLE public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type public.activity_type NOT NULL,
  status public.activity_status NOT NULL DEFAULT 'logged',
  related_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary TEXT,
  draft_content TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT ALL ON public.activities TO service_role;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Activities readable" ON public.activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Activities insertable by sales team" ON public.activities FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Activities editable by owner or Manager" ON public.activities FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Activities deletable by owner or Manager" ON public.activities FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

ALTER TABLE public.opportunities ADD COLUMN pipeline_step public.pipeline_step;

UPDATE public.opportunities SET pipeline_step = CASE stage
  WHEN 'discovery' THEN 'new_project_detected'
  WHEN 'qualification' THEN 'qualified_lead'
  WHEN 'preparation' THEN 'proposal_preparation'
  WHEN 'quotation' THEN 'proposal_submitted'
  WHEN 'follow_up' THEN 'negotiation'
  WHEN 'won' THEN 'won'
  WHEN 'lost' THEN 'lost'
  ELSE NULL
END::public.pipeline_step;

CREATE INDEX idx_activities_opp ON public.activities(related_opportunity_id);
CREATE INDEX idx_activities_owner ON public.activities(owner_id);
CREATE INDEX idx_activities_occurred ON public.activities(occurred_at DESC);
CREATE INDEX idx_opportunities_pipeline_step ON public.opportunities(pipeline_step);

-- ==== 20260707100030_leads.sql ====
CREATE TYPE public.lead_stage AS ENUM (
  'detected','duplicate_check','research','contractor_identification','project_stage_check',
  'signage_assessment','value_estimate','scored','human_review','converted','rejected'
);

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  project_name TEXT NOT NULL,
  location TEXT,
  main_contractor_guess TEXT,
  lead_stage public.lead_stage NOT NULL DEFAULT 'detected',
  duplicate_of UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  research_notes TEXT,
  project_stage_estimate public.project_stage,
  signage_potential public.confidence_level,
  estimated_value NUMERIC(14,2),
  lead_score INT CHECK (lead_score BETWEEN 0 AND 100),
  converted_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Leads readable" ON public.leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Leads insertable by sales team" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Leads editable by BD/Manager" ON public.leads FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Leads deletable by Manager" ON public.leads FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_leads_stage ON public.leads(lead_stage);
CREATE INDEX idx_leads_score ON public.leads(lead_score DESC);

-- ==== 20260707100040_vendors_reference.sql ====
CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT, materials TEXT, city TEXT,
  contact_name TEXT, contact_phone TEXT, contact_email TEXT,
  lead_time TEXT, quality_level TEXT, previous_projects TEXT,
  qualification_files TEXT, portal_url TEXT,
  reference_prices TEXT,
  internal_rating INT CHECK (internal_rating BETWEEN 1 AND 5),
  internal_notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors full access by managers" ON public.vendors FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE VIEW public.vendors_public
WITH (security_invoker = false) AS
SELECT id, name, scope, materials, city,
  contact_name, contact_phone, contact_email,
  lead_time, quality_level, previous_projects, portal_url,
  created_at, updated_at
FROM public.vendors;
GRANT SELECT ON public.vendors_public TO authenticated;

CREATE TABLE public.reference_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  project_type TEXT, city TEXT, client_or_contractor TEXT, sector TEXT,
  year INT, phc_scope TEXT, sign_types TEXT, materials TEXT,
  project_value NUMERIC(16,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  images TEXT, challenges TEXT, solutions TEXT,
  shareable_with_client BOOLEAN NOT NULL DEFAULT false,
  requires_approval_to_share BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reference_projects TO authenticated;
GRANT ALL ON public.reference_projects TO service_role;
ALTER TABLE public.reference_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reference projects readable" ON public.reference_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Reference projects editable by BD/Manager" ON public.reference_projects FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_reference_projects_updated_at BEFORE UPDATE ON public.reference_projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_vendors_name ON public.vendors(name);
CREATE INDEX idx_reference_projects_sector ON public.reference_projects(sector);
CREATE INDEX idx_reference_projects_year ON public.reference_projects(year);

-- ==== 20260707100050_recommendations.sql ====
CREATE TYPE public.recommendation_status AS ENUM ('pending','accepted','dismissed','actioned');

CREATE TABLE public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_module TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  reason TEXT, evidence TEXT, data_sources TEXT,
  confidence_score INT CHECK (confidence_score BETWEEN 0 AND 100),
  risk_notes TEXT,
  suggested_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  required_approval_type TEXT,
  status public.recommendation_status NOT NULL DEFAULT 'pending',
  related_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE,
  related_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  related_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendations TO authenticated;
GRANT ALL ON public.recommendations TO service_role;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recommendations readable" ON public.recommendations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Recommendations insertable by BD/Manager" ON public.recommendations FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Recommendations updatable by owner or manager" ON public.recommendations FOR UPDATE TO authenticated
  USING (suggested_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (suggested_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Recommendations deletable by manager" ON public.recommendations FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE TRIGGER trg_recommendations_updated_at BEFORE UPDATE ON public.recommendations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_recommendations_status ON public.recommendations(status);
CREATE INDEX idx_recommendations_opp ON public.recommendations(related_opportunity_id);
CREATE INDEX idx_recommendations_owner ON public.recommendations(suggested_owner_id);

CREATE POLICY "Approvals requestable by salesperson" ON public.approvals FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['salesperson']::public.app_role[])
    AND requested_by = auth.uid()
    AND status = 'pending'
  );

-- ==== 20260707100070_rag.sql ====
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id UUID,
  title TEXT,
  content TEXT NOT NULL,
  embedding extensions.vector(384),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Knowledge readable" ON public.knowledge_chunks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Knowledge writable by managers" ON public.knowledge_chunks FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE INDEX idx_knowledge_embedding ON public.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX idx_knowledge_source ON public.knowledge_chunks(source_type, source_id);

CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_embedding extensions.vector(384),
  match_count INT DEFAULT 5,
  filter_source_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, source_type TEXT, source_id UUID, title TEXT, content TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT kc.id, kc.source_type, kc.source_id, kc.title, kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_source_type IS NULL OR kc.source_type = filter_source_type)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.match_knowledge TO authenticated, service_role;

-- ==== 20260707100080_rfq_tender.sql ====
CREATE TYPE public.flow_type AS ENUM ('direct_rfq','tender_converted','manual');
CREATE TYPE public.sales_stage AS ENUM (
  'rfq_received','jih','under_negotiation','verbally_awarded','contract_received','won','lost','on_hold'
);
CREATE TYPE public.tender_stage AS ENUM (
  'tender_identified','tender_under_process','award_negotiation','awarded_to_contractor',
  'converted_to_jih','tender_lost_or_archived'
);
CREATE TYPE public.rfq_status AS ENUM ('open','converted','lost','on_hold');
CREATE TYPE public.handover_status AS ENUM ('pending','ready','handed_over');
CREATE TYPE public.win_confidence AS ENUM ('low','possible','strong','sure_win');
CREATE TYPE public.action_type AS ENUM (
  'request_boq','request_scope_clarification','follow_up_required','site_visit_required',
  'price_approval_required','discount_approval_required','technical_review_required',
  'vendor_quotation_required','contract_review_required','contact_verification_required',
  'tender_decision_required','project_stage_verification_required','finance_or_risk_review_required'
);
CREATE TYPE public.risk_flag AS ENUM (
  'boq_missing','source_unverified','contact_not_confirmed','project_stage_unverified',
  'package_may_be_closed','payment_risk','margin_risk','follow_up_overdue',
  'contract_pending','approval_pending'
);
CREATE TYPE public.flag_kind AS ENUM ('action_required','risk');
CREATE TYPE public.flag_status AS ENUM ('open','resolved');

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

ALTER TABLE public.approvals
  ADD COLUMN linked_record_type TEXT,
  ADD COLUMN linked_record_id UUID;
ALTER TABLE public.approvals ALTER COLUMN related_opportunity_id DROP NOT NULL;

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

CREATE TABLE public.opportunity_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_record_type TEXT NOT NULL,
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

CREATE TABLE public.award_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_record_type TEXT NOT NULL,
  linked_record_id UUID NOT NULL,
  evidence_type TEXT,
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

CREATE TABLE public.stage_transition_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type TEXT NOT NULL,
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