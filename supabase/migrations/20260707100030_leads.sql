-- =========================================================
-- PHC Sales OS — Phase C: Project Radar & Lead Intake (6.10)
-- Raw leads land here and are qualified step-by-step before a human
-- decides to convert them into an Opportunity. A lead never becomes an
-- opportunity automatically.
-- =========================================================

CREATE TYPE public.lead_stage AS ENUM (
  'detected',
  'duplicate_check',
  'research',
  'contractor_identification',
  'project_stage_check',
  'signage_assessment',
  'value_estimate',
  'scored',
  'human_review',
  'converted',
  'rejected'
);

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'manual',   -- protenders | external | manual
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
