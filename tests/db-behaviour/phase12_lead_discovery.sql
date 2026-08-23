-- =============================================================================
-- Phase 12 — lead discovery.
--
-- The controls: an agent cannot ingest from an unsanctioned source, duplicates
-- are surfaced rather than refused, and nothing reaches the CRM without a
-- person having looked at it.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE s1 UUID; sm UUID; vw UUID; est UUID; adm UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('ld_s1@phc-sa.com'),('ld_sm@phc-sa.com'),('ld_vw@phc-sa.com'),
    ('ld_est@phc-sa.com'),('ld_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='ld_s1@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ld_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ld_vw@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='ld_est@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ld_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,sm,vw,est,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(sm,'sales_manager'),(vw,'viewer'),
    (est,'estimation_manager'),(adm,'system_admin');

  INSERT INTO public.source_registry (vault_path, source_type, approved_for_agent_use)
    VALUES ('etimad.sa', 'government_procurement', TRUE);
  INSERT INTO public.source_registry (vault_path, source_type, approved_for_agent_use)
    VALUES ('random-blog.example', 'web_scrape', FALSE);
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; b BOOLEAN; s1 UUID; sm UUID; vw UUID; est UUID; adm UUID;
  l1 UUID; l2 UUID; l3 UUID; o1 UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='ld_s1@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ld_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ld_vw@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='ld_est@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ld_adm@phc-sa.com';

  -- ===== source governance =====
  SELECT public.source_is_approved_for_agents('etimad.sa') INTO b;
  RAISE NOTICE '% 1. an approved source is recognised (expect true, got %)',
    CASE WHEN b THEN 'PASS' ELSE 'FAIL' END, b;
  SELECT public.source_is_approved_for_agents('random-blog.example') INTO b;
  RAISE NOTICE '% 2. an unapproved source is not (expect false, got %)',
    CASE WHEN NOT b THEN 'PASS' ELSE 'FAIL' END, b;
  SELECT public.source_is_approved_for_agents('never-heard-of-it') INTO b;
  RAISE NOTICE '% 3. an unregistered source is not either (expect false, got %)',
    CASE WHEN NOT b THEN 'PASS' ELSE 'FAIL' END, b;

  -- A human may enter a lead from anywhere; judgement is theirs.
  PERFORM set_config('test.uid', s1::text, TRUE);
  INSERT INTO public.leads (source, project_name, location, main_contractor_guess, owner_id)
    VALUES ('random-blog.example', 'Mataf Expansion', 'Makkah', 'Binladen', s1)
    RETURNING id INTO l1;
  RAISE NOTICE 'PASS 4. a human may enter a lead from an unapproved source';

  RAISE NOTICE '--- phase 12 human path: done ---';
END $$;

RESET ROLE;

-- ===== the agent path: auth.uid() IS NULL, as cron and the orchestrator run =====
DO $$
DECLARE n INT; l2 UUID;
BEGIN
  PERFORM set_config('test.uid', '', TRUE);

  BEGIN
    INSERT INTO public.leads (source, project_name, location)
      VALUES ('random-blog.example', 'Scraped Thing', 'Riyadh');
    RAISE NOTICE 'FAIL 5. an agent ingested from an unapproved source';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 5. an agent cannot ingest from an unapproved source';
  END;

  BEGIN
    INSERT INTO public.leads (source, project_name, location)
      VALUES (NULL, 'Sourceless Thing', 'Riyadh');
    RAISE NOTICE 'FAIL 6. an agent ingested a lead with no source at all';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 6. …nor with no source at all';
  END;

  INSERT INTO public.leads (source, project_name, location, main_contractor_guess)
    VALUES ('etimad.sa', 'Mataf  Expansion Project', 'Makkah', 'Bin Laden Group')
    RETURNING id INTO l2;
  RAISE NOTICE 'PASS 7. an agent may ingest from the approved registry';

  -- ===== duplicate detection: surfaced, never refused =====
  SELECT count(*) INTO n FROM public.leads
   WHERE dedupe_key = public.normalize_lead_key('Mataf Expansion','Makkah');
  RAISE NOTICE '% 8. two spellings collapse to one key and BOTH exist (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='public' AND tablename='leads' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%dedupe_key%';
  RAISE NOTICE '% 9. no unique index blocks a legitimate second lead (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 12 agent path: done ---';
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; s1 UUID; sm UUID; vw UUID; est UUID; adm UUID; l1 UUID; l2 UUID; o1 UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='ld_s1@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ld_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ld_vw@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='ld_est@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ld_adm@phc-sa.com';

  -- Identity BEFORE the lookups. Resolving lead ids while unauthenticated
  -- returns NULL under the new policy, and every check below then updates zero
  -- rows and "passes" or "fails" for reasons that have nothing to do with the
  -- rule being tested.
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT id INTO l1 FROM public.leads WHERE project_name='Mataf Expansion';
  SELECT id INTO l2 FROM public.leads WHERE project_name='Mataf  Expansion Project';
  SELECT count(*) INTO n FROM public.lead_duplicate_candidates
   WHERE dedupe_key = public.normalize_lead_key('Mataf Expansion','Makkah');
  RAISE NOTICE '% 10. …and are reported as duplicate candidates (expect 1 group, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== promotion needs a person =====
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('From lead', s1) RETURNING id INTO o1;

  BEGIN UPDATE public.leads SET converted_opportunity_id=o1 WHERE id=l1;
    RAISE NOTICE 'FAIL 11. an unreviewed lead was converted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 11. an unreviewed lead cannot become an opportunity'; END;

  UPDATE public.leads SET reviewed_by=sm, review_note='Checked the tender notice' WHERE id=l1;
  SELECT count(*) INTO n FROM public.leads WHERE id=l1 AND reviewed_at IS NOT NULL;
  RAISE NOTICE '% 12. reviewing stamps the time (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  UPDATE public.leads SET converted_opportunity_id=o1 WHERE id=l1;
  SELECT count(*) INTO n FROM public.leads WHERE id=l1 AND converted_opportunity_id=o1;
  RAISE NOTICE '% 13. a reviewed lead converts (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== one lead, one opportunity, once =====
  UPDATE public.leads SET reviewed_by=sm WHERE id=l2;
  BEGIN UPDATE public.leads SET converted_opportunity_id=o1 WHERE id=l2;
    RAISE NOTICE 'FAIL 14. two leads converted into the same opportunity';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 14. one opportunity comes from at most one lead'; END;

  BEGIN UPDATE public.leads SET converted_opportunity_id=gen_random_uuid() WHERE id=l1;
    RAISE NOTICE 'FAIL 15. a converted lead was re-pointed';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN
    RAISE NOTICE 'PASS 15. a converted lead cannot be re-pointed'; END;

  -- ===== a known duplicate is not promoted =====
  UPDATE public.leads SET duplicate_of_lead_id=l1 WHERE id=l2;
  BEGIN UPDATE public.leads SET converted_opportunity_id=(SELECT id FROM public.opportunities WHERE project_name='From lead') WHERE id=l2;
    RAISE NOTICE 'FAIL 16. a known duplicate was promoted into the pipeline';
  EXCEPTION WHEN check_violation OR unique_violation THEN
    RAISE NOTICE 'PASS 16. a lead marked duplicate is not promoted'; END;

  BEGIN UPDATE public.leads SET duplicate_of_lead_id=l2 WHERE id=l2;
    RAISE NOTICE 'FAIL 17. a lead became its own duplicate';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 17. a lead cannot be a duplicate of itself'; END;

  -- ===== reads =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.leads WHERE id IN (l1,l2);
  RAISE NOTICE '% 18. the sales team shares the lead pool (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.leads;
  RAISE NOTICE '% 19. viewer reads no leads (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', est::text, TRUE);
  SELECT count(*) INTO n FROM public.leads;
  RAISE NOTICE '% 20. estimation does not prospect, and reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.leads;
  RAISE NOTICE '% 21. system_admin alone reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.leads;
  RAISE NOTICE '% 22. anon reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.lead_scores;
  RAISE NOTICE '% 23. viewer reads no lead scores (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the review queue =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.lead_review_queue WHERE id=l1;
  RAISE NOTICE '% 24. a converted lead leaves the review queue (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.lead_review_queue WHERE id=l2 AND has_duplicate_candidates;
  RAISE NOTICE '% 25. the queue flags a lead with duplicate candidates (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.lead_review_queue WHERE id=l2 AND source_approved;
  RAISE NOTICE '% 26. …and reports whether its source is sanctioned (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== nothing is deleted =====
  -- Two ways a client can be refused: no DELETE grant raises, no DELETE policy
  -- matches zero rows. Both are correct outcomes, so both pass — what must not
  -- happen is a row disappearing.
  BEGIN
    DELETE FROM public.leads WHERE id=l2;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '% 27. a client DELETE removes no lead (expect 0 rows, got %)',
      CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 27. a client holds no DELETE privilege on leads at all';
  END;

  -- ===== the deprecated sibling =====
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.recommendations;
  RAISE NOTICE '% 28. viewer no longer reads the deprecated recommendations table (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 12 lead discovery: done ---';
END $$;

RESET ROLE;

DO $$
DECLARE n INT; l1 UUID;
BEGIN
  SELECT id INTO l1 FROM public.leads WHERE project_name='Mataf Expansion';
  BEGIN DELETE FROM public.leads WHERE id=l1;
    RAISE NOTICE 'FAIL 29. a lead was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 29. leads refuse DELETE even as owner'; END;

  -- A row-level trigger cannot fire on an empty table, so deleting from one
  -- proves nothing. The table ships empty; give it something to refuse.
  INSERT INTO public.recommendations (agent_module, recommendation, status)
    VALUES ('phase12_test', 'delete me', 'pending');
  BEGIN DELETE FROM public.recommendations WHERE agent_module='phase12_test';
    RAISE NOTICE 'FAIL 30. the deprecated recommendations table is still deletable';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 30. recommendations refuse DELETE'; END;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname IN ('leads','recommendations') AND p.polcmd='d';
  RAISE NOTICE '% 31. no DELETE policy on either table (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
