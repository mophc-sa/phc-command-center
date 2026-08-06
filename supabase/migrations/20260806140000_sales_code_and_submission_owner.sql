-- =========================================================
-- PHC Sales OS — salesperson code on RFQ numbers, and "who is this waiting on".
--
-- From Faisal's field feedback, 2026-08-06:
--
--   "if it's added by me, or Omar, or Mary, or Abdulrahman, so we have
--    particular code for this thing. For me, it's FA. Abdulrahman is AB.
--    Omar is OM. So once we added, this code has to come from here."
--
--   "if it's pending from Zaid, can we just add something to notify him, or
--    automatically notify, or notify my side, or something has to be there?"
--
-- Two additions:
--
--   profiles.sales_code   the rep's initials, stamped into the RFQ number so a
--                         number tells you whose deal it is at a glance.
--   rfqs.assigned_to      who the submission is currently waiting on. Distinct
--                         from sales_owner_id, which is who owns the deal — the
--                         estimator preparing a quotation is not the owner, but
--                         they are the person the work is sitting with.
-- =========================================================

-- ============ 1. profiles.sales_code ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sales_code TEXT;

-- Short, uppercase, letters only. Two or three characters: FA, AB, OM.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_sales_code_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_sales_code_format
  CHECK (sales_code IS NULL OR sales_code ~ '^[A-Z]{2,3}$');

COMMENT ON COLUMN public.profiles.sales_code IS
  'The rep''s initials (FA, AB, OM), stamped into rfq_number by generate_rfq_number(). Set by an admin; defaults to the first two letters of the full name when a code is needed and none is set.';

-- Case-insensitive uniqueness: two reps sharing a code would make the number
-- ambiguous, which is the whole point of having one.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_sales_code_unique
  ON public.profiles (upper(sales_code)) WHERE sales_code IS NOT NULL;

-- Seed from existing names so real users have a code immediately. Skips any
-- collision rather than guessing — an admin resolves those by hand.
WITH candidates AS (
  SELECT id,
         upper(substring(regexp_replace(coalesce(full_name, ''), '[^A-Za-z ]', '', 'g') from 1 for 2)) AS code,
         ROW_NUMBER() OVER (
           PARTITION BY upper(substring(regexp_replace(coalesce(full_name, ''), '[^A-Za-z ]', '', 'g') from 1 for 2))
           ORDER BY created_at
         ) AS rn
    FROM public.profiles
   WHERE sales_code IS NULL
     AND coalesce(full_name, '') <> ''
     AND full_name NOT LIKE 'PW %'          -- Playwright fixtures; see docs/playwright-test-setup.md
)
UPDATE public.profiles p
   SET sales_code = c.code
  FROM candidates c
 WHERE p.id = c.id
   AND c.rn = 1
   AND c.code ~ '^[A-Z]{2}$'
   AND NOT EXISTS (SELECT 1 FROM public.profiles x WHERE upper(x.sales_code) = c.code);

-- ============ 2. rfq_number carries the code ============
-- Format becomes FA-RFQ-2026-0001. Existing numbers are untouched: this only
-- runs when rfq_number IS NULL, i.e. on new records.
CREATE OR REPLACE FUNCTION public.generate_rfq_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_number text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rfq_number ELSE NULL END;
  _code       text;
BEGIN
  -- Unauthorized manual value from an authenticated end user: discard it
  -- quietly and fall through to auto-generation (the write still succeeds).
  -- auth.uid() IS NULL means a trusted service-role caller — e.g. data import
  -- committing a source file's own RFQ number — which is not subject to this.
  IF NEW.rfq_number IS NOT NULL
     AND NEW.rfq_number IS DISTINCT FROM _old_number
     AND auth.uid() IS NOT NULL
     AND NOT public.can_edit_rfq_number(auth.uid()) THEN
    NEW.rfq_number := _old_number;
  END IF;

  IF NEW.rfq_number IS NULL THEN
    -- Prefer the owner's code, else the creator's, else the caller's. Falls
    -- back to the first two letters of their name, and finally to no prefix —
    -- a number without a code is better than no number.
    SELECT p.sales_code INTO _code
      FROM public.profiles p
     WHERE p.id = COALESCE(NEW.sales_owner_id, NEW.created_by, auth.uid())
     LIMIT 1;

    IF _code IS NULL THEN
      SELECT upper(substring(regexp_replace(coalesce(p.full_name, ''), '[^A-Za-z ]', '', 'g') from 1 for 2))
        INTO _code
        FROM public.profiles p
       WHERE p.id = COALESCE(NEW.sales_owner_id, NEW.created_by, auth.uid())
       LIMIT 1;
      IF _code !~ '^[A-Z]{2}$' THEN _code := NULL; END IF;
    END IF;

    NEW.rfq_number :=
      COALESCE(_code || '-', '') ||
      'RFQ-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.rfq_number_seq')::text, 4, '0');

  ELSIF NEW.rfq_number IS DISTINCT FROM _old_number AND auth.uid() IS NOT NULL THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (auth.uid(), 'user', 'rfq.number_overridden', 'rfq', NEW.id,
            to_jsonb(_old_number), to_jsonb(NEW.rfq_number));
  END IF;

  RETURN NEW;
END $$;

-- ============ 3. rfqs.assigned_to — who it is waiting on ============
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.rfqs.assigned_to IS
  'Who the submission is currently waiting on — an estimator preparing the quotation, for example. Distinct from sales_owner_id, which is who owns the deal. Drives the submission_pending_on automation rule so the person holding the work is the one who gets flagged.';

CREATE INDEX IF NOT EXISTS idx_rfqs_assigned_to ON public.rfqs (assigned_to) WHERE assigned_to IS NOT NULL;

-- ============ 4. Notify whoever the submission is waiting on ============
-- Added to the SQL rules engine (20260806120000) rather than a new mechanism:
-- opportunity_flags already feeds the notification bell, routed by
-- action_owner_id, so assigning the flag to `assigned_to` notifies that person.
CREATE OR REPLACE FUNCTION public.run_sales_automations(_trigger TEXT DEFAULT 'cron')
RETURNS TABLE (run_id UUID, raised INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _run_id  UUID;
  _raised  INT := 0;
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
   WHERE f.status = 'scheduled' AND f.due_date = _today
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
   WHERE f.status NOT IN ('completed', 'cancelled') AND f.due_date < _today
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

  -- 9. Tier A inactive 14+ days.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, priority, status, ai_generated)
  SELECT 'opportunity', o.id, 'risk', 'inactive_tier_a_opportunity',
         'inactive_since:' || COALESCE(o.last_activity_at::date::text, '-'),
         'Tier A opportunity with no activity in 14+ days',
         'Log an activity or reassess the opportunity.', o.owner_id, 'A', 'open', true
    FROM public.opportunities o
   WHERE o.tier = 'A' AND o.stage NOT IN ('won', 'lost', 'archived')
     AND (o.last_activity_at IS NULL OR o.last_activity_at < now() - INTERVAL '14 days')
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
         CASE WHEN r.response_due_date <= _today + 2 THEN 'A' ELSE 'B' END,
         'open', true
    FROM public.rfqs r
   WHERE r.assigned_to IS NOT NULL
     AND r.status = 'open'
     AND r.response_due_date IS NOT NULL
     AND r.response_due_date <= _today + 7
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  UPDATE public.automation_runs
     SET finished_at = now(), raised = _raised
   WHERE id = _run_id;

  RETURN QUERY SELECT _run_id, _raised;
END $$;

REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_sales_automations(TEXT) TO service_role;
