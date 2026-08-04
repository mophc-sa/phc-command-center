-- =========================================================
-- Auto-create/link a Project when an Opportunity is won (2026-08-03
-- client clarification): Projects belong to Production, not Sales — the
-- only connection between the two departments is this one handoff moment
-- ("الارتباط مع قسم المبيعات معهم فقط عند اغلاق الفرصة تتحول لمشروع").
--
-- Three independent code paths can set opportunities.stage = 'won':
--   1. sales-os-api's update_opportunity_stage handler
--      (supabase/functions/sales-os-api/handlers/pipeline.ts)
--   2. dispatchApprovalAction's "update_opportunity_stage" case, run when
--      a pending stage-change approval is granted (shared.ts)
--   3. applySalesStage's "won" branch of the direct RFQ/JIH sales_stage
--      machine (shared.ts) — also reachable via an approval
-- All three run through the sales-os-api Edge Function under the
-- service-role key (auth.uid() IS NULL), so a single database trigger is
-- the only place that reliably sees every one of them — a TS-level hook
-- would have to be duplicated in three call sites and would still miss
-- direct SQL/service-role writes (e.g. data import).
--
-- Per the existing multi-contractor design (Phase 5 — see
-- src/lib/phase5-multi-contractor-monitoring.contract.test.ts and
-- executeTenderConversion in shared.ts, which already sets project_id
-- when converting an awarded tender), several opportunities can
-- legitimately already share one projects.id before any of them wins.
-- This trigger only creates a new project when the winning opportunity
-- doesn't already have one — it never overwrites an existing link, so it
-- can't create duplicates for that shared-project case.
-- =========================================================

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
      total_value, currency, project_stage, source
    ) VALUES (
      NEW.project_name, NEW.location, NEW.sector, NEW.company_id, NEW.main_contractor_id,
      COALESCE(NEW.contract_value, NEW.quotation_value, NEW.estimated_value_max, NEW.estimated_value_min),
      COALESCE(NEW.currency, 'SAR'), 'awarded', 'opportunity_won'
    )
    RETURNING id INTO _project_id;

    NEW.project_id := _project_id;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (
      auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
      'project.auto_created_from_won_opportunity', 'project', _project_id,
      NULL,
      jsonb_build_object('project_id', _project_id, 'opportunity_id', NEW.id, 'opportunity_project_name', NEW.project_name)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_project_from_won_opportunity ON public.opportunities;
CREATE TRIGGER trg_create_project_from_won_opportunity
  BEFORE UPDATE OF stage ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.create_project_from_won_opportunity();
