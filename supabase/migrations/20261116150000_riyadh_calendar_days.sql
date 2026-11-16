-- =============================================================================
-- Calendar days are Riyadh days in the remaining SQL that still said
-- CURRENT_DATE. The database runs in UTC, so between 21:00 and midnight Riyadh
-- time CURRENT_DATE is still "yesterday": a follow-up due today showed as not
-- yet due, an overdue count lagged by a day, and the nightly reminder keyed to
-- the wrong day. riyadh_date() (20261006100000) is the one definition.
--
-- Each object below is its CURRENT definition (read from production with
-- pg_get_viewdef / pg_get_functiondef on 2026-11-16, matching the latest
-- migrations 20260831100000, 20260914100000, 20261020100000, 20261027100000)
-- with only the day changed. Columns, grants and behaviour otherwise identical.
--
-- Deliberately unchanged:
--   * commercial_review_queue and team_performance: they subtract timestamps
--     (now() - updated_at, now() - 14 days). That is elapsed time, the same in
--     every time zone; no calendar day is involved.
--   * run_sales_automations condition_key strings (rule 9 'inactive_since:',
--     rule 11 'quotation:...'): changing their text would re-raise flags that
--     already exist. Only the comparisons move to Riyadh days.
--   * contract and pricing functions that stamp CURRENT_DATE
--     (_contract_advance_on_approval, contract_approval_record,
--     contract_claim_record, contract_cost_entry_record, contract_invoice_record,
--     contract_receipt_record, contract_variation_accept, logistics_rates_stamp,
--     pricing_extras_catalog_stamp, pricing_file_set_needs_info,
--     pricing_set_installation_rate) and the views contract_profit,
--     contract_receivables, sales_forecast: owned by the contract/pricing work,
--     left for that work to change with its own tests.
-- =============================================================================

CREATE OR REPLACE VIEW public.opportunity_next_action AS
 WITH due AS (
         SELECT f.opportunity_id,
            'follow_up'::text AS source,
            f.id AS source_id,
            f.due_date,
            f.owner_id,
            COALESCE(NULLIF(btrim(f.notes), ''::text), 'Follow up'::text) AS description
           FROM follow_ups f
          WHERE f.status = ANY (ARRAY['scheduled'::follow_up_status, 'due'::follow_up_status, 'overdue'::follow_up_status])
        UNION ALL
         SELECT t.related_opportunity_id,
            'task'::text,
            t.id,
            t.due_date,
            t.owner_id,
            t.title
           FROM tasks t
          WHERE t.related_opportunity_id IS NOT NULL AND t.status = 'open'::text AND t.due_date IS NOT NULL
        UNION ALL
         SELECT c.opportunity_id,
            'commitment'::text,
            c.id,
            c.due_date,
            c.owner_id,
            c.description
           FROM commitments c
          WHERE c.status = 'open'::commitment_status
        )
 SELECT DISTINCT ON (opportunity_id) opportunity_id,
    source,
    source_id,
    due_date,
    owner_id,
    description,
    due_date < public.riyadh_date(now()) AS is_overdue,
    due_date - public.riyadh_date(now()) AS days_until_due
   FROM due d
  WHERE can_read_boq(opportunity_id, ( SELECT auth.uid() AS uid))
  ORDER BY opportunity_id, due_date, source;

CREATE OR REPLACE VIEW public.overdue_commitments AS
 SELECT id,
    opportunity_id,
    company_id,
    direction,
    description,
    due_date,
    owner_id,
    public.riyadh_date(now()) - due_date AS days_overdue
   FROM commitments c
  WHERE status = 'open'::commitment_status AND due_date < public.riyadh_date(now()) AND can_read_boq(opportunity_id, ( SELECT auth.uid() AS uid));

CREATE OR REPLACE VIEW public.sla_breaches AS
 SELECT 'commitment'::sla_subject AS subject,
    c.id AS record_id,
    c.opportunity_id,
    c.owner_id,
    c.description AS detail,
    c.days_overdue,
    COALESCE(current_sla_days('commitment'::sla_subject), 0) AS threshold_days
   FROM overdue_commitments c
  WHERE c.days_overdue > COALESCE(current_sla_days('commitment'::sla_subject), 0)
UNION ALL
 SELECT 'price_review'::sla_subject AS subject,
    q.internal_price_id AS record_id,
    q.related_opportunity_id AS opportunity_id,
    NULL::uuid AS owner_id,
    'Awaiting '::text || COALESCE(q.awaiting, 'review'::text) AS detail,
    floor(q.days_waiting)::integer AS days_overdue,
    COALESCE(current_sla_days('price_review'::sla_subject), 3) AS threshold_days
   FROM commercial_review_queue q
  WHERE q.days_waiting > COALESCE(current_sla_days('price_review'::sla_subject), 3)::numeric
UNION ALL
 SELECT 'lead_review'::sla_subject AS subject,
    l.id AS record_id,
    NULL::uuid AS opportunity_id,
    l.owner_id,
    COALESCE(l.project_name, 'Unnamed lead'::text) AS detail,
    floor(l.days_waiting)::integer AS days_overdue,
    COALESCE(current_sla_days('lead_review'::sla_subject), 7) AS threshold_days
   FROM lead_review_queue l
  WHERE NOT l.reviewed AND l.days_waiting > COALESCE(current_sla_days('lead_review'::sla_subject), 7)::numeric
UNION ALL
 SELECT 'follow_up'::sla_subject AS subject,
    f.id AS record_id,
    f.opportunity_id,
    f.owner_id,
    COALESCE(NULLIF(btrim(f.notes), ''::text), 'Follow up'::text) AS detail,
    GREATEST(public.riyadh_date(now()) - f.due_date, 0) AS days_overdue,
    COALESCE(current_sla_days('follow_up'::sla_subject), 0) AS threshold_days
   FROM follow_ups f
  WHERE (f.status = ANY (ARRAY['due'::follow_up_status, 'overdue'::follow_up_status])) AND f.due_date IS NOT NULL AND (public.riyadh_date(now()) - f.due_date) > COALESCE(current_sla_days('follow_up'::sla_subject), 0) AND can_read_boq(f.opportunity_id, ( SELECT auth.uid() AS uid))
UNION ALL
 SELECT 'stalled_deal'::sla_subject AS subject,
    o.id AS record_id,
    o.id AS opportunity_id,
    o.owner_id,
    o.project_name AS detail,
    public.riyadh_date(now()) - public.riyadh_date(last_verified_client_contact(o.id)) AS days_overdue,
    current_sla_days('stalled_deal'::sla_subject) AS threshold_days
   FROM analytics_scope_opportunities o
  WHERE (o.sales_stage <> ALL (ARRAY['won'::sales_stage, 'lost'::sales_stage])) AND current_sla_days('stalled_deal'::sla_subject) IS NOT NULL AND last_verified_client_contact(o.id) IS NOT NULL AND last_verified_client_contact(o.id) < (now() - make_interval(days => current_sla_days('stalled_deal'::sla_subject)));


CREATE OR REPLACE FUNCTION public.notify_due_follow_ups(_today date DEFAULT public.riyadh_date(now()))
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.notify_overdue_items()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r          RECORD;
  _count      INTEGER := 0;
  _lookback   INTEGER := 7;
BEGIN
  FOR _r IN
    SELECT f.id, f.action_owner_id AS owner_id, f.due_date, f.reason,
           f.linked_record_id, f.priority,
           CASE WHEN f.linked_record_type IN ('opportunity','rfq','tender','approval','quotation','inbox_item','task')
                THEN f.linked_record_type ELSE 'opportunity' END AS entity_type
      FROM public.opportunity_flags f
     WHERE f.due_date < public.riyadh_date(now())
       AND f.due_date >= public.riyadh_date(now()) - _lookback
       AND f.status IN ('open','in_progress','escalated','blocked')
       AND f.action_owner_id IS NOT NULL
       -- Only tier A/B become notifications; C would be noise.
       AND f.priority IN ('A','B')
  LOOP
    -- emit_notification enforces the rest: no self-notification, no suspended
    -- recipients, and no duplicate for the same (recipient, type, entity, key).
    IF public.emit_notification(
         _r.owner_id, 'item_overdue', _r.entity_type, _r.linked_record_id,
         COALESCE(_r.reason, 'Action overdue'),
         'This action passed its due date on ' || _r.due_date::TEXT || '.',
         'critical', 'item_became_overdue',
         'overdue:' || _r.id::TEXT || ':' || _r.due_date::TEXT,
         CASE WHEN _r.entity_type = 'opportunity'
              THEN jsonb_build_object('opportunity_id', _r.linked_record_id)
              ELSE NULL END
       ) IS NOT NULL
    THEN
      _count := _count + 1;
    END IF;
  END LOOP;
  RETURN _count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.run_sales_automations(_trigger text DEFAULT 'cron'::text)
 RETURNS TABLE(run_id uuid, raised integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _run_id    UUID;
  _raised    INT := 0;
  _notified  INT := 0;
  _n       INT;
  _today   DATE := public.riyadh_date(now());  -- 20261116150000: Riyadh, not the server's UTC day
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
     AND COALESCE(public.riyadh_date(q.last_follow_up_at), q.issued_date) < _today - 5
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
END $function$
;
