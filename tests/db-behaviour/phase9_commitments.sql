-- =============================================================================
-- Phase 9 — commitments, next action, communication log.
--
-- The point of the table is that a promise has a counterparty and an outcome.
-- So the checks worth having are: the terms cannot be rewritten after the
-- fact, a close is always stamped, and the deal's boundary holds.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; vw UUID; c1 UUID; o1 UUID; o2 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('p9_s1@phc-sa.com'),('p9_s2@phc-sa.com'),('p9_sm@phc-sa.com'),('p9_vw@phc-sa.com');
  SELECT id INTO s1 FROM auth.users WHERE email='p9_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='p9_s2@phc-sa.com';
  SELECT id INTO sm FROM auth.users WHERE email='p9_sm@phc-sa.com';
  SELECT id INTO vw FROM auth.users WHERE email='p9_vw@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,vw);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),(vw,'viewer');

  INSERT INTO public.companies (name) VALUES ('P9 Client') RETURNING id INTO c1;
  INSERT INTO public.opportunities (project_name, owner_id, company_id) VALUES ('P9 deal', s1, c1) RETURNING id INTO o1;
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('P9 other deal', s2) RETURNING id INTO o2;
END $$;

CREATE TEMP TABLE p9 AS SELECT
  (SELECT id FROM public.opportunities WHERE project_name='P9 deal')       AS o1,
  (SELECT id FROM public.opportunities WHERE project_name='P9 other deal') AS o2,
  (SELECT id FROM public.companies     WHERE name='P9 Client')             AS c1;
GRANT SELECT ON p9 TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; m INT; d DATE; t TEXT; o1 UUID; o2 UUID; c1 UUID; cm UUID;
  s1 UUID; s2 UUID; sm UUID; vw UUID;
BEGIN
  SELECT t2.o1, t2.o2, t2.c1 INTO o1, o2, c1 FROM p9 t2;
  SELECT id INTO s1 FROM auth.users WHERE email='p9_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='p9_s2@phc-sa.com';
  SELECT id INTO sm FROM auth.users WHERE email='p9_sm@phc-sa.com';
  SELECT id INTO vw FROM auth.users WHERE email='p9_vw@phc-sa.com';

  -- ===== a commitment records a promise with a direction =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  INSERT INTO public.commitments (opportunity_id, company_id, direction, description, due_date)
    VALUES (o1, c1, 'we_owe_client', 'Revised pylon drawing', current_date + 3)
    RETURNING id INTO cm;
  SELECT count(*) INTO n FROM public.commitments WHERE id=cm AND owner_id=s1 AND created_by=s1 AND status='open';
  RAISE NOTICE '% 1. a commitment is created open and stamped to its author (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN INSERT INTO public.commitments (opportunity_id, direction, description, due_date, status)
      VALUES (o1, 'client_owes_us', 'Confirm mounting height', current_date + 1, 'met');
    RAISE NOTICE 'FAIL 2. a commitment was created already met';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 2. a commitment must start open'; END;

  BEGIN INSERT INTO public.commitments (opportunity_id, direction, description, due_date)
      VALUES (o1, 'we_owe_client', '   ', current_date + 1);
    RAISE NOTICE 'FAIL 3. an empty promise was recorded';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 3. a commitment must say what was promised'; END;

  -- ===== the terms are fixed once made =====
  BEGIN UPDATE public.commitments SET description='Something else entirely' WHERE id=cm;
    RAISE NOTICE 'FAIL 4. the promise was rewritten after the fact';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 4. what was promised cannot be edited'; END;
  BEGIN UPDATE public.commitments SET due_date = current_date + 60 WHERE id=cm;
    RAISE NOTICE 'FAIL 5. the deadline was moved';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 5. …nor can the date be moved'; END;
  BEGIN UPDATE public.commitments SET direction='client_owes_us' WHERE id=cm;
    RAISE NOTICE 'FAIL 6. the direction was flipped';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 6. …nor who owed whom'; END;

  -- ===== closing is stamped, and final =====
  UPDATE public.commitments SET status='met', outcome_note='Sent 2026-08-24' WHERE id=cm;
  SELECT count(*) INTO n FROM public.commitments
   WHERE id=cm AND status='met' AND closed_by=s1 AND closed_at IS NOT NULL;
  RAISE NOTICE '% 7. closing stamps who and when from the session (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN UPDATE public.commitments SET status='open' WHERE id=cm;
    RAISE NOTICE 'FAIL 8. a closed commitment was reopened';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 8. a closed commitment cannot be reopened'; END;

  BEGIN
    INSERT INTO public.commitments (opportunity_id, direction, description, due_date)
      VALUES (o1, 'we_owe_client', 'Waivable thing', current_date + 2);
    UPDATE public.commitments SET status='waived'
     WHERE opportunity_id=o1 AND description='Waivable thing';
    RAISE NOTICE 'FAIL 9. a commitment was waived with no reason';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 9. waiving a commitment needs a reason'; END;

  -- ===== nothing is deleted =====
  DELETE FROM public.commitments WHERE id=cm;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 10. a client DELETE removes nothing (expect 0 rows, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the deal boundary =====
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.commitments WHERE opportunity_id=o1;
  RAISE NOTICE '% 11. another salesperson sees none of this deal''s commitments (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN
    INSERT INTO public.commitments (opportunity_id, direction, description, due_date)
      VALUES (o1, 'we_owe_client', 'Injected by an outsider', current_date + 1);
    RAISE NOTICE 'FAIL 12. an outsider added a commitment to someone else''s deal';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 12. …and cannot add one either'; END;

  -- Compared against what the owner sees rather than a fixed number: the
  -- failed-waive block above rolls its own INSERT back, so hardcoding a count
  -- here pins the test to an unrelated subtransaction's behaviour.
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.commitments WHERE opportunity_id=o1;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO m FROM public.commitments WHERE opportunity_id=o1;
  RAISE NOTICE '% 13. the pipeline sees everything the owner sees (owner %, pipeline %)',
    CASE WHEN m=n AND n>0 THEN 'PASS' ELSE 'FAIL' END, n, m;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.commitments WHERE opportunity_id=o1;
  RAISE NOTICE '% 14. viewer sees none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.commitments WHERE opportunity_id=o1;
  RAISE NOTICE '% 15. anon sees none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== next action picks the earliest open item across all three sources =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  INSERT INTO public.commitments (opportunity_id, direction, description, due_date)
    VALUES (o1, 'client_owes_us', 'Client confirms height', current_date + 10);
  INSERT INTO public.tasks (title, related_opportunity_id, owner_id, due_date, status, created_by)
    VALUES ('Chase drawing', o1, s1, current_date + 7, 'open', s1);
  INSERT INTO public.follow_ups (opportunity_id, owner_id, due_date, status, notes)
    VALUES (o1, s1, current_date + 2, 'scheduled', 'Ring the PM');

  SELECT source, due_date INTO t, d FROM public.opportunity_next_action WHERE opportunity_id=o1;
  RAISE NOTICE '% 16. the earliest open item wins across all three sources (expect follow_up, got %)',
    CASE WHEN t='follow_up' THEN 'PASS' ELSE 'FAIL' END, coalesce(t,'none');
  RAISE NOTICE '% 17. …with its own due date (expect %, got %)',
    CASE WHEN d = current_date + 2 THEN 'PASS' ELSE 'FAIL' END, current_date + 2, coalesce(d::text,'none');

  SELECT count(*) INTO n FROM public.opportunity_next_action WHERE opportunity_id=o1;
  RAISE NOTICE '% 18. exactly one next action per deal (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_next_action WHERE opportunity_id=o1;
  RAISE NOTICE '% 19. next action respects the deal boundary (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== overdue =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  INSERT INTO public.commitments (opportunity_id, direction, description, due_date)
    VALUES (o1, 'we_owe_client', 'Late thing', current_date - 5);
  SELECT count(*) INTO n FROM public.overdue_commitments WHERE opportunity_id=o1;
  RAISE NOTICE '% 20. an open past-due commitment is reported overdue (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT days_overdue INTO n FROM public.overdue_commitments WHERE opportunity_id=o1;
  RAISE NOTICE '% 21. …with the number of days (expect 5, got %)',
    CASE WHEN n=5 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.overdue_commitments;
  RAISE NOTICE '% 22. viewer sees no overdue list (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 9 commitments: done ---';
END $$;

RESET ROLE;

-- ===== the communication log =====
DO $$
DECLARE s1 UUID; s2 UUID; vw UUID; o1 UUID; c1 UUID; n INT;
BEGIN
  SELECT id INTO s1 FROM auth.users WHERE email='p9_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='p9_s2@phc-sa.com';
  SELECT id INTO vw FROM auth.users WHERE email='p9_vw@phc-sa.com';
  SELECT t.o1, t.c1 INTO o1, c1 FROM p9 t;

  INSERT INTO public.activities (activity_type, status, related_opportunity_id, company_id, owner_id,
                                 occurred_at, summary, draft_content, created_by)
    VALUES ('meeting','logged', o1, c1, s1, now(), 'Site walk with the PM', 'internal only', s1);
  INSERT INTO public.account_interactions (company_id, interaction_type, interaction_date, summary, created_by)
    VALUES (c1, 'call', current_date, 'Called about the tender', s1);
END $$;

SET ROLE rls_tester;
DO $$
DECLARE s1 UUID; s2 UUID; vw UUID; o1 UUID; n INT;
BEGIN
  SELECT id INTO s1 FROM auth.users WHERE email='p9_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='p9_s2@phc-sa.com';
  SELECT id INTO vw FROM auth.users WHERE email='p9_vw@phc-sa.com';
  SELECT t.o1 INTO o1 FROM p9 t;

  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.communication_log WHERE opportunity_id=o1;
  RAISE NOTICE '% 23. the deal owner reads the activity thread (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='communication_log' AND column_name='draft_content';
  RAISE NOTICE '% 24. unsent drafts are not in the contact history (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The view is deliberately narrower than `activities`, which is currently
  -- readable by every active user. An outsider must get nothing here.
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.communication_log WHERE opportunity_id=o1;
  RAISE NOTICE '% 25. the log is narrower than the table under it (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.communication_log;
  RAISE NOTICE '% 26. viewer reads no contact history at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 9 communication log: done ---';
END $$;
RESET ROLE;

-- ===== the service role is refused too =====
DO $$
DECLARE cm UUID; n INT;
BEGIN
  SELECT id INTO cm FROM public.commitments WHERE description='Late thing';
  BEGIN DELETE FROM public.commitments WHERE id=cm;
    RAISE NOTICE 'FAIL 27. a commitment was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 27. commitments refuse DELETE even as owner'; END;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname='commitments' AND p.polcmd='d';
  RAISE NOTICE '% 28. there is no DELETE policy (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
