-- =========================================================
-- PHC Sales OS — move the automation rules into the database, and schedule them.
--
-- WHY THIS EXISTS, AND WHY IT IS BETTER THAN THE HTTP APPROACH IT REPLACES
--
-- 20260806100000 tried to schedule the engine by having pg_cron POST to the
-- sales-os-api Edge Function. It registered, it fired, and the function answered
-- 401 — as did a direct call with the service_role key, and with the new-format
-- sb_secret key. `sales-os-api` runs with verify_jwt = true, so Supabase's
-- gateway validates the caller's token as a USER token before the function is
-- reached. A machine caller cannot get through the gateway at all.
--
-- The two ways to force it were both bad. Turning verify_jwt off would remove
-- the gateway from a function that also gates stage advancement, approvals and
-- deletions. A bespoke shared-secret path would be a second front door into the
-- same function. Either is a security hole opened to solve a scheduling problem.
--
-- So the problem is removed instead of worked around. Every rule is a SELECT
-- over source records plus an INSERT into opportunity_flags — no updates, no
-- deletes, no external calls, nothing that needs TypeScript. In SQL, pg_cron
-- already has the authority to run it: no HTTP, no gateway, no token, and no
-- service key stored anywhere. The Vault secret created for the previous attempt
-- is dropped below, because a credential that no longer needs to exist should
-- not exist — the repo has a service_role exposure incident on record.
--
-- Idempotency comes free: the unique index from 20260806100000
-- (opportunity_flags_condition_dedup) turns every rule into
-- INSERT ... ON CONFLICT DO NOTHING. Same occurrence, same key, no duplicate —
-- whatever the flag's status.
--
-- SINGLE SOURCE OF TRUTH: the Edge Function handler now calls this function
-- rather than reimplementing the rules, so the manual button in Action Center
-- and the nightly run execute exactly the same logic.
-- =========================================================

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

  -- Each rule below mirrors one rule in handlers/automation.ts. ON CONFLICT DO
  -- NOTHING is what makes re-running safe: the unique index is on
  -- (linked_record_type, linked_record_id, queue_action_type, condition_key).

  -- 1. RFQ unassigned for 24h.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_type, queue_action_type,
     condition_key, reason, recommended_action, priority, status, ai_generated)
  SELECT 'rfq', r.id, 'action_required', 'follow_up_required', 'rfq_review_needed',
         'unassigned', 'RFQ unassigned for 24h',
         'Assign a sales owner to this RFQ.', 'A', 'open', true
    FROM public.rfqs r
   WHERE r.sales_owner_id IS NULL
     AND r.status = 'open'
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
   WHERE o.sales_stage = 'verbally_awarded'
     AND o.verbal_award_date < _today - 14
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
   WHERE o.sales_stage = 'verbally_awarded'
     AND o.verbal_award_evidence IS NULL
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
         'Record the signed contract reference number.',
         o.owner_id, 'A', 'open', true
    FROM public.opportunities o
   WHERE o.sales_stage IN ('contract_received', 'won')
     AND o.contract_reference_number IS NULL
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
         'Follow-up due today',
         'Complete today''s scheduled follow-up.',
         f.owner_id, f.due_date, f.cadence_tier, 'open', true
    FROM public.follow_ups f
   WHERE f.status = 'scheduled'
     AND f.due_date = _today
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  -- 7. Follow-ups overdue. The rule this whole redesign was built around:
  --    dismissing the flag while the follow-up stayed overdue used to re-raise
  --    it on every run. Keyed on due_date, so rescheduling is a new occurrence.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, risk_flag, queue_action_type,
     condition_key, reason, recommended_action, action_owner_id, due_date, priority, status, ai_generated)
  SELECT 'opportunity', f.opportunity_id, 'risk', 'follow_up_overdue', 'follow_up_overdue',
         'followup:' || f.id::text || ':' || f.due_date::text,
         'Follow-up overdue since ' || f.due_date::text,
         'Contact the customer immediately and reschedule.',
         f.owner_id, f.due_date, 'A', 'open', true
    FROM public.follow_ups f
   WHERE f.status NOT IN ('completed', 'cancelled')
     AND f.due_date < _today
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
   WHERE o.tier IN ('A', 'B')
     AND o.next_action IS NULL
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
   WHERE o.tier = 'A'
     AND o.stage NOT IN ('won', 'lost', 'archived')
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
         'Follow up with the client on this quotation.',
         q.owner_id, 'B', 'open', true
    FROM public.quotations q
   WHERE q.status IN ('submitted', 'follow_up', 'negotiation')
     AND COALESCE(q.last_follow_up_at::date, q.issued_date) < _today - 5
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT; _raised := _raised + _n;

  UPDATE public.automation_runs
     SET finished_at = now(), raised = _raised
   WHERE id = _run_id;

  RETURN QUERY SELECT _run_id, _raised;
END $$;

COMMENT ON FUNCTION public.run_sales_automations(TEXT) IS
  'Evaluates the Sales Action Queue rules and raises opportunity_flags. Idempotent via opportunity_flags_condition_dedup. Called by pg_cron nightly and by the Action Center button through sales-os-api. Reads source records and inserts flags only — never updates or deletes them.';

-- Only the database and the backend may run it. `authenticated` deliberately
-- cannot: the Action Center button reaches it through sales-os-api, which
-- checks the caller's role first.
REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_sales_automations(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_sales_automations(TEXT) TO service_role;

-- ============ Schedule ============
-- No HTTP, no gateway, no token. pg_cron runs it in-database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping schedule.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('run-automations-daily')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-automations-daily');

  PERFORM cron.schedule(
    'run-automations-daily',
    '0 4 * * *',                                   -- 04:00 UTC = 07:00 AST
    $job$ SELECT public.run_sales_automations('cron'); $job$
  );
  RAISE NOTICE 'Scheduled run-automations-daily at 04:00 UTC.';
END $$;

-- ============ Drop the credential the HTTP attempt needed ============
-- Nothing reads it now. A privileged key that no longer needs to exist should
-- not exist, especially in a project with a service_role exposure on record.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault')
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'sales_os_service_key') THEN
    DELETE FROM vault.secrets WHERE name = 'sales_os_service_key';
    RAISE NOTICE 'Removed the now-unused sales_os_service_key Vault secret.';
  END IF;
END $$;

-- Check it ran:      SELECT * FROM public.automation_runs ORDER BY started_at DESC LIMIT 10;
-- Run it by hand:    SELECT * FROM public.run_sales_automations('manual');
-- Remove the job:    SELECT cron.unschedule('run-automations-daily');
