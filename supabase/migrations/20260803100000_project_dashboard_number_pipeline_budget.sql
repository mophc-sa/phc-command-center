-- =========================================================
-- Project page → dashboard upgrade (2026-08-03 client request):
--   1. Automatic project_number on every new project.
--   2. cover_image_url for a project cover photo.
--   3. A flexible, user-defined Job Pipeline (Kanban): stages are rows the
--      user adds/renames/reorders/deletes per project (explicitly NOT a
--      fixed enum — "خليها مرنة تتم اضافتها حسب كل مرحلة يدوية... وتتم
--      معالجتها يدويًا أو باستخدام الـ AI لاحقًا"), and jobs are cards
--      placed into a stage.
--   4. project_budget_items — a simple manual budget line-item list,
--      write-gated to the same roles that already own commercial "Total
--      Value" edits (finance_manager/bd_manager/system_admin), as a
--      placeholder ahead of real Finance-module integration.
-- =========================================================

-- ---- 1. project_number auto-numbering --------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.project_number_seq;

-- cover_image_path stores the private `attachments` bucket storage path
-- (not a URL) — the bucket is private, so display always goes through a
-- freshly re-signed URL (see getProjectCoverUrl in
-- src/lib/project-cover-actions.ts) rather than a URL that would expire.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_number text,
  ADD COLUMN IF NOT EXISTS cover_image_path text;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_project_number_key;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_project_number_key UNIQUE (project_number);

CREATE OR REPLACE FUNCTION public.generate_project_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.project_number IS NULL THEN
    NEW.project_number := 'PRJ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.project_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_project_number ON public.projects;
CREATE TRIGGER trg_generate_project_number
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.generate_project_number();

-- Backfill existing projects so every row has a number, oldest first.
DO $$
DECLARE
  _row RECORD;
BEGIN
  FOR _row IN SELECT id FROM public.projects WHERE project_number IS NULL ORDER BY created_at ASC LOOP
    UPDATE public.projects
      SET project_number = 'PRJ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.project_number_seq')::text, 4, '0')
      WHERE id = _row.id;
  END LOOP;
END $$;

-- ---- 2. Job Pipeline (Kanban) — user-defined stages + jobs -----------------
CREATE TABLE public.project_job_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_job_stages_project ON public.project_job_stages(project_id, position);
CREATE TRIGGER trg_project_job_stages_updated_at BEFORE UPDATE ON public.project_job_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.project_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.project_job_stages(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT,
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date DATE,
  position INT NOT NULL DEFAULT 0,
  -- Free-form note field earmarked for the "manual now, AI-assisted later"
  -- processing path the client asked for — not read/written by any AI
  -- agent yet.
  ai_notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_jobs_stage ON public.project_jobs(stage_id, position);
CREATE INDEX idx_project_jobs_project ON public.project_jobs(project_id);
CREATE TRIGGER trg_project_jobs_updated_at BEFORE UPDATE ON public.project_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_job_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_jobs TO authenticated;
GRANT ALL ON public.project_job_stages TO service_role;
GRANT ALL ON public.project_jobs TO service_role;
ALTER TABLE public.project_job_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_jobs ENABLE ROW LEVEL SECURITY;

-- Same write authority as the parent project itself (is_sales_contributor
-- OR system_admin — see 20260801160000_dev_manager_admin_record_authority.sql).
CREATE POLICY "Job stages readable" ON public.project_job_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Job stages writable by project team" ON public.project_job_stages FOR ALL TO authenticated
  USING (public.is_sales_contributor(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]))
  WITH CHECK (public.is_sales_contributor(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));

CREATE POLICY "Jobs readable" ON public.project_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Jobs writable by project team" ON public.project_jobs FOR ALL TO authenticated
  USING (public.is_sales_contributor(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]))
  WITH CHECK (public.is_sales_contributor(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));

-- Seed 3 generic starter columns for every newly created project — fully
-- editable/renameable/deletable, not a fixed set (just a friendlier empty
-- state than an entirely blank board).
CREATE OR REPLACE FUNCTION public.seed_default_project_job_stages()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.project_job_stages (project_id, name, position) VALUES
    (NEW.id, 'To Do', 0),
    (NEW.id, 'In Progress', 1),
    (NEW.id, 'Done', 2);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_default_project_job_stages
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_project_job_stages();

-- ---- 3. Budget — manual line items, Finance-adjacent write authority -------
CREATE TABLE public.project_budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (btrim(category) <> ''),
  description TEXT,
  planned_amount NUMERIC(14,2),
  actual_amount NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_budget_items_project ON public.project_budget_items(project_id);
CREATE TRIGGER trg_project_budget_items_updated_at BEFORE UPDATE ON public.project_budget_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_budget_items TO authenticated;
GRANT ALL ON public.project_budget_items TO service_role;
ALTER TABLE public.project_budget_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Budget items readable" ON public.project_budget_items FOR SELECT TO authenticated USING (true);
-- Reuses can_edit_total_value() (finance_manager/bd_manager/system_admin —
-- 20260727180000_rfq_fields_numbering_total_value.sql), the same role set
-- that already owns commercial value edits elsewhere in this schema.
CREATE POLICY "Budget items writable by finance-adjacent roles" ON public.project_budget_items FOR ALL TO authenticated
  USING (public.can_edit_total_value(auth.uid()))
  WITH CHECK (public.can_edit_total_value(auth.uid()));
