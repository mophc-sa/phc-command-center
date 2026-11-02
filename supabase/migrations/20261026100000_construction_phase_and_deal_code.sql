-- =============================================================================
-- Construction phase on the site, and a project code for every deal
-- (manager feedback 2026-10-19, the two items #351 left partly done).
--
-- 1. The site's stage. The manager asked for "the current stage (excavation,
--    design, execution...)" in the intake form and on the home page. The deal
--    already has one: opportunities.project_stage (early_planning ...
--    under_construction ... completed), the same list projects use and the
--    scoring reads. What it lacked was the phases inside construction, so the
--    list gains excavation, structure and mep_finishing between
--    under_construction and near_handover. One field, not a second "phase"
--    beside it that could disagree with it.
--    The intake form asks it (inbox_items.project_stage, NULL = nobody said),
--    conversion carries it to the deal, and a project update can report it the
--    way it reports the construction % (opportunity_updates.project_stage).
--
-- 2. The deal's code. A deal with no RFQ had no <CODE>-<YY>-<NNNN> number, so
--    its Production project fell back to PRJ-YYYY-NNNN. opportunities.project_code
--    holds the deal's code:
--      - a deal created with an owner, or later given one, and with no numbered
--        RFQ draws a code from the RFQ sequence with its OWNER's sales code;
--      - an RFQ raised for a deal takes the deal's code instead of a second one;
--      - when a deal's RFQ carries a number (an intake code, a manager's
--        override), the deal's code follows it, so the two never disagree.
--    Only can_edit_rfq_number (sales_manager, system_admin) may change it by
--    hand; anyone else's edit is discarded quietly, as for RFQ numbers.
--    next_project_number() falls back to the deal's code before PRJ-.
--    Existing deals are backfilled, each with an audit_log row.
-- =============================================================================

-- ---- 1. Construction phases --------------------------------------------------
-- Not used as literals anywhere in this file: a value added here cannot be
-- used until the transaction commits.
ALTER TYPE public.project_stage ADD VALUE IF NOT EXISTS 'excavation'    BEFORE 'near_handover';
ALTER TYPE public.project_stage ADD VALUE IF NOT EXISTS 'structure'     BEFORE 'near_handover';
ALTER TYPE public.project_stage ADD VALUE IF NOT EXISTS 'mep_finishing' BEFORE 'near_handover';

ALTER TABLE public.inbox_items ADD COLUMN IF NOT EXISTS project_stage public.project_stage;

COMMENT ON COLUMN public.inbox_items.project_stage IS
  'Where the project stands on site, asked at intake (design, excavation, structure, ...). NULL = nobody said. Carried to opportunities.project_stage on conversion.';

ALTER TABLE public.opportunity_updates ADD COLUMN IF NOT EXISTS project_stage public.project_stage;

COMMENT ON COLUMN public.opportunity_updates.project_stage IS
  'Site stage reported with this update. NULL = not reported. An update with a stage also sets opportunities.project_stage.';

-- A progress update reports progress: a %, a stage, or both.
ALTER TABLE public.opportunity_updates DROP CONSTRAINT IF EXISTS opportunity_updates_progress_needs_pct;
ALTER TABLE public.opportunity_updates DROP CONSTRAINT IF EXISTS opportunity_updates_progress_needs_figure;
ALTER TABLE public.opportunity_updates ADD CONSTRAINT opportunity_updates_progress_needs_figure
  CHECK (kind <> 'progress_update' OR completion_pct IS NOT NULL OR project_stage IS NOT NULL);

CREATE OR REPLACE FUNCTION public.apply_opportunity_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.opportunities
     SET completion_pct   = COALESCE(NEW.completion_pct, completion_pct),
         project_stage    = COALESCE(NEW.project_stage, project_stage),
         last_activity_at = now()
   WHERE id = NEW.opportunity_id;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.apply_opportunity_update() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.opportunity_updates IS
  'Dated status updates inside a project (offer sent, PO received, awaiting payment, ...). An update with completion_pct or project_stage also sets them on the opportunity.';

-- ---- 2. The deal's code ------------------------------------------------------
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS project_code text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_project_code_key') THEN
    ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_project_code_key UNIQUE (project_code);
  END IF;
END $$;

COMMENT ON COLUMN public.opportunities.project_code IS
  'The deal''s code, <SALES_CODE>-<YY>-<NNNN> (e.g. FA-26-0001). Its RFQ''s number when it has one; otherwise drawn from the RFQ sequence with the owner''s code. Changed by hand only by can_edit_rfq_number.';

CREATE OR REPLACE FUNCTION public.generate_opportunity_project_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old  text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.project_code ELSE NULL END;
  _uid  uuid := auth.uid();
  _code text;
  -- Taking the number of one of the deal's own RFQs is not a hand edit: that
  -- is sync_deal_code_from_rfq() keeping the two in step.
  _from_rfq boolean := EXISTS (SELECT 1 FROM public.rfqs r
                                WHERE r.opportunity_id = NEW.id AND r.rfq_number = NEW.project_code);
BEGIN
  -- A hand edit by someone without the right is discarded quietly, as for RFQ
  -- numbers.
  IF NEW.project_code IS DISTINCT FROM _old
     AND _uid IS NOT NULL
     AND NOT _from_rfq
     AND NOT public.can_edit_rfq_number(_uid) THEN
    NEW.project_code := _old;
  END IF;

  IF NEW.project_code IS NULL
     AND NEW.owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rfqs r
                      WHERE r.opportunity_id = NEW.id AND r.rfq_number IS NOT NULL) THEN
    _code := public.sales_code_for(NEW.owner_id);
    NEW.project_code :=
      COALESCE(_code || '-', '') ||
      to_char(now(), 'YY') || '-' ||
      lpad(nextval('public.rfq_number_seq')::text, 4, '0');

  -- Still differs from before, so it survived the guard: a hand edit by
  -- someone allowed to make it.
  ELSIF NEW.project_code IS DISTINCT FROM _old
        AND _uid IS NOT NULL
        AND NOT _from_rfq THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (_uid, 'user', 'opportunity.project_code_overridden', 'opportunity', NEW.id,
            to_jsonb(_old), to_jsonb(NEW.project_code));
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.generate_opportunity_project_code() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.generate_opportunity_project_code() IS
  'Gives a deal with an owner and no numbered RFQ its code, <OWNER CODE>-<YY>-<NNNN>, from the RFQ sequence; discards hand edits by anyone without can_edit_rfq_number and audits those who have it.';

DROP TRIGGER IF EXISTS trg_generate_opportunity_project_code ON public.opportunities;
CREATE TRIGGER trg_generate_opportunity_project_code
  BEFORE INSERT OR UPDATE OF project_code, owner_id ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.generate_opportunity_project_code();

-- The RFQ raised for a deal takes the deal's code. Unchanged from
-- 20260930140000 except for the second inheritance block.
CREATE OR REPLACE FUNCTION public.generate_rfq_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_number text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rfq_number ELSE NULL END;
  _code       text;
  _uid        uuid := auth.uid();
  _inherited  text;
BEGIN
  -- Unauthorized manual value from an authenticated end user: discard it
  -- quietly and fall through to auto-generation (the write still succeeds).
  -- auth.uid() IS NULL means a trusted service-role caller — e.g. data import
  -- committing a source file's own number — which is not subject to this.
  IF NEW.rfq_number IS NOT NULL
     AND NEW.rfq_number IS DISTINCT FROM _old_number
     AND _uid IS NOT NULL
     AND NOT public.can_edit_rfq_number(_uid) THEN
    NEW.rfq_number := _old_number;
  END IF;

  -- Converted from an intake: keep the intake's code. The intake must still be
  -- open, the caller must be someone who may convert it (the same test as the
  -- intake UPDATE policy), and the code must be unused — otherwise number as usual.
  IF NEW.rfq_number IS NULL AND TG_OP = 'INSERT' AND NEW.source_inbox_id IS NOT NULL THEN
    SELECT i.project_number INTO _inherited
      FROM public.inbox_items i
     WHERE i.id = NEW.source_inbox_id
       AND i.project_number ~ '^[A-Z]{2,3}-[0-9]{2}-[0-9]{4,}$'
       AND i.status NOT IN ('converted', 'archived', 'marked_duplicate')
       AND (_uid IS NULL
            OR i.created_by = _uid
            OR i.assigned_owner_id = _uid
            OR public.is_pipeline_operator(_uid))
       AND NOT EXISTS (SELECT 1 FROM public.rfqs r WHERE r.rfq_number = i.project_number);
    NEW.rfq_number := _inherited;
  END IF;

  -- Raised for a deal that already has a code: the RFQ takes it, so the deal
  -- keeps one code. Only for someone who works that deal, and only while no
  -- other RFQ holds the code.
  IF NEW.rfq_number IS NULL AND TG_OP = 'INSERT' AND NEW.opportunity_id IS NOT NULL THEN
    SELECT o.project_code INTO _inherited
      FROM public.opportunities o
     WHERE o.id = NEW.opportunity_id
       AND o.project_code IS NOT NULL
       AND (_uid IS NULL
            OR o.owner_id = _uid
            OR o.created_by = _uid
            OR public.is_pipeline_operator(_uid))
       AND NOT EXISTS (SELECT 1 FROM public.rfqs r WHERE r.rfq_number = o.project_code);
    NEW.rfq_number := _inherited;
  END IF;

  IF NEW.rfq_number IS NULL THEN
    -- Prefer the owner's code, else the creator's, else the caller's.
    _code := public.sales_code_for(COALESCE(NEW.sales_owner_id, NEW.created_by, _uid));
    -- FA-26-0001. Without a code: 26-0001 — a number with no owner is still
    -- better than no number, and it is visibly missing its prefix.
    NEW.rfq_number :=
      COALESCE(_code || '-', '') ||
      to_char(now(), 'YY') || '-' ||
      lpad(nextval('public.rfq_number_seq')::text, 4, '0');

  ELSIF NEW.rfq_number IS DISTINCT FROM _old_number AND _uid IS NOT NULL
        AND NEW.rfq_number IS DISTINCT FROM _inherited THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (_uid, 'user', 'rfq.number_overridden', 'rfq', NEW.id,
            to_jsonb(_old_number), to_jsonb(NEW.rfq_number));
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.generate_rfq_number() IS
  'Generates rfq_number as <SALES_CODE>-<YY>-<NNNN>, e.g. FA-26-0001, from the owner''s code (then creator, then caller). An RFQ converted from an open intake (source_inbox_id) keeps the intake''s code; an RFQ raised for a deal that has a code keeps the deal''s. Format specified by Faisal 2026-08-06.';

-- The deal's code follows its RFQ's number: an RFQ from an intake brings the
-- intake's code, and a manager's override of the RFQ number moves the deal too.
-- Only when the RFQ comes from someone who works the deal (the test the
-- inheritance above uses) or who may set numbers: an RFQ someone else links to
-- the deal does not renumber it.
CREATE OR REPLACE FUNCTION public.sync_deal_code_from_rfq()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF NEW.opportunity_id IS NULL OR NEW.rfq_number IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.opportunities o
     SET project_code = NEW.rfq_number
   WHERE o.id = NEW.opportunity_id
     AND o.project_code IS DISTINCT FROM NEW.rfq_number
     AND (_uid IS NULL
          OR o.owner_id = _uid
          OR o.created_by = _uid
          OR public.is_pipeline_operator(_uid)
          OR public.can_edit_rfq_number(_uid))
     AND NOT EXISTS (SELECT 1 FROM public.opportunities x
                      WHERE x.project_code = NEW.rfq_number AND x.id <> o.id);
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.sync_deal_code_from_rfq() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_deal_code_from_rfq ON public.rfqs;
CREATE TRIGGER trg_sync_deal_code_from_rfq
  AFTER INSERT OR UPDATE OF rfq_number, opportunity_id ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_code_from_rfq();

-- The Production project falls back to the deal's code before PRJ-. Unchanged
-- from 20261022100000 except for that second lookup.
CREATE OR REPLACE FUNCTION public.next_project_number(_project_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _number text;
BEGIN
  SELECT r.rfq_number INTO _number
    FROM public.opportunities o
    JOIN public.rfqs r ON r.opportunity_id = o.id
   WHERE o.project_id = _project_id
     AND r.rfq_number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects p
                      WHERE p.project_number = r.rfq_number AND p.id <> _project_id)
   ORDER BY (o.stage = 'won' OR o.sales_stage = 'won') DESC, r.created_at DESC
   LIMIT 1;

  IF _number IS NULL THEN
    SELECT o.project_code INTO _number
      FROM public.opportunities o
     WHERE o.project_id = _project_id
       AND o.project_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.projects p
                        WHERE p.project_number = o.project_code AND p.id <> _project_id)
     ORDER BY (o.stage = 'won' OR o.sales_stage = 'won') DESC, o.created_at DESC
     LIMIT 1;
  END IF;

  RETURN COALESCE(_number,
    'PRJ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.project_number_seq')::text, 4, '0'));
END $$;

REVOKE ALL ON FUNCTION public.next_project_number(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.next_project_number(uuid) IS
  'The number to issue a project: its deal''s RFQ number (won deal first, then newest), else the deal''s own code, else a fresh PRJ-YYYY-NNNN. Callers must already have passed the BOQ rule.';

-- ---- 3. Backfill, each change audited ----------------------------------------
-- Deals with a numbered RFQ take its number (the newest RFQ, as the deal page
-- shows it). Deals with an owner and no RFQ draw a code, oldest deal first, in
-- the year the deal was created. Deals with no owner get theirs when assigned.
-- Runs with no auth.uid(), so the guard above does not apply. updated_at is
-- left alone: a code is not an edit to the deal, and lists sorted by "last
-- updated" should not all jump to today.
ALTER TABLE public.opportunities DISABLE TRIGGER trg_opportunities_updated_at;

DO $$
DECLARE
  r record;
  _new text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (o.id) o.id, rq.rfq_number
      FROM public.opportunities o
      JOIN public.rfqs rq ON rq.opportunity_id = o.id AND rq.rfq_number IS NOT NULL
     WHERE o.project_code IS NULL
     ORDER BY o.id, rq.created_at DESC
  LOOP
    UPDATE public.opportunities SET project_code = r.rfq_number
     WHERE id = r.id
       AND NOT EXISTS (SELECT 1 FROM public.opportunities x WHERE x.project_code = r.rfq_number);
    IF FOUND THEN
      INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
      VALUES (NULL, 'system', 'opportunity.project_code_backfilled', 'opportunity', r.id,
              'null'::jsonb, jsonb_build_object('project_code', r.rfq_number, 'source', 'rfq'));
    END IF;
  END LOOP;

  FOR r IN
    SELECT o.id, o.owner_id, o.created_at
      FROM public.opportunities o
     WHERE o.project_code IS NULL
       AND o.owner_id IS NOT NULL
     ORDER BY o.created_at, o.id
  LOOP
    _new := COALESCE(public.sales_code_for(r.owner_id) || '-', '') ||
            to_char(r.created_at, 'YY') || '-' ||
            lpad(nextval('public.rfq_number_seq')::text, 4, '0');

    UPDATE public.opportunities SET project_code = _new WHERE id = r.id;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (NULL, 'system', 'opportunity.project_code_backfilled', 'opportunity', r.id,
            'null'::jsonb, jsonb_build_object('project_code', _new, 'source', 'owner'));
  END LOOP;
END $$;

ALTER TABLE public.opportunities ENABLE TRIGGER trg_opportunities_updated_at;
