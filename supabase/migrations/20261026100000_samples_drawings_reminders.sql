-- =============================================================================
-- Samples, drawings and client reminders (manager feedback group 5, 2026-10-19).
-- Spec: docs/superpowers/specs/2026-10-22-samples-drawings-reminders-design.md
--
-- 1. deal_submittals + deal_submittal_steps — samples and drawings sent to the
--    client for a coded answer. One item per sample or drawing on a deal; every
--    step (who, when, notes) is a row in an append-only log. The order of steps
--    is enforced here, and mirrored in src/lib/submittals.ts.
-- 2. A sample request is the commercial manager's decision: only
--    is_commercial_manager may record approved / declined. Sales managers and
--    general managers are told about each request.
-- 3. follow_ups learn to repeat (monthly / yearly) and may belong to a client
--    company instead of a deal. Completing a repeating reminder schedules the
--    next one.
-- 4. A reminder due today notifies its owner. Deal-only automation rules keep to
--    deal reminders.
-- =============================================================================

-- ---- 1. Samples and drawings ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_submittals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('sample', 'drawing')),
  title           text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  -- State, written only by the step trigger (clients have no column grant).
  revision        smallint NOT NULL DEFAULT 0,
  current_step    text,
  client_response text,
  last_step_at    timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_submittals_opp
  ON public.deal_submittals (opportunity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_submittals_step
  ON public.deal_submittals (current_step, last_step_at DESC);

COMMENT ON TABLE public.deal_submittals IS
  'A sample or a drawing sent to the client for a coded answer. revision/current_step/client_response mirror the latest row in deal_submittal_steps and are written only by apply_submittal_step().';

CREATE TABLE IF NOT EXISTS public.deal_submittal_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submittal_id uuid NOT NULL REFERENCES public.deal_submittals(id) ON DELETE CASCADE,
  -- Set by check_submittal_step(): the first step of a new cycle starts the next revision.
  revision     smallint NOT NULL DEFAULT 0,
  step         text NOT NULL CHECK (step IN (
                 'requested', 'approved', 'declined', 'in_production', 'received',
                 'designer_sent', 'sent_to_client', 'client_response', 'cancelled')),
  response     text CHECK (response IN ('approved', 'approved_with_comments', 'revise_resubmit', 'rejected')),
  -- Who did it: a system user, or a typed name for someone without a login
  -- (Ammar in production, the designer). Sales records the step either way.
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name   text CHECK (actor_name IS NULL OR length(btrim(actor_name)) BETWEEN 1 AND 120),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  notes        text CHECK (notes IS NULL OR length(notes) <= 2000),
  -- The file sent with this step, from the registry, so a drawing PDF keeps its version chain.
  document_id  uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  recorded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deal_submittal_steps_response_on_reply
    CHECK ((step = 'client_response') = (response IS NOT NULL)),
  -- Back-dating is normal (the sample arrived yesterday); a date in the future is a typo.
  CONSTRAINT deal_submittal_steps_not_future
    CHECK (occurred_at <= recorded_at + interval '1 day')
);

CREATE INDEX IF NOT EXISTS idx_deal_submittal_steps_submittal
  ON public.deal_submittal_steps (submittal_id, recorded_at);

COMMENT ON TABLE public.deal_submittal_steps IS
  'Append-only history of a sample or drawing: who did each step, when, with notes. No UPDATE or DELETE grant: the log is history.';

REVOKE ALL ON public.deal_submittals, public.deal_submittal_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deal_submittals, public.deal_submittal_steps TO authenticated;
GRANT INSERT (id, opportunity_id, kind, title, notes) ON public.deal_submittals TO authenticated;
GRANT UPDATE (title, notes) ON public.deal_submittals TO authenticated;
GRANT INSERT (id, submittal_id, step, response, actor_id, actor_name, occurred_at, notes, document_id)
  ON public.deal_submittal_steps TO authenticated;
GRANT ALL ON public.deal_submittals, public.deal_submittal_steps TO service_role;

ALTER TABLE public.deal_submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_submittal_steps ENABLE ROW LEVEL SECURITY;

-- Readable exactly where the deal is readable: the subquery runs under the
-- caller's opportunities RLS (sales data isolation, 20260727170000).
DROP POLICY IF EXISTS "Submittals readable with the deal" ON public.deal_submittals;
CREATE POLICY "Submittals readable with the deal" ON public.deal_submittals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_id));

DROP POLICY IF EXISTS "Submittals added by the sales team" ON public.deal_submittals;
CREATE POLICY "Submittals added by the sales team" ON public.deal_submittals
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.is_sales_contributor((SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_id)
  );

DROP POLICY IF EXISTS "Submittals renamed by creator or operator" ON public.deal_submittals;
CREATE POLICY "Submittals renamed by creator or operator" ON public.deal_submittals
  FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()) OR public.is_pipeline_operator((SELECT auth.uid())))
  WITH CHECK (created_by = (SELECT auth.uid()) OR public.is_pipeline_operator((SELECT auth.uid())));

DROP POLICY IF EXISTS "Submittal steps readable with the item" ON public.deal_submittal_steps;
CREATE POLICY "Submittal steps readable with the item" ON public.deal_submittal_steps
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.deal_submittals s WHERE s.id = submittal_id));

-- The approval is the commercial manager's decision; every other step is the
-- sales team's, recorded as themselves.
DROP POLICY IF EXISTS "Submittal steps recorded by the sales team" ON public.deal_submittal_steps;
CREATE POLICY "Submittal steps recorded by the sales team" ON public.deal_submittal_steps
  FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = (SELECT auth.uid())
    AND public.is_sales_contributor((SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.deal_submittals s WHERE s.id = submittal_id)
    AND (step NOT IN ('approved', 'declined') OR public.is_commercial_manager((SELECT auth.uid())))
    AND (document_id IS NULL OR public.can_read_document(document_id, (SELECT auth.uid())))
  );

-- The allowed order. Mirrored by NEXT_STEPS in src/lib/submittals.ts; a test
-- reads the WHEN lines below and fails if the two drift.
CREATE OR REPLACE FUNCTION public.submittal_next_steps(_kind text, _current text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _kind || ':' || coalesce(_current, '')
    WHEN 'sample:' THEN ARRAY['requested']
    WHEN 'sample:requested' THEN ARRAY['approved', 'declined', 'cancelled']
    WHEN 'sample:approved' THEN ARRAY['in_production', 'cancelled']
    WHEN 'sample:in_production' THEN ARRAY['received', 'cancelled']
    WHEN 'sample:received' THEN ARRAY['sent_to_client', 'cancelled']
    WHEN 'sample:sent_to_client' THEN ARRAY['client_response', 'cancelled']
    WHEN 'sample:client_response' THEN ARRAY['requested']
    WHEN 'sample:declined' THEN ARRAY['requested']
    WHEN 'drawing:' THEN ARRAY['designer_sent']
    WHEN 'drawing:designer_sent' THEN ARRAY['sent_to_client', 'cancelled']
    WHEN 'drawing:sent_to_client' THEN ARRAY['client_response', 'cancelled']
    WHEN 'drawing:client_response' THEN ARRAY['designer_sent']
    ELSE ARRAY[]::text[]
  END;
$$;

GRANT EXECUTE ON FUNCTION public.submittal_next_steps(text, text) TO authenticated, service_role;

-- Runs as the caller, so an item the caller cannot see is "not found" rather
-- than a detail of its state. The advisory lock makes two people recording the
-- next step at once take turns instead of both passing the check.
CREATE OR REPLACE FUNCTION public.check_submittal_step()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _kind     text;
  _current  text;
  _revision smallint;
  _first    text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('deal_submittal:' || NEW.submittal_id::text, 0));

  SELECT kind, current_step, revision INTO _kind, _current, _revision
    FROM public.deal_submittals WHERE id = NEW.submittal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This sample or drawing does not exist, or you cannot see it. | العينة أو المخطط غير موجود، أو لا تملك صلاحية رؤيته.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (NEW.step = ANY (public.submittal_next_steps(_kind, _current))) THEN
    RAISE EXCEPTION '"%" cannot follow "%" on a %. | هذه الخطوة لا تأتي بعد الخطوة الحالية.',
      NEW.step, coalesce(_current, 'nothing'), _kind
      USING ERRCODE = '23514';
  END IF;

  _first := CASE _kind WHEN 'sample' THEN 'requested' ELSE 'designer_sent' END;
  NEW.revision := CASE WHEN NEW.step = _first AND _current IS NOT NULL THEN _revision + 1 ELSE _revision END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_check_submittal_step ON public.deal_submittal_steps;
CREATE TRIGGER trg_check_submittal_step
  BEFORE INSERT ON public.deal_submittal_steps
  FOR EACH ROW EXECUTE FUNCTION public.check_submittal_step();

-- The recorder may not hold UPDATE on the item, so the copy runs as definer. It
-- only writes the state columns the step speaks for, then tells the people who
-- act next.
CREATE OR REPLACE FUNCTION public.apply_submittal_step()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s        public.deal_submittals%ROWTYPE;
  _deal     text;
  _owner    uuid;
  _asker    uuid;
  _meta     jsonb;
BEGIN
  UPDATE public.deal_submittals
     SET revision        = NEW.revision,
         current_step    = NEW.step,
         client_response = CASE
                             WHEN NEW.step = 'client_response' THEN NEW.response
                             WHEN NEW.step IN ('requested', 'designer_sent') THEN NULL
                             ELSE client_response
                           END,
         last_step_at    = NEW.occurred_at,
         updated_at      = now()
   WHERE id = NEW.submittal_id
  RETURNING * INTO _s;

  SELECT project_name, owner_id INTO _deal, _owner
    FROM public.opportunities WHERE id = _s.opportunity_id;
  _meta := jsonb_build_object('opportunity_id', _s.opportunity_id, 'submittal_id', _s.id);

  IF _s.kind = 'sample' AND NEW.step = 'requested' THEN
    PERFORM public.emit_notification_to_roles(
      ARRAY['sales_manager', 'general_manager']::public.app_role[],
      'sample_approval_needed', 'opportunity', _s.opportunity_id,
      'Sample approval needed: ' || _s.title,
      coalesce(_deal, 'A deal') || ' — a sample is waiting for your approval.',
      'attention', 'sample_requested', 'sample_requested:' || NEW.id::text, _meta);

  ELSIF NEW.step IN ('approved', 'declined') THEN
    SELECT recorded_by INTO _asker
      FROM public.deal_submittal_steps
     WHERE submittal_id = _s.id AND revision = NEW.revision AND step = 'requested'
     ORDER BY recorded_at DESC LIMIT 1;
    PERFORM public.emit_notification(
      coalesce(_asker, _owner), 'sample_decided', 'opportunity', _s.opportunity_id,
      CASE NEW.step WHEN 'approved' THEN 'Sample approved: ' ELSE 'Sample declined: ' END || _s.title,
      coalesce(nullif(btrim(NEW.notes), ''), coalesce(_deal, '')),
      CASE NEW.step WHEN 'approved' THEN 'info' ELSE 'attention' END,
      'sample_decided', 'sample_decided:' || NEW.id::text, _meta);

  ELSIF NEW.step = 'client_response' THEN
    PERFORM public.emit_notification(
      _owner, 'submittal_client_response', 'opportunity', _s.opportunity_id,
      'Client answered: ' || _s.title,
      coalesce(_deal, '') || ' — ' || replace(NEW.response, '_', ' '),
      CASE WHEN NEW.response IN ('approved', 'approved_with_comments') THEN 'info' ELSE 'attention' END,
      'submittal_client_response', 'submittal_response:' || NEW.id::text, _meta);
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.apply_submittal_step() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apply_submittal_step ON public.deal_submittal_steps;
CREATE TRIGGER trg_apply_submittal_step
  AFTER INSERT ON public.deal_submittal_steps
  FOR EACH ROW EXECUTE FUNCTION public.apply_submittal_step();

DROP TRIGGER IF EXISTS trg_deal_submittals_updated_at ON public.deal_submittals;
CREATE TRIGGER trg_deal_submittals_updated_at BEFORE UPDATE ON public.deal_submittals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- 2. Reminders that repeat, on a deal or on a client -------------------------
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'monthly', 'yearly')),
  -- The first due date of the series. Later dates are counted from it in whole
  -- months, so a reminder on the 31st returns to the 31st wherever it exists.
  ADD COLUMN IF NOT EXISTS recurrence_anchor date,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  -- The reminder this one was scheduled from when its predecessor was completed.
  ADD COLUMN IF NOT EXISTS recurs_from uuid REFERENCES public.follow_ups(id) ON DELETE SET NULL;

ALTER TABLE public.follow_ups ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE public.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_has_subject;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_has_subject
  CHECK (opportunity_id IS NOT NULL OR company_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_follow_ups_company
  ON public.follow_ups (company_id, due_date) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_one_successor
  ON public.follow_ups (recurs_from) WHERE recurs_from IS NOT NULL;

COMMENT ON COLUMN public.follow_ups.recurrence IS
  'none | monthly | yearly. Completing a repeating follow-up schedules the next one (schedule_next_follow_up); cancelling ends the series.';
COMMENT ON COLUMN public.follow_ups.company_id IS
  'A reminder about a client rather than a deal (monthly or yearly check-ins). At least one of opportunity_id / company_id is set.';

-- The next date of a series. Mirrored by nextFollowUpDate() in
-- src/lib/follow-up-recurrence.ts. Counted from the anchor in whole months: the
-- first date after the one just completed and not before today, so a late
-- completion does not create a reminder that is already overdue.
CREATE OR REPLACE FUNCTION public.next_follow_up_date(_anchor date, _recurrence text, _after date, _today date)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  _step integer := CASE _recurrence WHEN 'monthly' THEN 1 WHEN 'yearly' THEN 12 END;
  _k    integer := 1;
  _d    date;
BEGIN
  IF _step IS NULL OR _anchor IS NULL THEN RETURN NULL; END IF;
  LOOP
    _d := (_anchor + make_interval(months => _step * _k))::date;
    EXIT WHEN _d > _after AND _d >= _today;
    _k := _k + 1;
    IF _k > 2400 THEN RETURN NULL; END IF;
  END LOOP;
  RETURN _d;
END $$;

GRANT EXECUTE ON FUNCTION public.next_follow_up_date(date, text, date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anchor_follow_up_recurrence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.recurrence <> 'none' AND NEW.recurrence_anchor IS NULL THEN
    NEW.recurrence_anchor := NEW.due_date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_anchor_follow_up_recurrence ON public.follow_ups;
CREATE TRIGGER trg_anchor_follow_up_recurrence
  BEFORE INSERT OR UPDATE OF recurrence ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.anchor_follow_up_recurrence();

-- Runs as definer: whoever completes the reminder (the owner, or a manager on
-- their behalf) should not need the insert right for the next one to exist.
-- The next one carries the purpose the reminder had BEFORE completion: the
-- complete action overwrites notes with the outcome.
CREATE OR REPLACE FUNCTION public.schedule_next_follow_up()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _next date;
  _id   uuid;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.recurrence <> 'none'
     AND NOT EXISTS (SELECT 1 FROM public.follow_ups WHERE recurs_from = NEW.id) THEN
    _next := public.next_follow_up_date(coalesce(NEW.recurrence_anchor, NEW.due_date), NEW.recurrence,
                                        NEW.due_date, public.riyadh_date(now()));
    IF _next IS NULL THEN RETURN NEW; END IF;

    INSERT INTO public.follow_ups
      (opportunity_id, company_id, owner_id, due_date, cadence_tier, channel, status, notes,
       recurrence, recurrence_anchor, recurs_from)
    VALUES
      (NEW.opportunity_id, NEW.company_id, NEW.owner_id, _next, NEW.cadence_tier, NEW.channel, 'scheduled',
       OLD.notes, NEW.recurrence, coalesce(NEW.recurrence_anchor, NEW.due_date), NEW.id)
    RETURNING id INTO _id;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
            'follow_up.recurred',
            CASE WHEN NEW.opportunity_id IS NOT NULL THEN 'opportunity' ELSE 'company' END,
            coalesce(NEW.opportunity_id, NEW.company_id),
            jsonb_build_object('follow_up_id', NEW.id, 'due_date', NEW.due_date),
            jsonb_build_object('follow_up_id', _id, 'due_date', _next, 'recurrence', NEW.recurrence));
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.schedule_next_follow_up() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_schedule_next_follow_up ON public.follow_ups;
CREATE TRIGGER trg_schedule_next_follow_up
  AFTER UPDATE OF status ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.schedule_next_follow_up();

-- ---- 3. A reminder due today tells its owner --------------------------------------
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('opportunity','rfq','tender','approval','quotation','inbox_item','system','task','company'));

CREATE OR REPLACE FUNCTION public.notify_due_follow_ups(_today date DEFAULT CURRENT_DATE)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _r     record;
  _count integer := 0;
BEGIN
  FOR _r IN
    SELECT f.id, f.owner_id, f.opportunity_id, f.company_id, f.notes,
           o.project_name, c.name AS company_name
      FROM public.follow_ups f
      LEFT JOIN public.opportunities o ON o.id = f.opportunity_id
      LEFT JOIN public.companies c ON c.id = f.company_id
     WHERE f.due_date = _today
       AND f.status IN ('scheduled', 'due')
       AND f.owner_id IS NOT NULL
  LOOP
    IF public.emit_notification(
         _r.owner_id, 'follow_up_due',
         CASE WHEN _r.opportunity_id IS NOT NULL THEN 'opportunity' ELSE 'company' END,
         coalesce(_r.opportunity_id, _r.company_id),
         'Follow-up due today: ' || coalesce(_r.project_name, _r.company_name, ''),
         coalesce(nullif(btrim(_r.notes), ''), 'Scheduled follow-up'),
         'attention', 'follow_up_due',
         'followup_due:' || _r.id::text || ':' || _today::text,
         CASE WHEN _r.opportunity_id IS NOT NULL
              THEN jsonb_build_object('opportunity_id', _r.opportunity_id) END
       ) IS NOT NULL
    THEN
      _count := _count + 1;
    END IF;
  END LOOP;
  RETURN _count;
END $fn$;

REVOKE ALL ON FUNCTION public.notify_due_follow_ups(date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.notify_due_follow_ups IS
  'Emits follow_up_due to the owner of every open follow-up (deal or client) due today. Called from run_sales_automations. Idempotent: the dedupe key is (follow-up id, date).';

-- ---- 4. The nightly rules -----------------------------------------------------------
-- Reproduced from 20260914100000 and changed in three lines only: rules 6 and 7
-- (follow-up due / overdue flags) keep to deal reminders, because a flag is
-- raised against an opportunity; and the closing notification pass also sends
-- today's reminders.
CREATE OR REPLACE FUNCTION public.run_sales_automations(_trigger TEXT DEFAULT 'cron')
RETURNS TABLE (run_id UUID, raised INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _run_id    UUID;
  _raised    INT := 0;
  _notified  INT := 0;
  _n       INT;
  _today   DATE := CURRENT_DATE;
BEGIN
  INSERT INTO public.automation_runs (trigger) VALUES (_trigger) RETURNING id INTO _run_id;

  -- 1. RFQ unassigned for 24h.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_type, queue_action_type,
     condition_key, reason, recommended_action, priority, status, ai_generated)
  SELECT 'rfq', r.id, 'action_required', 'follow_up_required', 'rfq_review_needed',
         'unassigned', 'RFQ unassigned for 24h',
         'Assign a sales owner to this RFQ.', 'A', 'open', true
    FROM public.rfqs r
   WHERE r.sales_owner_id IS NULL AND r.status = 'open'
     AND r.created_at < now() - INTERVAL '1 day'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 2. Verbally awarded >14d with no contract.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, risk_flag, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'opportunity', o.id, 'risk', 'contract_pending', 'contract_evidence_missing',
         'verbal_no_contract:' || COALESCE(o.verbal_award_date::text, '-'),
         'Verbally awarded >14d without contract',
         'Follow up on the contract and record it once received.',
         o.owner_id, 'A', 'open', true
    FROM public.opportunities o
   WHERE o.sales_stage = 'verbally_awarded' AND o.verbal_award_date < _today - 14
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 3. Verbal award with no evidence after 3d.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, risk_flag, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'opportunity', o.id, 'risk', 'contract_pending', 'contract_evidence_missing',
         'verbal_no_evidence:' || COALESCE(o.verbal_award_date::text, '-'),
         'Verbal award recorded without evidence',
         'Upload verbal award evidence (email, letter, or call note).',
         o.owner_id, 'A', 'open', true
    FROM public.opportunities o
   WHERE o.sales_stage = 'verbally_awarded' AND o.verbal_award_evidence IS NULL
     AND o.verbal_award_date < _today - 3
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 4. Contract stage with no reference number.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'opportunity', o.id, 'action_required', 'contract_evidence_missing',
         'contract_no_reference',
         'Contract stage reached without a contract reference number',
         'Record the signed contract reference number.', o.owner_id, 'A', 'open', true
    FROM public.opportunities o
   WHERE o.sales_stage IN ('contract_received', 'won') AND o.contract_reference_number IS NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 5. Tender award expected within 7d.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_type, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, due_date, priority, status, ai_generated)
  SELECT 'tender', t.id, 'action_required', 'tender_decision_required', 'tender_review_needed',
         'expected_award:' || COALESCE(t.expected_award_date::text, '-'),
         'Tender award expected within 7 days',
         'Review the tender and confirm the go/no-go decision.',
         t.tender_owner_id, t.expected_award_date, 'A', 'open', true
    FROM public.tenders t
   WHERE t.expected_award_date IS NOT NULL
     AND t.expected_award_date <= _today + 7
     AND t.tender_stage NOT IN ('converted_to_jih', 'tender_lost_or_archived')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 6. Follow-ups due today.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_type, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, due_date, priority, status, ai_generated)
  SELECT 'opportunity', f.opportunity_id, 'action_required', 'follow_up_required', 'follow_up_due',
         'followup:' || f.id::text || ':' || f.due_date::text,
         'Follow-up due today', 'Complete today''s scheduled follow-up.',
         f.owner_id, f.due_date, f.cadence_tier, 'open', true
    FROM public.follow_ups f
   WHERE f.status = 'scheduled' AND f.due_date = _today AND f.opportunity_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 7. Follow-ups overdue.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, risk_flag, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, due_date, priority, status, ai_generated)
  SELECT 'opportunity', f.opportunity_id, 'risk', 'follow_up_overdue', 'follow_up_overdue',
         'followup:' || f.id::text || ':' || f.due_date::text,
         'Follow-up overdue since ' || f.due_date::text,
         'Contact the customer immediately and reschedule.',
         f.owner_id, f.due_date, 'A', 'open', true
    FROM public.follow_ups f
   WHERE f.status NOT IN ('completed', 'cancelled') AND f.due_date < _today AND f.opportunity_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 8. Tier A/B with no next action.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'opportunity', o.id, 'action_required', 'no_next_action',
         'missing_next_action', 'Important opportunity has no next action set',
         'Set the next action and its due date.', o.owner_id, o.tier, 'open', true
    FROM public.opportunities o
   WHERE o.tier IN ('A', 'B') AND o.next_action IS NULL
     AND o.stage NOT IN ('won', 'lost', 'archived')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 9. Tier A silent beyond an APPROVED threshold, measured from real contact.
  --
  -- Was: `last_activity_at IS NULL OR last_activity_at < now() - 14 days`.
  -- Two defects in one line, both corrected here.
  --
  --   NULL meant stale. It does not. `last_activity_at` is stamped by
  --   logActivity() for ANY activity — internal notes and unsent drafts
  --   included — and the importer never writes it at all, so every
  --   historically promoted opportunity carried NULL and this rule called each
  --   one a risk. Those deals hold years of relationship that predates this
  --   software; the CRM not knowing about it is a fact about the CRM.
  --
  --   14 was invented. current_sla_days() returns NULL when the business has
  --   set no policy, and its own comment tells callers to supply a fallback
  --   "so an unset policy never means everything is breaching". The fallback
  --   here is to raise NOTHING — with no approved threshold there is nothing
  --   for a deal to be late against.
  --
  -- sla_policies is empty today, so this rule is dormant BY DESIGN. Set a
  -- stalled_deal policy and it starts working, on the business's own number.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'opportunity', o.id, 'risk', 'inactive_tier_a_opportunity',
         'inactive_since:' || c.at::date::text,
         'Tier A opportunity with no client contact in '
           || public.current_sla_days('stalled_deal')::text || '+ days',
         'Log an activity or reassess the opportunity.', o.owner_id, 'A', 'open', true
    FROM public.opportunities o
    CROSS JOIN LATERAL (SELECT public.last_verified_client_contact(o.id) AS at) c
   WHERE o.tier = 'A' AND o.stage NOT IN ('won', 'lost', 'archived')
     AND public.current_sla_days('stalled_deal') IS NOT NULL
     AND c.at IS NOT NULL
     AND c.at < now() - make_interval(days => public.current_sla_days('stalled_deal'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 9b. No verified client contact ever recorded — DATA QUALITY, not risk.
  --
  -- The honest half of what rule 9 used to conflate. `action_required` and
  -- `missing_data` already exist in the vocabulary, so no new enum value is
  -- needed. Scoped to tier A exactly as rule 9 is: a gap worth chasing on the
  -- deals the business marked most important, rather than a nightly flag on
  -- every record with a thin history.
  --
  -- The condition_key is constant per opportunity, so ON CONFLICT DO NOTHING
  -- makes repeat runs a no-op; logging one real contact removes the row from
  -- the SELECT and the flag stops being re-raised.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'opportunity', o.id, 'action_required', 'missing_data',
         'no_engagement_history',
         'No client call, visit, meeting or sent message has ever been recorded',
         'Log the last real contact, or record one now.', o.owner_id, 'A', 'open', true
    FROM public.opportunities o
   WHERE o.tier = 'A' AND o.stage NOT IN ('won', 'lost', 'archived')
     AND public.last_verified_client_contact(o.id) IS NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 10. Pending approvals.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'approval', a.id, 'action_required', 'approval_needed',
         'approval:' || a.id::text,
         'Pending ' || COALESCE(a.approval_type, 'approval') || ' approval',
         'Review and decide this approval.',
         COALESCE(a.assigned_approver, a.requested_by), 'A', 'open', true
    FROM public.approvals a
   WHERE a.status = 'pending'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 11. Quotations with no follow-up in 5+ days.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'quotation', q.id, 'action_required', 'quotation_follow_up',
         'quotation:' || q.id::text || ':' || COALESCE(q.last_follow_up_at::date::text, '-'),
         'No follow-up on this quotation in 5+ days',
         'Follow up with the client on this quotation.', q.owner_id, 'B', 'open', true
    FROM public.quotations q
   WHERE q.status IN ('submitted', 'follow_up', 'negotiation')
     AND COALESCE(q.last_follow_up_at::date, q.issued_date) < _today - 5
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 12. NEW — the submission is waiting on someone, and the deadline is near.
  --     Flagged to `assigned_to`, so the notification reaches the person
  --     actually holding the work rather than only the deal's owner.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_type, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, due_date, priority, status, ai_generated)
  SELECT 'rfq', r.id, 'action_required', 'follow_up_required', 'submission_pending_on',
         'pending_on:' || r.assigned_to::text || ':' || r.response_due_date::text,
         'Submission due ' || r.response_due_date::text || ' is waiting on you',
         'Prepare and submit the quotation, or hand it back with a reason.',
         r.assigned_to, r.response_due_date,
         -- Explicit cast: a CASE expression yields text, and priority is
         -- priority_tier. Without this the rule fails even once the enum
         -- value exists — the second half of the same never-executed rule.
         (CASE WHEN r.response_due_date <= _today + 2 THEN 'A' ELSE 'B' END)::public.priority_tier,
         'open', true
    FROM public.rfqs r
   WHERE r.assigned_to IS NOT NULL
     AND r.status = 'open'
     AND r.response_due_date IS NOT NULL
     AND r.response_due_date <= _today + 7
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- ============ 13. Notify owners of newly-overdue work ============
  -- Runs last, on purpose: the rules above may have just raised a flag that is
  -- already past its due date, and that flag should notify in the same pass
  -- rather than waiting a day.
  --
  -- Not a separate schedule. The PRD asks for "important item became overdue",
  -- and this function is already the periodic engine — pg_cron nightly plus the
  -- Action Center button through sales-os-api. Adding a second scheduler would
  -- give the two paths different behaviour, which is exactly what
  -- 20260806120000 set out to avoid when it made this the single source of
  -- truth for the rules.
  _notified := public.notify_overdue_items() + public.notify_due_follow_ups(_today);

  UPDATE public.automation_runs
     SET finished_at = now(), raised = _raised, notified = _notified
   WHERE id = _run_id;

  RETURN QUERY SELECT _run_id, _raised;
END $$;

COMMENT ON FUNCTION public.run_sales_automations(TEXT) IS
  'The nightly rules. Rule 9 raises an inactivity risk only from a VERIFIED client contact and only against an APPROVED sla_policies threshold; with either absent it raises nothing, because unknown is not late. Rule 9b reports the missing history itself as data quality instead. Every other rule rests on a real date and is unchanged.';

REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_sales_automations(TEXT) TO service_role;
