-- =============================================================================
-- Security hotfix — activity and task read isolation.
--
-- Before this, `activities` and `tasks` were readable by every active user.
-- The checks that matter are the four shapes an activity can take — deal,
-- RFQ, tender, company-only — because a predicate that only understood
-- opportunities would blank three of them while looking like it worked.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID;
  c1 UUID; o1 UUID; r1 UUID; t1 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('ar_s1@phc-sa.com'),('ar_s2@phc-sa.com'),('ar_sm@phc-sa.com'),
    ('ar_vw@phc-sa.com'),('ar_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='ar_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ar_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ar_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ar_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ar_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),
    (vw,'viewer'),(adm,'system_admin');

  INSERT INTO public.companies (name) VALUES ('AR Client') RETURNING id INTO c1;
  INSERT INTO public.opportunities (project_name, owner_id, company_id)
    VALUES ('AR deal', s1, c1) RETURNING id INTO o1;
  INSERT INTO public.rfqs (received_date, sales_owner_id) VALUES (current_date, s1) RETURNING id INTO r1;
  INSERT INTO public.tenders (tender_name, tender_owner_id) VALUES ('AR tender', s1) RETURNING id INTO t1;

  -- The four shapes an activity can take. s2 owns none of them.
  INSERT INTO public.activities (activity_type,status,related_opportunity_id,company_id,owner_id,occurred_at,summary,draft_content,created_by)
    VALUES ('meeting','logged',o1,c1,s1,now(),'AR deal meeting','private reasoning',s1);
  INSERT INTO public.activities (activity_type,status,related_rfq_id,owner_id,occurred_at,summary,created_by)
    VALUES ('call','logged',r1,s1,now(),'AR rfq call',s1);
  INSERT INTO public.activities (activity_type,status,related_tender_id,owner_id,occurred_at,summary,created_by)
    VALUES ('call','logged',t1,s1,now(),'AR tender call',s1);
  INSERT INTO public.activities (activity_type,status,company_id,owner_id,occurred_at,summary,created_by)
    VALUES ('note','logged',c1,s1,now(),'AR company note',s1);

  INSERT INTO public.tasks (title, related_opportunity_id, owner_id, due_date, status, created_by)
    VALUES ('AR deal task', o1, s1, current_date + 1, 'open', s1);
  INSERT INTO public.tasks (title, owner_id, due_date, status, created_by)
    VALUES ('AR loose task', s1, current_date + 1, 'open', s1);
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='ar_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ar_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ar_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ar_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ar_adm@phc-sa.com';

  -- ===== the owner keeps every shape =====
  -- This is the check that would catch a predicate keyed only on the
  -- opportunity: three of these four rows have related_opportunity_id NULL.
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.activities WHERE summary LIKE 'AR %';
  RAISE NOTICE '% 1. the owner still reads all four activity shapes (expect 4, got %)',
    CASE WHEN n=4 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.activities WHERE summary='AR rfq call';
  RAISE NOTICE '% 2. an RFQ-only activity is not blanked (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.activities WHERE summary='AR tender call';
  RAISE NOTICE '% 3. a tender-only activity is not blanked (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.activities WHERE summary='AR company note';
  RAISE NOTICE '% 4. a company-only activity is not blanked (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the exposure is closed =====
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.activities WHERE summary LIKE 'AR %';
  RAISE NOTICE '% 5. an unrelated salesperson reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.activities WHERE summary LIKE 'AR %';
  RAISE NOTICE '% 6. viewer reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.activities WHERE summary LIKE 'AR %';
  RAISE NOTICE '% 7. system_admin alone reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.activities WHERE summary LIKE 'AR %';
  RAISE NOTICE '% 8. anon reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- draft_content was the worst of it: unsent correspondence.
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.activities WHERE draft_content IS NOT NULL;
  RAISE NOTICE '% 9. an outsider reaches no draft_content (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== management still sees the board =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.activities WHERE summary LIKE 'AR %';
  RAISE NOTICE '% 10. the pipeline still sees everything (expect 4, got %)',
    CASE WHEN n=4 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== tasks =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.tasks WHERE title LIKE 'AR %';
  RAISE NOTICE '% 11. the task owner reads both of theirs (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.tasks WHERE title LIKE 'AR %';
  RAISE NOTICE '% 12. an unrelated salesperson reads no tasks (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.tasks WHERE title LIKE 'AR %';
  RAISE NOTICE '% 13. viewer reads no tasks (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.tasks WHERE title LIKE 'AR %';
  RAISE NOTICE '% 14. the pipeline still sees both (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== history is no longer erasable =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  DELETE FROM public.tasks WHERE title='AR loose task';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 15. a client DELETE on tasks removes nothing (expect 0 rows, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- activity read isolation: done ---';
END $$;

RESET ROLE;

DO $$
DECLARE n INT;
BEGIN
  -- The service role bypasses RLS but not triggers.
  BEGIN DELETE FROM public.tasks WHERE title='AR loose task';
    RAISE NOTICE 'FAIL 16. a task was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 16. tasks refuse DELETE even as owner'; END;

  BEGIN DELETE FROM public.account_interactions WHERE summary IS NOT NULL;
    RAISE NOTICE 'FAIL 17. an account interaction was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 17. account interactions refuse DELETE'; END;

  BEGIN DELETE FROM public.communication_templates WHERE TRUE;
    RAISE NOTICE 'FAIL 18. a communication template was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 18. communication templates refuse DELETE'; END;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname IN ('tasks','account_interactions','communication_templates','activities')
     AND p.polcmd='d';
  RAISE NOTICE '% 19. no DELETE policy survives on any of the four (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The blanket predicate must be gone, not merely shadowed by a new one.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('activities','tasks') AND cmd='SELECT'
     AND qual !~ 'can_read_activity|can_read_boq|owner_id';
  RAISE NOTICE '% 20. no blanket SELECT policy is left behind (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- activity delete isolation: done ---';
END $$;
