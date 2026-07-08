CREATE OR REPLACE FUNCTION public.is_commercial_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['managing_director','general_manager','ceo','sales_manager']::public.app_role[]);
$$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::public.app_role[]);
$$;
CREATE OR REPLACE FUNCTION public.is_pipeline_operator(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['managing_director','general_manager','ceo','sales_manager','bd_manager','sales_ops']::public.app_role[]);
$$;
REVOKE EXECUTE ON FUNCTION public.is_commercial_manager(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_pipeline_operator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_commercial_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pipeline_operator(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_opportunity_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND auth.uid() IS NOT NULL AND NOT public.is_commercial_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only a commercial manager can change the opportunity owner';
  END IF;
  RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.protect_company_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_owner_id IS DISTINCT FROM OLD.account_owner_id AND auth.uid() IS NOT NULL AND NOT public.is_commercial_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only a commercial manager can change the account owner';
  END IF;
  RETURN NEW;
END;$$;

DROP POLICY IF EXISTS "Managers can view all roles" ON public.user_roles;
CREATE POLICY "Platform admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Managers can grant roles" ON public.user_roles;
CREATE POLICY "Platform admins can grant roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Managers can revoke roles" ON public.user_roles;
CREATE POLICY "Platform admins can revoke roles" ON public.user_roles FOR DELETE TO authenticated USING (public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.protect_last_manager()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining INT; guarded public.app_role[] := ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::public.app_role[];
BEGIN
  IF OLD.role = ANY(guarded) THEN
    IF OLD.user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot revoke your own administrative/manager role'; END IF;
  END IF;
  IF OLD.role IN ('managing_director','general_manager','ceo','sales_manager') THEN
    SELECT COUNT(*) INTO remaining FROM public.user_roles WHERE role IN ('managing_director','general_manager','ceo','sales_manager') AND id <> OLD.id;
    IF remaining = 0 THEN RAISE EXCEPTION 'Cannot remove the last commercial manager account'; END IF;
  END IF;
  RETURN OLD;
END;$$;

DROP POLICY IF EXISTS "Approvals writable by Manager/CEO" ON public.approvals;
CREATE POLICY "Approvals writable by commercial managers" ON public.approvals FOR ALL TO authenticated
  USING (public.is_commercial_manager(auth.uid())) WITH CHECK (public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Audit log readable by Manager/CEO" ON public.audit_log;
CREATE POLICY "Audit log readable by platform admins" ON public.audit_log FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS requested_action text,
  ADD COLUMN IF NOT EXISTS requested_payload jsonb,
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'not_run',
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS execution_error text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approvals_execution_status_check') THEN
    ALTER TABLE public.approvals ADD CONSTRAINT approvals_execution_status_check CHECK (execution_status IN ('not_run','executed','failed','skipped'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_approvals_execution_status ON public.approvals (execution_status) WHERE execution_status <> 'executed';

ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS estimated_signage_value numeric(16,2),
  ADD COLUMN IF NOT EXISTS signage_package_status public.signage_package_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS main_contractor_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_plan_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS project_stage_suitable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_not_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversion_reason text,
  ADD COLUMN IF NOT EXISTS below_300k_exception_approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL;
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS estimated_signage_value numeric(16,2),
  ADD COLUMN IF NOT EXISTS signage_package_status public.signage_package_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS signage_package_confidence public.confidence_level NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS main_contractor_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_plan_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS project_stage_suitable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_not_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conversion_reason text,
  ADD COLUMN IF NOT EXISTS below_300k_exception_approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.protect_commercial_stage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_commercial_manager(auth.uid()) THEN
    IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage IN ('won','lost','archived') THEN
      RAISE EXCEPTION 'Commercial stage changes must go through sales-os-api';
    END IF;
    IF NEW.sales_stage IS DISTINCT FROM OLD.sales_stage THEN
      RAISE EXCEPTION 'Sales-stage changes must go through sales-os-api';
    END IF;
  END IF;
  RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS trg_opportunities_protect_commercial_stage ON public.opportunities;
CREATE TRIGGER trg_opportunities_protect_commercial_stage BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.protect_commercial_stage();

CREATE TABLE IF NOT EXISTS public.ai_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  records_scanned int NOT NULL DEFAULT 0,
  recommendations_created int NOT NULL DEFAULT 0,
  summary text, error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  run_id uuid REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL,
  title text NOT NULL, recommendation text NOT NULL, rationale text,
  confidence numeric(5,2), severity text,
  status text NOT NULL DEFAULT 'pending',
  entity_type text, entity_id uuid,
  suggested_action text, required_approval_type text, missing_data text[],
  generated_by text NOT NULL DEFAULT 'phc-agents',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_recs_status ON public.ai_recommendations (status);
CREATE INDEX IF NOT EXISTS idx_ai_recs_agent ON public.ai_recommendations (agent_key);
CREATE INDEX IF NOT EXISTS idx_ai_recs_entity ON public.ai_recommendations (entity_type, entity_id);
CREATE TABLE IF NOT EXISTS public.ai_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.ai_recommendations(id) ON DELETE CASCADE,
  label text NOT NULL, field text, value text,
  source_type text, source_ref text, source_url text,
  weight numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_evidence_rec ON public.ai_evidence_items (recommendation_id);
CREATE TABLE IF NOT EXISTS public.ai_agent_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.ai_recommendations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL, note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_rec ON public.ai_agent_feedback (recommendation_id);
CREATE TABLE IF NOT EXISTS public.lead_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL,
  score int NOT NULL, band text NOT NULL,
  reason_codes text[], evidence jsonb, missing_information text[],
  next_best_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_scores_lead ON public.lead_scores (lead_id);
CREATE TABLE IF NOT EXISTS public.duplicate_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, match_reason text, matched_fields text[],
  confidence numeric(5,2), status text NOT NULL DEFAULT 'open',
  run_id uuid REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.duplicate_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.duplicate_groups(id) ON DELETE CASCADE,
  entity_type text NOT NULL, entity_id uuid NOT NULL, display_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dupe_members_group ON public.duplicate_group_members (group_id);
CREATE TABLE IF NOT EXISTS public.protenders_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text, row_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.protenders_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES public.protenders_imports(id) ON DELETE CASCADE,
  project_name text, main_contractor text, stage text, value_est numeric,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.boq_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file text, status text NOT NULL DEFAULT 'pending', notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.extracted_boq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES public.boq_extractions(id) ON DELETE CASCADE,
  item_description text, sign_type text, quantity numeric, unit text,
  uncertain boolean NOT NULL DEFAULT false, source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ai_agent_runs','ai_recommendations','ai_evidence_items','ai_agent_feedback','lead_scores','duplicate_groups','duplicate_group_members','protenders_imports','protenders_projects','boq_extractions','extracted_boq_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_readable', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', tbl || '_readable', tbl);
  END LOOP;
END $$;
GRANT INSERT ON public.ai_agent_feedback TO authenticated;
DROP POLICY IF EXISTS ai_agent_feedback_insert_own ON public.ai_agent_feedback;
CREATE POLICY ai_agent_feedback_insert_own ON public.ai_agent_feedback FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';