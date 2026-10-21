-- =============================================================================
-- A project has an owner, and its owner may edit it.
--
-- Spec: docs/superpowers/specs/2026-10-21-project-owner-design.md
--
-- Measured before writing this (2026-10-21, production): `projects` had no owner
-- column at all, 40 projects existed, `created_by` was set on 2 of them, and no
-- project was linked to any opportunity — so ownership could not be derived from
-- a deal. A salesperson could already edit projects and their jobs; the one
-- thing closed to them was the budget.
--
-- THE RULES
--
--   Project data (projects, project_jobs, project_job_stages):
--     pipeline operators and system_admin — always;
--     a salesperson — a project they own, OR a project nobody owns.
--
--   Editing an unowned project CLAIMS it: the first salesperson to change one
--   becomes its owner. Most projects in production are unassigned, and the
--   person who edits one is the person working it. Claiming is recorded.
--
--   The budget (project_budget_items) is narrower and deliberately so: the
--   ASSIGNED owner, plus finance/BD as before. An unowned project's budget stays
--   closed, so a salesperson reaches it only after the project is theirs. These
--   are cost figures, days after the deal money columns were hardened (PR 352).
--
-- Nothing is backfilled: the 40 existing projects keep no owner rather than
-- inherit a guess from imported data.
-- =============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_owner ON public.projects(owner_id) WHERE owner_id IS NOT NULL;

COMMENT ON COLUMN public.projects.owner_id IS
  'The salesperson responsible for this project. Set when they create it, when a won deal creates it (the deal owner), when they first edit an unowned one, or by a pipeline operator. NULL means unassigned: project data stays open to the sales team, but the budget stays closed. Deleting the user returns the project to unassigned.';

-- ---- 1. One rule, in one place --------------------------------------------
CREATE OR REPLACE FUNCTION public.can_edit_project(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_pipeline_operator(_user_id)
      OR public.has_any_role(_user_id, ARRAY['system_admin']::public.app_role[])
      OR (
        public.is_sales_contributor(_user_id)
        AND EXISTS (
          SELECT 1 FROM public.projects p
           WHERE p.id = _project_id
             AND (p.owner_id = _user_id OR p.owner_id IS NULL)
        )
      );
$$;

REVOKE ALL ON FUNCTION public.can_edit_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_project(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.can_edit_project IS
  'Who may change a project and its jobs: pipeline operators and system_admin always; a sales contributor for a project they own or that nobody owns. Mirrored in TypeScript by canEditProject (src/lib/roles.ts) — a contract test fails if the two drift.';

CREATE OR REPLACE FUNCTION public.can_edit_project_budget(_project_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_total_value(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = _project_id
           AND p.owner_id IS NOT NULL
           AND p.owner_id = _user_id
      );
$$;

REVOKE ALL ON FUNCTION public.can_edit_project_budget(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_project_budget(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.can_edit_project_budget IS
  'Who may change a project budget: finance/BD (can_edit_total_value) or the project''s ASSIGNED owner. An unowned project''s budget is closed — cost figures are not open to whoever happens to be looking.';

-- ---- 2. Claiming, and protecting an existing owner -------------------------
CREATE OR REPLACE FUNCTION public.project_owner_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Service-role callers (imports, the won-deal trigger) set the owner they
  -- mean and are not subject to this; the guard is about authenticated users.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Editing a project nobody owns makes the editor its owner.
  IF OLD.owner_id IS NULL
     AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id
     AND public.is_sales_contributor(_uid) THEN
    NEW.owner_id := _uid;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    -- Reassigning a project that already has an owner is a manager's decision.
    -- Claiming an unassigned one is not.
    IF OLD.owner_id IS NOT NULL AND NOT public.is_pipeline_operator(_uid) THEN
      RAISE EXCEPTION 'Only a sales or BD manager may reassign a project that already has an owner'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (_uid, 'user',
            CASE WHEN OLD.owner_id IS NULL THEN 'project.owner_claimed' ELSE 'project.owner_assigned' END,
            'project', NEW.id, to_jsonb(OLD.owner_id), to_jsonb(NEW.owner_id));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_project_owner_guard ON public.projects;
CREATE TRIGGER trg_project_owner_guard
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.project_owner_guard();

-- ---- 3. A project created by a won deal belongs to that deal's owner -------
CREATE OR REPLACE FUNCTION public.create_project_from_won_opportunity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _project_id uuid;
BEGIN
  IF NEW.stage = 'won'
     AND OLD.stage IS DISTINCT FROM 'won'
     AND NEW.project_id IS NULL THEN

    INSERT INTO public.projects (
      name, location, sector, owner_company_id, main_contractor_id,
      total_value, currency, project_stage, source, owner_id
    ) VALUES (
      NEW.project_name, NEW.location, NEW.sector, NEW.company_id, NEW.main_contractor_id,
      COALESCE(NEW.contract_value, NEW.quotation_value, NEW.estimated_value_max, NEW.estimated_value_min),
      COALESCE(NEW.currency, 'SAR'), 'awarded', 'opportunity_won',
      -- The person who won it keeps it, rather than the project arriving with
      -- nobody responsible for it.
      COALESCE(NEW.owner_id, NEW.created_by)
    )
    RETURNING id INTO _project_id;

    NEW.project_id := _project_id;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (
      auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
      'project.auto_created_from_won_opportunity', 'project', _project_id,
      NULL,
      jsonb_build_object('project_id', _project_id, 'opportunity_id', NEW.id,
                         'opportunity_project_name', NEW.project_name,
                         'owner_id', COALESCE(NEW.owner_id, NEW.created_by))
    );
  END IF;
  RETURN NEW;
END $$;

-- ---- 4. Policies -----------------------------------------------------------
DROP POLICY IF EXISTS "Projects updatable by sales team" ON public.projects;
CREATE POLICY "Projects updatable by their owner or an operator" ON public.projects
  FOR UPDATE TO authenticated
  USING (public.can_edit_project(id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_project(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Jobs writable by project team" ON public.project_jobs;
CREATE POLICY "Project jobs editable with their project" ON public.project_jobs
  FOR ALL TO authenticated
  USING (public.can_edit_project(project_id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_project(project_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Job stages writable by project team" ON public.project_job_stages;
CREATE POLICY "Project job stages editable with their project" ON public.project_job_stages
  FOR ALL TO authenticated
  USING (public.can_edit_project(project_id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_project(project_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Budget items writable by finance-adjacent roles" ON public.project_budget_items;
CREATE POLICY "Project budget editable by its owner or finance" ON public.project_budget_items
  FOR ALL TO authenticated
  USING (public.can_edit_project_budget(project_id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_project_budget(project_id, (SELECT auth.uid())));
