-- =============================================================================
-- Phase 13 — SLA, escalation and automation health.
--
-- The checks that matter: an unset policy must not make everything breach,
-- a dead cron must be distinguishable from a quiet week, and the flag list
-- must stop being readable by everyone.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID; o1 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('sl_s1@phc-sa.com'),('sl_s2@phc-sa.com'),('sl_sm@phc-sa.com'),
    ('sl_vw@phc-sa.com'),('sl_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='sl_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='sl_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='sl_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='sl_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='sl_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),
    (vw,'viewer'),(adm,'system_admin');

  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, last_activity_at)
    VALUES ('SLA stalled deal', s1, 'under_negotiation', now() - interval '40 days') RETURNING id INTO o1;

  INSERT INTO public.opportunity_flags (linked_record_type, linked_record_id, flag_kind, status, action_owner_id, created_by)
    VALUES ('opportunity', o1, 'action_required', 'open', s1, s1);

  -- A commitment 10 days late.
  PERFORM set_config('test.uid', s1::text, TRUE);
  INSERT INTO public.commitments (opportunity_id, direction, description, due_date, owner_id)
    VALUES (o1, 'we_owe_client', 'SLA late drawing', current_date - 10, s1);
  PERFORM set_config('test.uid', '', TRUE);
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; d INT; b BOOLEAN; s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID; o1 UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='sl_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='sl_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='sl_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='sl_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='sl_adm@phc-sa.com';
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT id INTO o1 FROM public.opportunities WHERE project_name='SLA stalled deal';

  -- ===== an unset policy must not mean "everything is late" =====
  SELECT public.current_sla_days('commitment') INTO d;
  RAISE NOTICE '% 1. with no policy the threshold is NULL, not zero-by-accident (got %)',
    CASE WHEN d IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(d::text,'NULL');

  SELECT count(*) INTO n FROM public.sla_breaches WHERE subject='stalled_deal' AND record_id=o1;
  RAISE NOTICE '% 2. the fallback threshold still catches a 40-day stall (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the policy takes effect =====
  INSERT INTO public.sla_policies (subject, threshold_days, rationale, created_by)
    VALUES ('stalled_deal', 60, 'Long-cycle infrastructure work', sm);
  SELECT public.current_sla_days('stalled_deal') INTO d;
  RAISE NOTICE '% 3. the policy is in force (expect 60, got %)',
    CASE WHEN d=60 THEN 'PASS' ELSE 'FAIL' END, d;
  SELECT count(*) INTO n FROM public.sla_breaches WHERE subject='stalled_deal' AND record_id=o1;
  RAISE NOTICE '% 4. a 40-day stall is no longer a breach at 60 days (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  INSERT INTO public.sla_policies (subject, threshold_days, created_by, effective_from)
    VALUES ('commitment', 5, sm, now() - interval '1 hour');
  SELECT count(*) INTO n FROM public.sla_breaches WHERE subject='commitment';
  RAISE NOTICE '% 5. a commitment 10 days late breaches a 5-day threshold (expect 1, got %)',
    CASE WHEN n>=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN
    INSERT INTO public.sla_policies (subject, threshold_days, created_by) VALUES ('stalled_deal', 30, sm);
    RAISE NOTICE 'FAIL 6. two thresholds are in force for one subject';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS 6. two overlapping thresholds for one subject are refused'; END;

  -- Different subjects may of course overlap in time.
  BEGIN
    INSERT INTO public.sla_policies (subject, threshold_days, created_by) VALUES ('follow_up', 2, sm);
    RAISE NOTICE 'PASS 7. a different subject may have its own concurrent policy';
  EXCEPTION WHEN others THEN RAISE NOTICE 'FAIL 7. a second subject was refused: %', SQLERRM; END;

  BEGIN
    INSERT INTO public.sla_policies (subject, threshold_days, created_by) VALUES ('lead_review', 400, sm);
    RAISE NOTICE 'FAIL 8. a nonsensical threshold was accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 8. a threshold beyond a year is refused'; END;

  -- ===== who may move the bar =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  BEGIN
    INSERT INTO public.sla_policies (subject, threshold_days, created_by, effective_from)
      VALUES ('quotation_validity', 1, s1, now() + interval '5 years');
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '% 9. a salesperson cannot set an SLA (expect 0 rows, got %)',
      CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'PASS 9. a salesperson cannot set an SLA (refused)';
  END;

  -- …but everyone measured against it may read it. A rule you are judged by
  -- and cannot see is a trap, not a rule.
  SELECT count(*) INTO n FROM public.sla_policies;
  RAISE NOTICE '% 10. a salesperson can read the thresholds they are measured against (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== automation health =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.automation_health;
  RAISE NOTICE '% 11. automation health reports per trigger (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 13 sla: done ---';
END $$;

RESET ROLE;

-- ===== a dead cron must look different from a quiet week =====
DO $$
DECLARE b BOOLEAN; n INT;
BEGIN
  INSERT INTO public.automation_runs (trigger, started_at, finished_at, raised)
    VALUES ('sla_test_fresh', now() - interval '1 hour', now() - interval '50 minutes', 0);
  INSERT INTO public.automation_runs (trigger, started_at, finished_at, raised, error)
    VALUES ('sla_test_dead', now() - interval '9 days', now() - interval '9 days', 0, 'connection refused');

  SELECT looks_stalled INTO b FROM public.automation_health WHERE trigger='sla_test_fresh';
  RAISE NOTICE '% 12. a job that ran an hour ago is not stalled (expect false, got %)',
    CASE WHEN NOT b THEN 'PASS' ELSE 'FAIL' END, b;

  SELECT looks_stalled INTO b FROM public.automation_health WHERE trigger='sla_test_dead';
  RAISE NOTICE '% 13. a job silent for nine days IS stalled (expect true, got %)',
    CASE WHEN b THEN 'PASS' ELSE 'FAIL' END, b;

  SELECT runs_with_errors INTO n FROM public.automation_health WHERE trigger='sla_test_dead';
  RAISE NOTICE '% 14. …and its error is counted (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 13 automation health: done ---';
END $$;

SET ROLE rls_tester;

DO $$
DECLARE n INT; s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID; o1 UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='sl_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='sl_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='sl_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='sl_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='sl_adm@phc-sa.com';
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT id INTO o1 FROM public.opportunities WHERE project_name='SLA stalled deal';

  -- ===== the ninth blanket read is closed =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_flags WHERE linked_record_id=o1;
  RAISE NOTICE '% 15. the action owner sees their flag (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_flags WHERE linked_record_id=o1;
  RAISE NOTICE '% 16. an unrelated salesperson sees none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_flags;
  RAISE NOTICE '% 17. viewer sees no flags at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_flags;
  RAISE NOTICE '% 18. system_admin alone sees none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_flags WHERE linked_record_id=o1;
  RAISE NOTICE '% 19. the pipeline still sees the board (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== breaches respect the same boundary =====
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.sla_breaches WHERE opportunity_id=o1;
  RAISE NOTICE '% 20. an outsider sees no breaches for a deal they cannot read (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.sla_breaches;
  RAISE NOTICE '% 21. viewer sees no breach list (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== nothing sends anything from here =====
  SELECT count(*) INTO n FROM pg_trigger tg JOIN pg_proc p ON p.oid=tg.tgfoid
   WHERE tg.tgrelid='public.sla_policies'::regclass AND NOT tg.tgisinternal
     AND pg_get_functiondef(p.oid) ~* 'INSERT INTO\s+public\.notifications';
  RAISE NOTICE '% 22. this phase adds no second notification writer (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 13 flags: done ---';
END $$;

RESET ROLE;

DO $$
DECLARE n INT;
BEGIN
  BEGIN DELETE FROM public.opportunity_flags WHERE flag_kind='action_required';
    RAISE NOTICE 'FAIL 23. a flag was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 23. flags refuse DELETE even as owner'; END;

  BEGIN DELETE FROM public.sla_policies WHERE subject='follow_up';
    RAISE NOTICE 'FAIL 24. an SLA policy was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 24. SLA policies refuse DELETE'; END;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname IN ('opportunity_flags','sla_policies') AND p.polcmd='d';
  RAISE NOTICE '% 25. no DELETE policy on either table (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
