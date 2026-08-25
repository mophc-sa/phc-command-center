-- =============================================================================
-- Security hotfix — the six blanket reads that hang off an opportunity.
--
-- The check that matters most is not any single table: it is that the blanket
-- policy is GONE rather than shadowed. Permissive policies OR together, so a
-- surviving one makes every isolation check below pass for the wrong reason.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID; o1 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('da_s1@phc-sa.com'),('da_s2@phc-sa.com'),('da_sm@phc-sa.com'),
    ('da_vw@phc-sa.com'),('da_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='da_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='da_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='da_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='da_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='da_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),
    (vw,'viewer'),(adm,'system_admin') ON CONFLICT DO NOTHING;

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('DA deal', s1) RETURNING id INTO o1;
  INSERT INTO public.stakeholders (opportunity_id, name) VALUES (o1, 'DA stakeholder');
  INSERT INTO public.evidence_sources (related_opportunity_id, source_type, source_title)
    VALUES (o1, 'file_upload', 'DA evidence');
  INSERT INTO public.approvals (approval_type, requested_by, related_opportunity_id)
    VALUES ('da_test', s1, o1);
  -- An approval attached to no deal, waiting on s2: the case a deal-only rule
  -- would hide from the very person who must decide it.
  INSERT INTO public.approvals (approval_type, requested_by, assigned_approver)
    VALUES ('da_unattached', sm, s2);
END $$;

SET ROLE rls_tester;

DO $$
DECLARE n INT; s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID; o1 UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='da_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='da_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='da_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='da_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='da_adm@phc-sa.com';
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT id INTO o1 FROM public.opportunities WHERE project_name='DA deal';

  -- ===== stakeholders =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.stakeholders WHERE opportunity_id=o1;
  RAISE NOTICE '% 1. the deal owner reads its stakeholders (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.stakeholders WHERE opportunity_id=o1;
  RAISE NOTICE '% 2. an unrelated salesperson reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.stakeholders;
  RAISE NOTICE '% 3. viewer reads no stakeholders at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.stakeholders WHERE opportunity_id=o1;
  RAISE NOTICE '% 4. the pipeline still sees them (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== evidence_sources: the table with a FOR ALL policy behind it =====
  -- Its write rule grants bd_manager and friends FOR ALL, and a FOR ALL USING
  -- governs SELECT. Without the restrictive cap these two would pass anyway.
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.evidence_sources WHERE related_opportunity_id=o1;
  RAISE NOTICE '% 5. the deal owner reads its evidence (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.evidence_sources WHERE related_opportunity_id=o1;
  RAISE NOTICE '% 6. an outsider reads none, despite the FOR ALL write rule (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.evidence_sources;
  RAISE NOTICE '% 7. viewer reads no evidence (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== approvals: the deal, the requester, and the approver =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.approvals WHERE approval_type='da_test';
  RAISE NOTICE '% 8. the requester reads their own approval (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.approvals WHERE approval_type='da_unattached';
  RAISE NOTICE '% 9. the assigned approver reads one attached to no deal (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.approvals WHERE approval_type='da_test';
  RAISE NOTICE '% 10. …but not one for a deal they are not on (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.approvals;
  RAISE NOTICE '% 11. viewer reads no approvals (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.approvals;
  RAISE NOTICE '% 12. system_admin alone reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.approvals WHERE approval_type IN ('da_test','da_unattached');
  RAISE NOTICE '% 13. the pipeline sees both (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.approvals;
  RAISE NOTICE '% 14. anon reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- deal-attached reads: done ---';
END $$;

RESET ROLE;

-- ===== the checks that make the rest worth having =====
DO $$
DECLARE n INT; r RECORD;
BEGIN
  -- No blanket read may survive on any of the six. A surviving one ORs itself
  -- back in and every check above passes for the wrong reason.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND cmd='SELECT'
     AND tablename IN ('stakeholders','operations_handovers','artifacts',
                       'boq_extractions','approvals','evidence_sources')
     AND btrim(regexp_replace(coalesce(qual,'x'), E'[\n ]+',' ','g'))
         IN ('is_active_user(( SELECT auth.uid() AS uid))','is_active_user(auth.uid())');
  RAISE NOTICE '% 15. no blanket read survives on the six (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The pre-existing correct policy on boq_extractions must still be there.
  -- A command-level sweep would have taken it with the blanket one.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='boq_extractions' AND cmd='SELECT';
  RAISE NOTICE '% 16. boq_extractions keeps its own scoped policy (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- Dropping a blanket policy and forgetting the replacement locks everybody
  -- out, which also passes an "is it open?" check.
  SELECT count(*) INTO n FROM (
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
     WHERE ns.nspname='public'
       AND c.relname IN ('stakeholders','operations_handovers','artifacts',
                         'boq_extractions','approvals','evidence_sources')
       AND NOT EXISTS (SELECT 1 FROM pg_policy p
                        WHERE p.polrelid=c.oid AND p.polcmd='r' AND p.polpermissive)
  ) x;
  RAISE NOTICE '% 17. every one still has a permissive read policy (expect 0 missing, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- evidence_sources carries a FOR ALL policy, so it needs the restrictive cap.
  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname='evidence_sources' AND p.polcmd='r' AND NOT p.polpermissive;
  RAISE NOTICE '% 18. evidence_sources read is capped against its FOR ALL rule (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
