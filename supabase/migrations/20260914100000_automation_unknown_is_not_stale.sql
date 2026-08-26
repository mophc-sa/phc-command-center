-- =========================================================
-- Pre-Package-D — automation parity: unknown is not stale.
--
-- THE DEFECT, IN FIVE PLACES
-- --------------------------
-- The TypeScript engine was corrected so an absence of client-activity
-- evidence is NOT evidence that no contact happened. The SQL side still said
-- the opposite, in the same shape, five times:
--
--   run_automations_in_sql   20260806120000  rule 9    superseded
--   sales_code_and_...       20260806140000  rule 9    superseded
--   phase_4_overdue_auto     20260819110000  rule 9    LIVE — cron 04:00 UTC
--   phase10_management       20260902100000  pipeline_by_stage.stalled
--   phase13_sla_and_alerts   20260905100000  sla_breaches.stalled_deal
--
-- The first two are historical: all three CREATE OR REPLACE one function, and
-- the newest definition is what the database holds. They are deliberately left
-- alone — editing a superseded migration changes nothing that runs and
-- falsifies the record of what was deployed when.
--
-- WHAT WAS WRONG
-- --------------
-- 1. `last_activity_at IS NULL` was read as "stale". That column is stamped by
--    logActivity() for ANY activity — internal notes and unsent drafts
--    included — and the import path never writes it at all. So every
--    historically promoted opportunity carried NULL and was flagged a risk for
--    lacking a history this system never had the chance to record. Those deals
--    hold years of real relationship. Not knowing about it is a fact about the
--    CRM, not about the client.
--
-- 2. `INTERVAL '14 days'` was a number this codebase chose. phase13 made it
--    configurable and then undid that with `coalesce(..., 14)` — against the
--    explicit advice in current_sla_days()'s own comment, which says callers
--    must supply a fallback "so an unset policy never means everything is
--    breaching".
--
-- 3. phase13 also published `coalesce(current_date - last_activity_at, 9999)`,
--    reporting a record with no activity as 9,999 days late.
--
-- WHAT REPLACES IT
-- ----------------
-- One definition of client contact, mirroring isMeaningfulClientActivity() in
-- src/lib/attention.ts, and one rule: no verified contact means we do not
-- know, and an unset SLA means nothing is late. Both produce silence rather
-- than a false alarm.
--
-- NOTHING REAL IS WEAKENED. Every other rule rests on an actual date and is
-- untouched: RFQ unassigned, verbal award without contract, overdue
-- follow-ups, overdue next actions, missing next action, pending approvals,
-- and the whole notify_overdue_items pass.
--
-- The two views are reproduced in full and patched in place — sla_breaches
-- keeps all four of its other subjects, pipeline_by_stage keeps my_deals,
-- pipeline_value and average_deal in their original order, and its new column
-- is APPENDED because CREATE OR REPLACE VIEW may only add at the end.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. One definition of "we spoke to the client" ============
CREATE OR REPLACE FUNCTION public.last_verified_client_contact(_opportunity_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT max(a.occurred_at)
    FROM public.activities a
   WHERE a.related_opportunity_id = _opportunity_id
     AND (
       a.activity_type IN ('call', 'visit', 'meeting')
       OR (a.activity_type IN ('email_draft', 'whatsapp_draft') AND a.status = 'sent')
     );
$fn$;

COMMENT ON FUNCTION public.last_verified_client_contact IS
  'When the client was last actually contacted, or NULL when nothing in the system proves contact ever happened. NULL means UNKNOWN, never "nobody called": the import path records no activity history, so promoted historical deals return NULL while carrying years of real relationship. A note is written to ourselves and an unsent draft reached nobody, so neither counts. Mirrors isMeaningfulClientActivity() in src/lib/attention.ts — the two must not drift.';

GRANT EXECUTE ON FUNCTION public.last_verified_client_contact(UUID) TO authenticated, service_role;

-- ============ 2. The live nightly automation ============
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
  _notified := public.notify_overdue_items();

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

-- ============ 3. Phase 10's stalled count ============
CREATE OR REPLACE VIEW public.pipeline_by_stage AS
  SELECT o.sales_stage,
         count(*)                                                    AS deals,
         count(*) FILTER (WHERE o.owner_id = (SELECT auth.uid()))    AS my_deals,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)) AS pipeline_value,
         round(avg(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)), 2) AS average_deal,
         -- Stalled: silent beyond an APPROVED threshold, measured from real
         -- client contact. Was `last_activity_at IS NULL OR ... 14 days`,
         -- which counted every deal with no logged activity as stalled — on a
         -- book of promoted historical opportunities, all of them.
         count(*) FILTER (
           WHERE public.current_sla_days('stalled_deal') IS NOT NULL
             AND public.last_verified_client_contact(o.id) IS NOT NULL
             AND public.last_verified_client_contact(o.id)
                 < now() - make_interval(days => public.current_sla_days('stalled_deal'))
         ) AS stalled,
         -- APPENDED, never inserted: CREATE OR REPLACE VIEW may only add
         -- columns at the end. Read it beside `stalled` — without it, a quiet
         -- stalled column on an unmeasured book reads as health.
         count(*) FILTER (
           WHERE public.last_verified_client_contact(o.id) IS NULL
         ) AS no_engagement_history
    FROM public.analytics_scope_opportunities o
   WHERE o.sales_stage NOT IN ('won','lost')
   GROUP BY o.sales_stage;;

COMMENT ON VIEW public.pipeline_by_stage IS
  'Open pipeline by sales stage. `stalled` counts only deals with a real client-contact date older than an APPROVED SLA, so it reads 0 while no policy is set — honest rather than optimistic. `no_engagement_history` counts the deals the question cannot be asked of at all; read the two together, or a quiet stalled column on an unmeasured book looks like health.';
GRANT SELECT ON public.pipeline_by_stage TO authenticated;

-- ============ 4. Phase 13's SLA breach report ============
CREATE OR REPLACE VIEW public.sla_breaches AS
  -- Commitments past their date (Phase 9)
  SELECT 'commitment'::public.sla_subject AS subject,
         c.id            AS record_id,
         c.opportunity_id,
         c.owner_id,
         c.description   AS detail,
         c.days_overdue,
         coalesce(public.current_sla_days('commitment'), 0) AS threshold_days
    FROM public.overdue_commitments c
   WHERE c.days_overdue > coalesce(public.current_sla_days('commitment'), 0)

  UNION ALL
  -- Prices waiting on a reviewer (Phase 8)
  SELECT 'price_review',
         q.internal_price_id,
         q.related_opportunity_id,
         NULL::uuid,
         'Awaiting ' || coalesce(q.awaiting, 'review'),
         floor(q.days_waiting)::int,
         coalesce(public.current_sla_days('price_review'), 3)
    FROM public.commercial_review_queue q
   WHERE q.days_waiting > coalesce(public.current_sla_days('price_review'), 3)

  UNION ALL
  -- Leads nobody has looked at (Phase 12)
  SELECT 'lead_review',
         l.id,
         NULL::uuid,
         l.owner_id,
         coalesce(l.project_name, 'Unnamed lead'),
         floor(l.days_waiting)::int,
         coalesce(public.current_sla_days('lead_review'), 7)
    FROM public.lead_review_queue l
   WHERE NOT l.reviewed
     AND l.days_waiting > coalesce(public.current_sla_days('lead_review'), 7)

  UNION ALL
  -- Follow-ups already marked overdue by their own lifecycle
  SELECT 'follow_up',
         f.id,
         f.opportunity_id,
         f.owner_id,
         coalesce(nullif(btrim(f.notes), ''), 'Follow up'),
         greatest((current_date - f.due_date::date), 0),
         coalesce(public.current_sla_days('follow_up'), 0)
    FROM public.follow_ups f
   WHERE f.status IN ('due','overdue')
     AND f.due_date IS NOT NULL
     AND (current_date - f.due_date::date) > coalesce(public.current_sla_days('follow_up'), 0)
     AND public.can_read_boq(f.opportunity_id, (SELECT auth.uid()))

  UNION ALL
  -- Deals silent beyond an APPROVED threshold, measured from real contact.
  --
  -- Was: lateness `coalesce(current_date - last_activity_at, 9999)` against a
  -- threshold `coalesce(current_sla_days('stalled_deal'), 14)`. Two invented
  -- numbers. A deal with no logged activity was published as 9,999 days late,
  -- and with no policy set every deal breached a 14-day rule nobody approved —
  -- the precise thing current_sla_days()'s own comment warns callers against.
  --
  -- Now: no approved policy produces no rows, and no verified contact produces
  -- no row. Both are "we cannot say", which is the truth.
  SELECT 'stalled_deal',
         o.id,
         o.id,
         o.owner_id,
         o.project_name,
         (current_date - public.last_verified_client_contact(o.id)::date),
         public.current_sla_days('stalled_deal')
    FROM public.analytics_scope_opportunities o
   WHERE o.sales_stage NOT IN ('won','lost')
     AND public.current_sla_days('stalled_deal') IS NOT NULL
     AND public.last_verified_client_contact(o.id) IS NOT NULL
     AND public.last_verified_client_contact(o.id)
         < now() - make_interval(days => public.current_sla_days('stalled_deal'));

COMMENT ON VIEW public.sla_breaches IS
  'Everything currently past an APPROVED threshold, in one shape. A subject with no policy in sla_policies now produces no rows rather than breaching for everyone, and a deal with no verified client contact produces no row rather than being reported 9999 days late. Reports only — sending stays with the existing automation, because two writers deciding who gets told is how people end up muting all of it.';
GRANT SELECT ON public.sla_breaches TO authenticated;
