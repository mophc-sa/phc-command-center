-- =============================================================================
-- Review 81/82 item 26 (Omar, 2026-11-22): a deal moves to Projects as soon as
-- it is signed.
--
-- create_project_from_won_opportunity existed but fired only when the legacy
-- `stage` column became 'won'. Signing sets sales_stage = 'contract_signed' and
-- leaves `stage` at 'quotation', and the master list import set won deals
-- directly — so 22 of 27 won deals had no project. It now fires on the sales
-- stage: contract signed or won, whichever comes first.
--
-- Backfill: each won / signed deal without a project gets one. A deal whose
-- name matches exactly one existing project is linked to it instead of a copy.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_project_from_won_opportunity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _project_id uuid;
BEGIN
  -- coalesce: a NULL sales stage must read as "not signed", not as unknown —
  -- NOT (NULL IN (...)) is NULL and would skip the project silently.
  IF NEW.project_id IS NULL
     AND (coalesce(NEW.sales_stage::text, '') IN ('contract_signed', 'won') OR coalesce(NEW.stage::text, '') = 'won')
     AND NOT (coalesce(OLD.sales_stage::text, '') IN ('contract_signed', 'won') OR coalesce(OLD.stage::text, '') = 'won') THEN

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
                         'sales_stage', NEW.sales_stage,
                         'owner_id', COALESCE(NEW.owner_id, NEW.created_by))
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_project_from_won_opportunity ON public.opportunities;
CREATE TRIGGER trg_create_project_from_won_opportunity
  BEFORE UPDATE OF stage, sales_stage ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.create_project_from_won_opportunity();

-- Backfill ---------------------------------------------------------------------
DO $$
DECLARE
  o record;
  _match uuid[];
  _project_id uuid;
BEGIN
  FOR o IN
    SELECT * FROM public.opportunities
     WHERE project_id IS NULL AND stage <> 'archived'
       AND (sales_stage IN ('contract_signed', 'won') OR stage = 'won')
  LOOP
    SELECT array_agg(p.id) INTO _match FROM public.projects p
     WHERE lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(o.project_name), '\s+', ' ', 'g'));
    IF cardinality(_match) = 1 THEN
      _project_id := _match[1];
    ELSE
      INSERT INTO public.projects (name, location, sector, owner_company_id, main_contractor_id,
                                   total_value, currency, project_stage, source, owner_id)
      VALUES (o.project_name, o.location, o.sector, o.company_id, o.main_contractor_id,
              COALESCE(o.contract_value, o.quotation_value, o.estimated_value_max, o.estimated_value_min),
              COALESCE(o.currency, 'SAR'), 'awarded', 'opportunity_won', COALESCE(o.owner_id, o.created_by))
      RETURNING id INTO _project_id;
    END IF;
    UPDATE public.opportunities SET project_id = _project_id WHERE id = o.id;
    INSERT INTO public.audit_log (actor_type, action, entity_type, entity_id, after_value)
    VALUES ('system', 'project.linked_on_signing_backfill', 'project', _project_id,
            jsonb_build_object('opportunity_id', o.id, 'linked_existing', cardinality(_match) = 1));
  END LOOP;
END $$;
