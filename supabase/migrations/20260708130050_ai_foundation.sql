-- =========================================================
-- PHC Sales OS — Phase 5: AI foundation.
--
-- Real-data AI only. Every AI recommendation carries evidence (ai_evidence_items)
-- and a confidence score; nothing is auto-applied. Agents that need external
-- APIs/credentials store a backend-ready structure and report "not configured"
-- instead of producing fake output.
--
-- The legacy `recommendations` table (8-field human-review shape) is kept for
-- the existing accept_recommendation flow. These `ai_*` tables are the richer,
-- evidence-first model for the agent layer and do not replace it.
-- Additive + idempotent.
-- =========================================================

-- ---- Agent runs ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,                 -- data_cleanup | duplicate_detection | lead_scoring | ...
  status text NOT NULL DEFAULT 'completed',-- running | completed | failed | not_configured
  records_scanned int NOT NULL DEFAULT 0,
  recommendations_created int NOT NULL DEFAULT 0,
  summary text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ---- Recommendations (evidence-first) --------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  run_id uuid REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL,
  title text NOT NULL,
  recommendation text NOT NULL,
  rationale text,
  confidence numeric(5,2),                 -- 0..100
  severity text,                           -- info | low | medium | high
  status text NOT NULL DEFAULT 'pending',  -- pending | accepted | dismissed | review_requested | actioned
  entity_type text,                        -- company | contact | project | lead | opportunity | tender | boq
  entity_id uuid,
  suggested_action text,
  required_approval_type text,             -- set when acting is sensitive (spawns an approval)
  missing_data text[],
  generated_by text NOT NULL DEFAULT 'phc-agents',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_recs_status ON public.ai_recommendations (status);
CREATE INDEX IF NOT EXISTS idx_ai_recs_agent ON public.ai_recommendations (agent_key);
CREATE INDEX IF NOT EXISTS idx_ai_recs_entity ON public.ai_recommendations (entity_type, entity_id);

-- ---- Evidence items (every recommendation must have >= 1) -------------------
CREATE TABLE IF NOT EXISTS public.ai_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.ai_recommendations(id) ON DELETE CASCADE,
  label text NOT NULL,
  field text,
  value text,
  source_type text,                        -- record | file | report | computed
  source_ref text,                         -- table:id / sheet:row / page
  source_url text,
  weight numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_evidence_rec ON public.ai_evidence_items (recommendation_id);

-- ---- Human feedback on recommendations -------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_agent_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.ai_recommendations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,                    -- accept | dismiss | request_review | create_task | create_approval
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_rec ON public.ai_agent_feedback (recommendation_id);

-- ---- Lead scoring ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL,
  score int NOT NULL,                      -- 0..100
  band text NOT NULL,                      -- hot | warm | cool | cold
  reason_codes text[],
  evidence jsonb,
  missing_information text[],
  next_best_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_scores_lead ON public.lead_scores (lead_id);

-- ---- Duplicate detection ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.duplicate_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,               -- company | contact | project
  match_reason text,
  matched_fields text[],
  confidence numeric(5,2),
  status text NOT NULL DEFAULT 'open',     -- open | merged | dismissed
  run_id uuid REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.duplicate_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.duplicate_groups(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  display_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dupe_members_group ON public.duplicate_group_members (group_id);

-- ---- ProTenders ingestion (manual CSV/XLSX path when API not configured) ---
CREATE TABLE IF NOT EXISTS public.protenders_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'manual',   -- manual | api
  filename text,
  format text,                             -- csv | xlsx
  status text NOT NULL DEFAULT 'uploaded', -- uploaded | parsed | failed | not_configured
  row_count int NOT NULL DEFAULT 0,
  notes text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.protenders_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES public.protenders_imports(id) ON DELETE CASCADE,
  project_name text,
  main_contractor text,
  package text,
  stage text,
  source_date date,
  evidence_url text,
  evidence_text text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- BOQ extraction --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.boq_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_url text,
  source_type text,                        -- pdf | excel
  status text NOT NULL DEFAULT 'pending',  -- pending | extracted | requires_manual_review | not_configured
  related_opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  notes text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.extracted_boq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES public.boq_extractions(id) ON DELETE CASCADE,
  item_description text,
  sign_type text,
  quantity numeric,
  unit text,
  uncertain boolean NOT NULL DEFAULT false,
  source_ref text,                         -- page / sheet:row
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- Grants + RLS ----------------------------------------------------------
-- All AI tables: readable by any authenticated user; writes happen through the
-- backend (service_role) which bypasses RLS. Feedback is the one client-write.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ai_agent_runs','ai_recommendations','ai_evidence_items','ai_agent_feedback',
    'lead_scores','duplicate_groups','duplicate_group_members',
    'protenders_imports','protenders_projects','boq_extractions','extracted_boq_items'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      tbl || '_readable', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      tbl || '_readable', tbl);
  END LOOP;
END $$;

-- Authenticated users may record their own feedback.
GRANT INSERT ON public.ai_agent_feedback TO authenticated;
DROP POLICY IF EXISTS ai_agent_feedback_insert_own ON public.ai_agent_feedback;
CREATE POLICY ai_agent_feedback_insert_own ON public.ai_agent_feedback
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
