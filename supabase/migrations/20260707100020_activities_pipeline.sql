-- =========================================================
-- PHC Sales OS — Phase B: Activities log + granular pipeline step
-- Activities feed the Activity Target and replace scattered tracking.
-- pipeline_step captures the 18-step linear flow (6.6) while the existing
-- 8-value opportunity_stage remains the macro grouping for board columns.
-- =========================================================

CREATE TYPE public.activity_type AS ENUM (
  'call',
  'visit',
  'meeting',
  'email_draft',
  'whatsapp_draft',
  'note'
);

CREATE TYPE public.activity_status AS ENUM ('logged', 'draft', 'sent');

CREATE TYPE public.pipeline_step AS ENUM (
  'new_project_detected',
  'researching',
  'needs_verification',
  'qualified_lead',
  'assigned',
  'outreach_awaiting_approval',
  'first_contact',
  'discovery_site_validation',
  'boq_requested',
  'boq_received',
  'boq_verified',
  'proposal_preparation',
  'proposal_submitted',
  'negotiation',
  'contract_review',
  'won',
  'lost',
  'hold'
);

-- =========================
-- ACTIVITIES
-- =========================
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
  -- Draft body for email_draft / whatsapp_draft. Drafts are NEVER auto-sent:
  -- sending is a human action outside this system.
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

-- =========================
-- OPPORTUNITIES: granular pipeline step
-- =========================
ALTER TABLE public.opportunities
  ADD COLUMN pipeline_step public.pipeline_step;

-- Seed pipeline_step from the existing macro stage so nothing starts blank.
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

-- Indexes
CREATE INDEX idx_activities_opp ON public.activities(related_opportunity_id);
CREATE INDEX idx_activities_owner ON public.activities(owner_id);
CREATE INDEX idx_activities_occurred ON public.activities(occurred_at DESC);
CREATE INDEX idx_opportunities_pipeline_step ON public.opportunities(pipeline_step);
