-- =============================================================================
-- Automation parity — unknown is not stale.
--
-- The nightly job used to raise a RISK flag on any tier A opportunity whose
-- `last_activity_at` was NULL or older than a hardcoded fortnight. Both halves
-- were wrong, and only running the SQL proves the correction:
--
--   NULL is not silence. That column is stamped by logActivity() for ANY
--   activity, notes and unsent drafts included, and the import path never
--   writes it — so every promoted historical opportunity was flagged a risk
--   for lacking a history this system never had a chance to record.
--
--   14 was invented. current_sla_days() returns NULL when the business has set
--   no policy, and the honest fallback is to raise nothing.
--
-- These checks also guard the other direction: the real, date-based rules must
-- keep firing. A fix that silenced genuine overdue alerts would be worse than
-- the defect.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; sm UUID;
  o_hist UUID;      -- promoted historical: no activity history at all
  o_noted UUID;     -- only an internal note
  o_draft UUID;     -- only an unsent draft
  o_met UUID;       -- a real meeting, long ago
  o_recent UUID;    -- a real meeting, yesterday
  o_overdue UUID;   -- a genuinely overdue follow-up
  n INT; n2 INT; ts TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (email) VALUES ('ap_s1@phc-sa.com'), ('ap_sm@phc-sa.com');
  SELECT id INTO s1 FROM auth.users WHERE email='ap_s1@phc-sa.com';
  SELECT id INTO sm FROM auth.users WHERE email='ap_sm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1, sm);
  INSERT INTO public.user_roles (user_id, role) VALUES (s1,'salesperson'), (sm,'sales_manager');

  -- Every one is tier A, which is the only tier rule 9 looks at.
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, last_activity_at)
    VALUES ('AP promoted historical', s1, 'jih', 'A', NULL) RETURNING id INTO o_hist;
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, last_activity_at)
    VALUES ('AP note only', s1, 'jih', 'A', now() - interval '90 days') RETURNING id INTO o_noted;
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, last_activity_at)
    VALUES ('AP draft only', s1, 'jih', 'A', now() - interval '90 days') RETURNING id INTO o_draft;
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, last_activity_at)
    VALUES ('AP met long ago', s1, 'jih', 'A', NULL) RETURNING id INTO o_met;
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, last_activity_at)
    VALUES ('AP met yesterday', s1, 'jih', 'A', NULL) RETURNING id INTO o_recent;
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, last_activity_at)
    VALUES ('AP overdue follow-up', s1, 'jih', 'A', now()) RETURNING id INTO o_overdue;

  INSERT INTO public.activities (activity_type, status, related_opportunity_id, occurred_at, created_by)
    VALUES ('note', 'logged', o_noted, now() - interval '2 days', s1),
           ('email_draft', 'draft', o_draft, now() - interval '2 days', s1),
           ('meeting', 'logged', o_met, now() - interval '90 days', s1),
           ('meeting', 'logged', o_recent, now() - interval '1 day', s1);

  -- ===== the shared definition of client contact =====
  SELECT public.last_verified_client_contact(o_hist) INTO ts;
  RAISE NOTICE '% 1. no activity at all yields NULL, not a fabricated date (got %)',
    CASE WHEN ts IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(ts::text, 'NULL');

  SELECT public.last_verified_client_contact(o_noted) INTO ts;
  RAISE NOTICE '% 2. an internal note is not client contact (expect NULL, got %)',
    CASE WHEN ts IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(ts::text, 'NULL');

  SELECT public.last_verified_client_contact(o_draft) INTO ts;
  RAISE NOTICE '% 3. an unsent draft reached nobody (expect NULL, got %)',
    CASE WHEN ts IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(ts::text, 'NULL');

  SELECT public.last_verified_client_contact(o_met) INTO ts;
  RAISE NOTICE '% 4. a real meeting IS contact (expect a date, got %)',
    CASE WHEN ts IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(ts::text, 'NULL');

  UPDATE public.activities SET status='sent'
   WHERE related_opportunity_id=o_draft AND activity_type='email_draft';
  SELECT public.last_verified_client_contact(o_draft) INTO ts;
  RAISE NOTICE '% 5. …and the same draft DOES count once it is sent (expect a date, got %)',
    CASE WHEN ts IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(ts::text, 'NULL');
  UPDATE public.activities SET status='draft'
   WHERE related_opportunity_id=o_draft AND activity_type='email_draft';

  -- ===== the nightly run, with NO approved policy =====
  -- The phase13 suite runs earlier against this same throwaway database and
  -- leaves a stalled_deal policy behind, so "no policy set" has to be
  -- established rather than assumed. A guard trigger refuses DELETE on
  -- sla_policies — "closed or cancelled, never deleted" — which is the right
  -- design, so the policy is CLOSED instead. current_sla_days() filters on
  -- effective_to, so a closed policy stops being in force.
  UPDATE public.sla_policies SET effective_to = now()
   WHERE subject = 'stalled_deal' AND effective_to IS NULL;
  PERFORM public.run_sales_automations('test');

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE queue_action_type='inactive_tier_a_opportunity';
  RAISE NOTICE '% 6. with no SLA set, NO inactivity risk is raised at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_hist AND flag_kind='risk';
  RAISE NOTICE '% 7. a promoted historical deal is not branded a risk for having no CRM history (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_hist AND queue_action_type='missing_data';
  RAISE NOTICE '% 8. …it is reported as missing engagement history instead (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_recent AND queue_action_type='missing_data';
  RAISE NOTICE '% 9. a deal with real contact raises no missing-history flag (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the same run, WITH an approved policy =====
  -- Close any open policy first: an exclusion constraint forbids two in force
  -- for one subject at the same time, which is itself a good rule.
  UPDATE public.sla_policies SET effective_to = now()
   WHERE subject = 'stalled_deal' AND effective_to IS NULL;
  INSERT INTO public.sla_policies (subject, threshold_days, rationale, created_by, effective_from)
    VALUES ('stalled_deal', 30, 'Approved for this test', sm, now());
  PERFORM public.run_sales_automations('test');

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_met AND queue_action_type='inactive_tier_a_opportunity';
  RAISE NOTICE '% 10. a 90-day silence breaches an approved 30-day policy (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_recent AND queue_action_type='inactive_tier_a_opportunity';
  RAISE NOTICE '% 11. yesterday''s meeting does not breach it (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_hist AND queue_action_type='inactive_tier_a_opportunity';
  RAISE NOTICE '% 12. …and the unmeasurable deal STILL is not called inactive (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== real, date-based automation must keep working =====
  INSERT INTO public.follow_ups (opportunity_id, owner_id, due_date, status)
    VALUES (o_overdue, s1, current_date - 9, 'overdue');
  PERFORM public.run_sales_automations('test');

  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_overdue AND queue_action_type='follow_up_overdue';
  RAISE NOTICE '% 13. a genuinely overdue follow-up still fires (expect >=1, got %)',
    CASE WHEN n>=1 THEN 'PASS' ELSE 'FAIL' END, n;

  UPDATE public.opportunities SET next_action=NULL WHERE id=o_recent;
  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_recent AND queue_action_type='no_next_action';
  RAISE NOTICE '% 14. a missing next action still fires (expect >=1, got %)',
    CASE WHEN n>=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== idempotency =====
  SELECT count(*) INTO n FROM public.opportunity_flags;
  PERFORM public.run_sales_automations('test');
  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n2 FROM public.opportunity_flags;
  RAISE NOTICE '% 15. two further runs raise no duplicates (expect %, got %)',
    CASE WHEN n2=n THEN 'PASS' ELSE 'FAIL' END, n, n2;

  -- Logging a real contact must retire the flag's CAUSE, not merely stop
  -- counting it: the row leaves the SELECT, so a resolved flag is not raised
  -- again. Flags are resolved rather than deleted — the same guard trigger
  -- that protects sla_policies protects these, and rightly so.
  INSERT INTO public.activities (activity_type, status, related_opportunity_id, occurred_at, created_by)
    VALUES ('call', 'logged', o_hist, now(), s1);
  UPDATE public.opportunity_flags SET status='resolved'
   WHERE linked_record_id=o_hist AND queue_action_type='missing_data';
  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.opportunity_flags
   WHERE linked_record_id=o_hist AND queue_action_type='missing_data' AND status='open';
  RAISE NOTICE '% 16. once a real contact is logged, a resolved flag is not re-raised (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the two views agree with the automation =====
  -- Both read analytics_scope_opportunities, which shows management the company
  -- and everyone else their own deals. Without a user context the scope view
  -- returns nothing and the checks below would pass vacuously.
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.sla_breaches
   WHERE subject='stalled_deal' AND record_id=o_hist;
  RAISE NOTICE '% 17. sla_breaches reports no stall for an unmeasurable deal (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT coalesce(sum(no_engagement_history), 0) INTO n FROM public.pipeline_by_stage;
  RAISE NOTICE '% 18. pipeline_by_stage counts the unmeasurable deals separately (expect >=1, got %)',
    CASE WHEN n>=1 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '  (automation engagement parity suite complete)';
END $$;
