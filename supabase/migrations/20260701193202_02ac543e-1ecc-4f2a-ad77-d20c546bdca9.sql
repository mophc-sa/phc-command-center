
-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.app_role AS ENUM ('ceo', 'sales_manager', 'bd_manager', 'viewer');
CREATE TYPE public.priority_tier AS ENUM ('A', 'B', 'C');
CREATE TYPE public.opportunity_stage AS ENUM ('discovery', 'qualification', 'preparation', 'quotation', 'follow_up', 'won', 'lost', 'archived');
CREATE TYPE public.signage_package_status AS ENUM ('confirmed', 'likely', 'unknown', 'not_applicable', 'no_package_identified');
CREATE TYPE public.project_stage AS ENUM ('early_planning', 'design_development', 'tender', 'awarded', 'under_construction', 'near_handover', 'completed', 'unknown');
CREATE TYPE public.exclusion_reason AS ENUM ('no_signage_package', 'low_commercial_value', 'no_clear_contractor', 'outside_phc_scope', 'duplicate_opportunity', 'insufficient_evidence', 'other');
CREATE TYPE public.confidence_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE public.follow_up_status AS ENUM ('scheduled', 'due', 'overdue', 'completed', 'cancelled');
CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'returned', 'escalated');
CREATE TYPE public.approval_recommendation AS ENUM ('proceed', 'management_review', 'do_not_quote');
CREATE TYPE public.artifact_type AS ENUM ('stakeholder_map', 'pricing_brief', 'outreach_draft', 'qualification_brief', 'discovery_research_brief');
CREATE TYPE public.artifact_status AS ENUM ('draft', 'awaiting_review', 'approved', 'rejected');
CREATE TYPE public.agent_run_status AS ENUM ('running', 'completed', 'needs_review', 'paused', 'error');

-- =========================
-- PROFILES
-- =========================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- =========================
-- USER ROLES (separate table — anti-privilege-escalation)
-- =========================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Security-definer role helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

CREATE POLICY "Managers can view all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales_manager']::public.app_role[]));

-- Auto-create profile + default viewer role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'viewer')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- OPPORTUNITIES
-- =========================
CREATE TABLE public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name TEXT NOT NULL,
  client TEXT,
  main_contractor TEXT,
  location TEXT,
  sector TEXT,
  tier public.priority_tier NOT NULL DEFAULT 'B',
  stage public.opportunity_stage NOT NULL DEFAULT 'discovery',
  project_stage public.project_stage NOT NULL DEFAULT 'unknown',
  signage_package_status public.signage_package_status NOT NULL DEFAULT 'unknown',
  signage_package_confidence public.confidence_level NOT NULL DEFAULT 'low',
  package_budget_confirmed BOOLEAN NOT NULL DEFAULT false,
  main_contractor_confirmed BOOLEAN NOT NULL DEFAULT false,
  contractor_decision_maker TEXT,
  prequalification_status TEXT,
  strategic_value TEXT,
  source_confidence public.confidence_level NOT NULL DEFAULT 'low',
  evidence_count INT NOT NULL DEFAULT 0,
  exclusion_reason public.exclusion_reason,
  management_review_reason TEXT,
  estimated_value_min NUMERIC(14,2),
  estimated_value_max NUMERIC(14,2),
  quotation_value NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  next_action TEXT,
  next_action_due DATE,
  last_activity_at TIMESTAMPTZ,
  agent_recommendation public.approval_recommendation,
  agent_reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Opportunities readable by any authenticated" ON public.opportunities FOR SELECT TO authenticated USING (true);
CREATE POLICY "BD/Manager/CEO can insert opportunities" ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Owner or Manager/CEO can update" ON public.opportunities FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Manager/CEO can delete" ON public.opportunities FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_opportunities_updated_at BEFORE UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- STAKEHOLDERS
-- =========================
CREATE TABLE public.stakeholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  organization TEXT,
  email TEXT,
  phone TEXT,
  contact_confidence public.confidence_level NOT NULL DEFAULT 'low',
  last_interaction_at TIMESTAMPTZ,
  notes TEXT,
  contact_order INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stakeholders TO authenticated;
GRANT ALL ON public.stakeholders TO service_role;
ALTER TABLE public.stakeholders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stakeholders readable" ON public.stakeholders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Stakeholders editable by BD/Manager/CEO" ON public.stakeholders FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_stakeholders_updated_at BEFORE UPDATE ON public.stakeholders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- FOLLOW-UPS
-- =========================
CREATE TABLE public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE NOT NULL,
  cadence_tier public.priority_tier NOT NULL DEFAULT 'B',
  channel TEXT,
  status public.follow_up_status NOT NULL DEFAULT 'scheduled',
  last_contact_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Follow-ups readable" ON public.follow_ups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Follow-ups editable by owner or Manager/CEO" ON public.follow_ups FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo','bd_manager']::public.app_role[]));

CREATE TRIGGER trg_follow_ups_updated_at BEFORE UPDATE ON public.follow_ups
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- TASKS
-- =========================
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  related_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  priority public.priority_tier NOT NULL DEFAULT 'B',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tasks readable" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tasks editable by owner or Manager/CEO" ON public.tasks FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo','bd_manager']::public.app_role[]));

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- APPROVALS
-- =========================
CREATE TABLE public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  approval_type TEXT NOT NULL,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_approver UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.approval_status NOT NULL DEFAULT 'pending',
  recommendation public.approval_recommendation,
  decision public.approval_recommendation,
  decision_notes TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Approvals readable" ON public.approvals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approvals writable by Manager/CEO" ON public.approvals FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo','bd_manager']::public.app_role[]));

CREATE TRIGGER trg_approvals_updated_at BEFORE UPDATE ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- ARTIFACTS
-- =========================
CREATE TABLE public.artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  artifact_type public.artifact_type NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.artifact_status NOT NULL DEFAULT 'draft',
  created_by_agent TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artifacts TO authenticated;
GRANT ALL ON public.artifacts TO service_role;
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Artifacts readable" ON public.artifacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Artifacts editable by BD/Manager/CEO" ON public.artifacts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_artifacts_updated_at BEFORE UPDATE ON public.artifacts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- EVIDENCE SOURCES
-- =========================
CREATE TABLE public.evidence_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_url TEXT,
  vault_path TEXT,
  source_date DATE,
  confidence_level public.confidence_level NOT NULL DEFAULT 'medium',
  extracted_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_sources TO authenticated;
GRANT ALL ON public.evidence_sources TO service_role;
ALTER TABLE public.evidence_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Evidence readable" ON public.evidence_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Evidence editable by BD/Manager/CEO" ON public.evidence_sources FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

-- =========================
-- AGENT RUNS
-- =========================
CREATE TABLE public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  loop_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status public.agent_run_status NOT NULL DEFAULT 'running',
  records_processed INT DEFAULT 0,
  records_created INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  errors JSONB,
  summary TEXT,
  snapshot_version TEXT
);
GRANT SELECT ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agent runs readable" ON public.agent_runs FOR SELECT TO authenticated USING (true);

-- =========================
-- SNAPSHOT VERSIONS
-- =========================
CREATE TABLE public.snapshot_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_type TEXT,
  snapshot_path TEXT,
  status TEXT NOT NULL DEFAULT 'fresh',
  records_summary JSONB
);
GRANT SELECT ON public.snapshot_versions TO authenticated;
GRANT ALL ON public.snapshot_versions TO service_role;
ALTER TABLE public.snapshot_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Snapshots readable" ON public.snapshot_versions FOR SELECT TO authenticated USING (true);

-- =========================
-- SOURCE REGISTRY
-- =========================
CREATE TABLE public.source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_path TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  owner UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_reviewed_at TIMESTAMPTZ,
  approved_for_agent_use BOOLEAN NOT NULL DEFAULT false,
  freshness_status TEXT DEFAULT 'unknown'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_registry TO authenticated;
GRANT ALL ON public.source_registry TO service_role;
ALTER TABLE public.source_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Source registry readable" ON public.source_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "Source registry writable by Manager/CEO" ON public.source_registry FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

-- =========================
-- AUDIT LOG
-- =========================
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_value JSONB,
  after_value JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit log readable by Manager/CEO" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Any authenticated can append audit rows" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);

-- Indexes
CREATE INDEX idx_opps_owner ON public.opportunities(owner_id);
CREATE INDEX idx_opps_stage ON public.opportunities(stage);
CREATE INDEX idx_opps_tier ON public.opportunities(tier);
CREATE INDEX idx_followups_due ON public.follow_ups(due_date, status);
CREATE INDEX idx_approvals_status ON public.approvals(status);
CREATE INDEX idx_evidence_opp ON public.evidence_sources(related_opportunity_id);
