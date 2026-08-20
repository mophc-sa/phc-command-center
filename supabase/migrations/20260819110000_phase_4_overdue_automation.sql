-- =========================================================
-- Phase 4 — wire overdue notifications into the existing automation engine,
-- and repair that engine, which has been failing every night since 2026-08-07.
--
-- ============ THE BUG THIS ALSO FIXES ============
-- While wiring the notification in, the run log showed the thing it was built
-- to show: `automation_runs` has no entry since 2026-08-06, while
-- cron.job_run_details records 13 consecutive FAILED executions of
-- `run-automations-daily`, the most recent this morning. Every one aborts with:
--
--     invalid input value for enum queue_action_type: "submission_pending_on"
--
-- Migration 20260806140000 added rule 12 ("notify whoever the submission is
-- waiting on") using a new queue_action_type value — but never added that value
-- to the enum. The column and index from that migration applied cleanly, so the
-- gap was invisible; only the rule's runtime INSERT touches the enum.
--
-- Because the whole function is one transaction, the failure at rule 12 rolls
-- back rules 1–11 as well. The Sales Action Queue has therefore raised NOTHING
-- for fourteen days, and the queue's apparent quiet was a crash, not calm.
--
-- Fixing it is a precondition for this phase, not scope creep: attaching
-- overdue notifications to a function that aborts nightly would deliver an
-- event that never fires. The repair is the one line that was forgotten.
--
-- ============ WHAT THIS MIGRATION DOES ============
--   1. Adds the missing enum value, reviving rules 1–12.
--   2. Adds automation_runs.notified so a silent notifier is visible in the
--      same log that exposed this bug.
--   3. Bounds notify_overdue_items() to a lookback window (see below).
--   4. Calls it from run_sales_automations, so the nightly cron and the Action
--      Center button behave identically — the single-source-of-truth rule
--      established by 20260806120000.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Repair the enum ============
-- Postgres allows ADD VALUE inside a transaction (PG12+) as long as the new
-- value is not *used* in the same transaction. Nothing here executes it — the
-- function below only stores a body — so this is safe in a migration.
ALTER TYPE public.queue_action_type ADD VALUE IF NOT EXISTS 'submission_pending_on';

-- ============ 2. Observability for the notifier ============
-- Nullable and unbackfilled: rows written before this migration genuinely have
-- no count, and NULL says that honestly where 0 would claim "ran, sent none".
ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS notified INT;

COMMENT ON COLUMN public.automation_runs.notified IS
  'How many overdue notifications this run emitted. NULL for runs from before the notifier existed. 0 means it ran and everything overdue had already been notified — that is the normal steady state, not a fault.';

-- ============ 3. Bound the notifier to a lookback window ============
-- Replaces the unbounded version from 20260819100000.
--
-- WHY A WINDOW. "Became overdue" is a transition, but a flag row records only a
-- due date — there is no event for the moment it lapsed. An unbounded scan
-- therefore treats every historically-late item as if it lapsed today. That is
-- wrong twice over: it is untrue, and the first run after this migration would
-- deliver the entire backlog at once. With the engine having been dead for
-- fourteen days, its first successful run will raise a batch of flags whose due
-- dates are already weeks past — precisely the blast this avoids.
--
-- A nightly run catches a real transition within a day, so the window only has
-- to absorb a few missed runs. Seven days is generous for that and still stays
-- silent about anything genuinely old.
--
-- Dedupe is unchanged: the key is (flag id, due date). An item that stays
-- overdue notifies once and then goes quiet, however many times this runs. A
-- follow-up that is rescheduled and lapses again arrives as a NEW flag row with
-- a new due date — a new key, and correctly a new notification.
CREATE OR REPLACE FUNCTION public.notify_overdue_items()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _r          RECORD;
  _count      INTEGER := 0;
  _lookback   INTEGER := 7;
BEGIN
  FOR _r IN
    SELECT f.id, f.action_owner_id AS owner_id, f.due_date, f.reason,
           f.linked_record_id, f.priority
      FROM public.opportunity_flags f
     WHERE f.due_date < CURRENT_DATE
       AND f.due_date >= CURRENT_DATE - _lookback
       AND f.status IN ('open','in_progress','escalated','blocked')
       AND f.action_owner_id IS NOT NULL
       -- Only tier A/B become notifications; C would be noise.
       AND f.priority IN ('A','B')
  LOOP
    -- emit_notification enforces the rest: no self-notification, no suspended
    -- recipients, and no duplicate for the same (recipient, type, entity, key).
    IF public.emit_notification(
         _r.owner_id, 'item_overdue', 'opportunity', _r.linked_record_id,
         COALESCE(_r.reason, 'Action overdue'),
         'This action passed its due date on ' || _r.due_date::TEXT || '.',
         'critical', 'item_became_overdue',
         'overdue:' || _r.id::TEXT || ':' || _r.due_date::TEXT,
         NULL
       ) IS NOT NULL
    THEN
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_overdue_items() FROM PUBLIC;

COMMENT ON FUNCTION public.notify_overdue_items IS
  'Emits item_overdue notifications for tier A/B flags that lapsed within the last 7 days. Called from run_sales_automations, so the nightly cron and the Action Center button behave identically. Idempotent: the dedupe key is (flag id, due date).';

-- ============ 4. Wire it into the engine ============
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
  _notified := public.notify_overdue_items();

  UPDATE public.automation_runs
     SET finished_at = now(), raised = _raised, notified = _notified
   WHERE id = _run_id;

  RETURN QUERY SELECT _run_id, _raised;
END $$;

REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_sales_automations(TEXT) TO service_role;

COMMENT ON FUNCTION public.run_sales_automations(TEXT) IS
  'Evaluates the Sales Action Queue rules, raises opportunity_flags, then emits overdue notifications. Idempotent via opportunity_flags_condition_dedup and the notifications dedupe index. Called by pg_cron nightly and by the Action Center button through sales-os-api.';

-- The schedule from 20260806120000 is unchanged and still active; this only
-- replaces what the job executes. Verify after applying:
--   SELECT status, count(*) FROM cron.job_run_details GROUP BY status;
--   SELECT * FROM public.automation_runs ORDER BY started_at DESC LIMIT 5;
