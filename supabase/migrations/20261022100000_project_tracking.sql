-- =============================================================================
-- Project tracking (manager feedback group 4, 2026-10-19).
-- Spec: docs/superpowers/specs/2026-10-19-project-tracking-design.md
--
-- 1. opportunity_updates — the update log inside each project ("offer sent",
--    "PO received", "awaiting payment"). An update may carry the new
--    construction %, which then becomes the opportunity's completion_pct, so
--    the figure on the home page always has a dated entry behind it.
-- 2. The contact person's job title, asked at intake and kept on the deal.
-- 3. A closed deal's win probability: won = 100, lost = 0.
-- 4. Only the sales manager changes a project number (bd_manager dropped;
--    system_admin kept for repairs).
-- 5. When the Production project's number is issued (still only after a
--    verified BOQ), it is the deal's RFQ number, so one number runs from intake
--    to RFQ to opportunity to project.
-- =============================================================================

-- ---- 1. Update log -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_updates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN (
                   'offer_sent', 'revised_offer_sent', 'po_received', 'contract_signed',
                   'awaiting_payment', 'payment_received', 'awaiting_client', 'site_visit',
                   'progress_update', 'other')),
  note           text,
  -- Construction progress reported with this update. NULL = not reported,
  -- which is not 0 (see opportunities.completion_pct).
  completion_pct smallint CHECK (completion_pct IS NULL OR completion_pct BETWEEN 0 AND 100),
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- "Other" says nothing without a note; a progress update says nothing without a figure.
  CONSTRAINT opportunity_updates_other_needs_note
    CHECK (kind <> 'other' OR nullif(btrim(note), '') IS NOT NULL),
  CONSTRAINT opportunity_updates_progress_needs_pct
    CHECK (kind <> 'progress_update' OR completion_pct IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_updates_opp
  ON public.opportunity_updates (opportunity_id, created_at DESC);

COMMENT ON TABLE public.opportunity_updates IS
  'Dated status updates inside a project (offer sent, PO received, awaiting payment, ...). An update with completion_pct also sets opportunities.completion_pct.';

GRANT SELECT, INSERT, DELETE ON public.opportunity_updates TO authenticated;
GRANT ALL ON public.opportunity_updates TO service_role;
ALTER TABLE public.opportunity_updates ENABLE ROW LEVEL SECURITY;

-- Readable exactly where the deal is readable: the subquery runs under the
-- caller's opportunities RLS (sales data isolation, 20260727170000).
DROP POLICY IF EXISTS "Updates readable with the deal" ON public.opportunity_updates;
CREATE POLICY "Updates readable with the deal" ON public.opportunity_updates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_id));

-- Anyone on the sales side who can see the deal can post to it, as themselves.
DROP POLICY IF EXISTS "Updates posted by the sales team" ON public.opportunity_updates;
CREATE POLICY "Updates posted by the sales team" ON public.opportunity_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.is_sales_contributor((SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_id)
  );

-- A slip can be taken back the same day; after that the log is history.
DROP POLICY IF EXISTS "Updates removable by author same day or operator" ON public.opportunity_updates;
CREATE POLICY "Updates removable by author same day or operator" ON public.opportunity_updates
  FOR DELETE TO authenticated
  USING (
    (created_by = (SELECT auth.uid()) AND created_at > now() - interval '24 hours')
    OR public.is_pipeline_operator((SELECT auth.uid()))
  );

-- The poster may not own the deal's row-level UPDATE right in every case the
-- insert policy allows, so the copy runs as definer. It only ever writes the
-- two columns the update speaks for.
CREATE OR REPLACE FUNCTION public.apply_opportunity_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.opportunities
     SET completion_pct   = COALESCE(NEW.completion_pct, completion_pct),
         last_activity_at = now()
   WHERE id = NEW.opportunity_id;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.apply_opportunity_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apply_opportunity_update ON public.opportunity_updates;
CREATE TRIGGER trg_apply_opportunity_update
  AFTER INSERT ON public.opportunity_updates
  FOR EACH ROW EXECUTE FUNCTION public.apply_opportunity_update();

-- ---- 2. Contact job title ----------------------------------------------------
ALTER TABLE public.inbox_items  ADD COLUMN IF NOT EXISTS contact_title text;
ALTER TABLE public.stakeholders ADD COLUMN IF NOT EXISTS title text;

COMMENT ON COLUMN public.inbox_items.contact_title IS
  'Job title of the contact person, asked at intake. Carried to contacts.title and stakeholders.title on conversion.';
COMMENT ON COLUMN public.stakeholders.title IS
  'Job title of this person (e.g. Procurement Manager). Distinct from role/role_code, which say what they are to this deal.';

-- ---- 3. Closed deals: won = 100, lost = 0 ------------------------------------
CREATE OR REPLACE FUNCTION public.set_probability_on_close()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _was_won  boolean := OLD.stage = 'won' OR OLD.sales_stage = 'won';
  _is_won   boolean := NEW.stage = 'won' OR NEW.sales_stage = 'won';
  _was_lost boolean := OLD.stage = 'lost' OR OLD.sales_stage = 'lost';
  _is_lost  boolean := NEW.stage = 'lost' OR NEW.sales_stage = 'lost';
BEGIN
  IF _is_won AND NOT _was_won THEN
    NEW.human_win_probability    := 100;
    NEW.human_probability_reason := 'Closed won';
    NEW.human_probability_by     := auth.uid();
    NEW.human_probability_at     := now();
  ELSIF _is_lost AND NOT _was_lost THEN
    NEW.human_win_probability    := 0;
    NEW.human_probability_reason := 'Closed lost';
    NEW.human_probability_by     := auth.uid();
    NEW.human_probability_at     := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_probability_on_close ON public.opportunities;
CREATE TRIGGER trg_set_probability_on_close
  BEFORE UPDATE OF stage, sales_stage ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_probability_on_close();

-- Backfill: every closed deal whose probability says otherwise, each change audited.
WITH changed AS (
  UPDATE public.opportunities o
     SET human_win_probability    = x.target,
         human_probability_reason = CASE WHEN x.target = 100 THEN 'Closed won' ELSE 'Closed lost' END,
         human_probability_at     = now()
    FROM (
      SELECT id, human_win_probability AS before,
             CASE WHEN stage = 'won' OR sales_stage = 'won' THEN 100 ELSE 0 END AS target
        FROM public.opportunities
       WHERE (stage IN ('won', 'lost') OR sales_stage IN ('won', 'lost'))
    ) x
   WHERE o.id = x.id
     AND o.human_win_probability IS DISTINCT FROM x.target
  RETURNING o.id, x.before, x.target
)
INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
SELECT NULL, 'system', 'opportunity.probability_closed_backfill', 'opportunity', id,
       to_jsonb(before), to_jsonb(target)
  FROM changed;

-- ---- 4. Only the sales manager changes the number ----------------------------
-- The manager, 2026-10-19: "only the sales manager edits the project number".
-- system_admin stays for repairs. Unauthorized edits keep being discarded
-- quietly by generate_rfq_number(), as before.
CREATE OR REPLACE FUNCTION public.can_edit_rfq_number(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['sales_manager', 'system_admin']::public.app_role[]
  );
$$;

-- ---- 5. The Production project keeps the deal's number -----------------------
-- Project numbers are still issued only once a verified BOQ exists (Phase 5
-- governance, 20260820100000) — that rule is untouched. What changes is WHICH
-- number is issued: the RFQ number of the deal behind the project, so the code a
-- rep quoted from intake is the code Production and Finance file under. A fresh
-- PRJ-YYYY-NNNN is the fallback when the deal has no number or a project
-- already holds it.
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

  RETURN COALESCE(_number,
    'PRJ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.project_number_seq')::text, 4, '0'));
END $$;

REVOKE ALL ON FUNCTION public.next_project_number(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.next_project_number(uuid) IS
  'The number to issue a project: its deal''s RFQ number (won deal first, then newest), else a fresh PRJ-YYYY-NNNN. Callers must already have passed the BOQ rule.';

CREATE OR REPLACE FUNCTION public.generate_project_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Unchanged from 20260820100000 except for the number itself: a new project
  -- never auto-numbers, and an existing one does once a valid BOQ exists.
  IF TG_OP = 'UPDATE' AND public.project_has_valid_boq(NEW.id) THEN
    NEW.project_number := public.next_project_number(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_project_number(_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing TEXT;
  _number   TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_commercial_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only a commercial manager may issue a project number. | إصدار رقم المشروع يقتصر على مدير تجاري.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT project_number INTO _existing FROM public.projects WHERE id = _project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found. | المشروع غير موجود.' USING ERRCODE = 'no_data_found';
  END IF;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  IF NOT public.project_has_valid_boq(_project_id) THEN
    RAISE EXCEPTION '%', public.project_number_denied_message()
      USING ERRCODE = 'check_violation';
  END IF;

  _number := public.next_project_number(_project_id);

  UPDATE public.projects SET project_number = _number WHERE id = _project_id;

  RETURN _number;
END;
$$;

COMMENT ON FUNCTION public.issue_project_number IS
  'Issues a project its number — the deal''s RFQ number when there is one, else PRJ-YYYY-NNNN — only when a verified or partially_verified BOQ exists and the caller holds commercial authority. Idempotent.';
