-- =============================================================================
-- Security hotfix — the five tables whose read predicate was literally `true`.
--
-- The final check is the important one: a schema-wide assertion that no
-- SELECT policy anywhere is still `true`. Closing five tables by name is only
-- worth doing if nothing else is left in the same state.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE s1 UUID; s2 UUID; sm UUID; est UUID; fin UUID; vw UUID; adm UUID;
        o1 UUID; p1 UUID; st UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('ot_s1@phc-sa.com'),('ot_s2@phc-sa.com'),('ot_sm@phc-sa.com'),('ot_est@phc-sa.com'),
    ('ot_fin@phc-sa.com'),('ot_vw@phc-sa.com'),('ot_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='ot_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ot_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ot_sm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='ot_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='ot_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ot_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ot_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,est,fin,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),(est,'estimation_manager'),
    (fin,'finance_manager'),(vw,'viewer'),(adm,'system_admin');

  INSERT INTO public.projects (name) VALUES ('OT project') RETURNING id INTO p1;
  -- s1's deal sits on the project; that is where the stake comes from.
  INSERT INTO public.opportunities (project_name, owner_id, project_id)
    VALUES ('OT deal', s1, p1) RETURNING id INTO o1;

  INSERT INTO public.project_job_stages (project_id, name, position) VALUES (p1, 'OT stage', 1) RETURNING id INTO st;
  INSERT INTO public.project_jobs (project_id, stage_id, title, position) VALUES (p1, st, 'OT job', 1);
  INSERT INTO public.project_budget_items (project_id, category, planned_amount)
    VALUES (p1, 'OT budget line', 5000);
  INSERT INTO public.opportunity_milestones (opportunity_id, milestone) VALUES (o1, 'quotation_sent');
  INSERT INTO public.vendors (name) VALUES ('OT Supplier');
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; s1 UUID; s2 UUID; sm UUID; est UUID; fin UUID; vw UUID; adm UUID; p1 UUID; o1 UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='ot_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ot_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ot_sm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='ot_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='ot_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ot_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ot_adm@phc-sa.com';
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT id INTO p1 FROM public.projects WHERE name='OT project';
  SELECT id INTO o1 FROM public.opportunities WHERE project_name='OT deal';

  -- ===== the delivery board follows the project =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.project_jobs WHERE project_id=p1;
  RAISE NOTICE '% 1. the owner of a deal on the project sees its jobs (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  -- A trigger seeds default stages when a project is created, so the count is
  -- not 1. What matters is that they are all this project's and there is at
  -- least the one inserted above.
  SELECT count(*) INTO n FROM public.project_job_stages WHERE project_id=p1;
  RAISE NOTICE '% 2. …and its stages, all of them this project''s (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.project_jobs WHERE project_id=p1;
  RAISE NOTICE '% 3. an unrelated salesperson sees no jobs (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.project_jobs;
  RAISE NOTICE '% 4. viewer sees no jobs at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.project_jobs;
  RAISE NOTICE '% 5. system_admin alone sees no jobs (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.project_jobs WHERE project_id=p1;
  RAISE NOTICE '% 6. the pipeline still runs delivery (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== budget is money, so it follows the commercial gate =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.project_budget_items WHERE project_id=p1;
  RAISE NOTICE '% 7. a salesperson does not see project budget lines (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, TRUE);
  SELECT count(*) INTO n FROM public.project_budget_items WHERE project_id=p1;
  RAISE NOTICE '% 8. finance does (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.project_budget_items WHERE project_id=p1;
  RAISE NOTICE '% 9. …and so does the pipeline that owns delivery (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.project_budget_items;
  RAISE NOTICE '% 10. viewer sees no budget (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== milestones follow the deal =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_milestones WHERE opportunity_id=o1;
  RAISE NOTICE '% 11. the deal owner sees its milestones (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_milestones WHERE opportunity_id=o1;
  RAISE NOTICE '% 12. an outsider does not (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunity_milestones;
  RAISE NOTICE '% 13. viewer sees no milestones (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the supplier directory, open since before 7B =====
  PERFORM set_config('test.uid', est::text, TRUE);
  SELECT count(*) INTO n FROM public.vendors WHERE name='OT Supplier';
  RAISE NOTICE '% 14. estimation, who raises the RFQs, reads vendors (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, TRUE);
  SELECT count(*) INTO n FROM public.vendors WHERE name='OT Supplier';
  RAISE NOTICE '% 15. finance, who pays them, reads vendors (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.vendors WHERE name='OT Supplier';
  RAISE NOTICE '% 16. the pipeline, who runs procurement, reads vendors (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.vendors;
  RAISE NOTICE '% 17. a salesperson does not transact with suppliers, and reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.vendors;
  RAISE NOTICE '% 18. viewer reads no vendors (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.vendors;
  RAISE NOTICE '% 19. system_admin alone reads no vendors (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.vendors;
  RAISE NOTICE '% 20. anon reads no vendors (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- open table reads: done ---';
END $$;

RESET ROLE;

-- ===== the assertion that makes the rest worth doing =====
DO $$
DECLARE n INT; r RECORD;
BEGIN
  -- Not "the five I fixed" — every SELECT policy in the schema. A sixth table
  -- created with USING (true) tomorrow fails this.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND cmd='SELECT'
     AND btrim(coalesce(qual,'true')) IN ('true','(true)');
  RAISE NOTICE '% 21. no SELECT policy anywhere reads USING (true) (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  IF n > 0 THEN
    FOR r IN SELECT tablename, policyname FROM pg_policies
              WHERE schemaname='public' AND cmd='SELECT'
                AND btrim(coalesce(qual,'true')) IN ('true','(true)')
    LOOP RAISE NOTICE '    still open: %.%', r.tablename, r.policyname; END LOOP;
  END IF;

  -- Every table touched here must still HAVE a read policy — dropping the
  -- blanket one and forgetting to add a replacement locks everybody out, which
  -- is a different failure that also passes an "is it open?" check.
  SELECT count(*) INTO n FROM (
    SELECT c.relname FROM pg_class c
     WHERE c.relname IN ('project_budget_items','project_jobs','project_job_stages',
                         'opportunity_milestones','vendors')
       AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polcmd='r')
  ) x;
  RAISE NOTICE '% 22. every table closed here still has a read policy (expect 0 missing, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
