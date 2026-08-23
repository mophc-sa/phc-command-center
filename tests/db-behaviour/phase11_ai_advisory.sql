-- =============================================================================
-- Phase 11 — AI advisory.
--
-- Two guarantees are worth the effort here. The advice cannot be rewritten,
-- so nobody can backfill a warning the model never gave. And accepting advice
-- applies nothing — the canonical record is untouched by anything in this
-- phase.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID; o1 UUID; o2 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('ai_s1@phc-sa.com'),('ai_s2@phc-sa.com'),('ai_sm@phc-sa.com'),
    ('ai_vw@phc-sa.com'),('ai_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='ai_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ai_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ai_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ai_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ai_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),
    (vw,'viewer'),(adm,'system_admin');

  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, quotation_value)
    VALUES ('AI deal', s1, 'under_negotiation', 500000) RETURNING id INTO o1;
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('AI other', s2) RETURNING id INTO o2;

  -- Generated as the service role, which is the only door in.
  INSERT INTO public.ai_recommendations
    (agent_key, title, recommendation, rationale, confidence, severity,
     status, entity_type, entity_id, suggested_action, generated_by)
    VALUES ('deal_risk', 'Deal has gone quiet',
            'Call the PM this week', 'No contact logged for 21 days',
            0.72, 'high', 'open', 'opportunity', o1, 'schedule_call', 'ai-orchestrator');
  INSERT INTO public.ai_recommendations
    (agent_key, title, recommendation, rationale, status, entity_type, entity_id, generated_by)
    VALUES ('deal_risk', 'Other deal risk', 'Chase it', 'quiet', 'open', 'opportunity', o2, 'ai-orchestrator');
  -- Advice about nothing in particular: infrastructure noise.
  INSERT INTO public.ai_recommendations
    (agent_key, title, recommendation, status, generated_by)
    VALUES ('housekeeping', 'Stale records', 'Archive them', 'open', 'ai-orchestrator');
END $$;

CREATE TEMP TABLE ai1 AS SELECT
  (SELECT id FROM public.opportunities WHERE project_name='AI deal') AS o1,
  (SELECT id FROM public.ai_recommendations WHERE title='Deal has gone quiet') AS r1,
  (SELECT id FROM public.ai_recommendations WHERE title='Stale records') AS r0;
GRANT SELECT ON ai1 TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; t TEXT; o1 UUID; r1 UUID; r0 UUID;
  s1 UUID; s2 UUID; sm UUID; vw UUID; adm UUID;
BEGIN
  SELECT a.o1, a.r1, a.r0 INTO o1, r1, r0 FROM ai1 a;
  SELECT id INTO s1  FROM auth.users WHERE email='ai_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ai_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ai_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ai_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ai_adm@phc-sa.com';

  -- ===== the blanket read is closed =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_recommendations WHERE id=r1;
  RAISE NOTICE '% 1. the deal owner reads advice about their deal (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_recommendations WHERE id=r1;
  RAISE NOTICE '% 2. an unrelated salesperson reads none of it (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_recommendations;
  RAISE NOTICE '% 3. viewer reads no advice at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_recommendations;
  RAISE NOTICE '% 4. system_admin alone reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.ai_recommendations;
  RAISE NOTICE '% 5. anon reads none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_recommendations WHERE id IN (r1, r0);
  RAISE NOTICE '% 6. the pipeline sees deal advice and unattached advice (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_recommendations WHERE id=r0;
  RAISE NOTICE '% 7. a salesperson does not see unattached advice (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== a client cannot forge advice =====
  BEGIN
    INSERT INTO public.ai_recommendations (agent_key,title,recommendation,status,entity_type,entity_id,generated_by)
      VALUES ('forged','Forged','Do the thing','open','opportunity',o1,'me');
    RAISE NOTICE 'FAIL 8. a client inserted its own AI recommendation';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 8. a client cannot create advice — generation is the orchestrator''s alone';
  END;

  -- ===== the advice itself is immutable =====
  BEGIN UPDATE public.ai_recommendations SET recommendation='Something I prefer' WHERE id=r1;
    RAISE NOTICE 'FAIL 9. the recommendation text was rewritten';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 9. the recommendation text cannot be rewritten'; END;
  BEGIN UPDATE public.ai_recommendations SET rationale='A reason I invented' WHERE id=r1;
    RAISE NOTICE 'FAIL 10. the rationale was rewritten';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 10. …nor the rationale'; END;
  BEGIN UPDATE public.ai_recommendations SET confidence=0.99 WHERE id=r1;
    RAISE NOTICE 'FAIL 11. the confidence was edited';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 11. …nor the confidence the model reported'; END;
  BEGIN UPDATE public.ai_recommendations SET entity_id=o1, entity_type='quotation' WHERE id=r1;
    RAISE NOTICE 'FAIL 12. the advice was re-pointed at another entity';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 12. …nor what it is about'; END;

  -- ===== a human decides, once, with attribution =====
  BEGIN UPDATE public.ai_recommendations SET status='dismissed' WHERE id=r1;
    RAISE NOTICE 'FAIL 13. advice was dismissed with no reason';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 13. dismissing advice requires a reason'; END;

  UPDATE public.ai_recommendations SET status='accepted' WHERE id=r1;
  SELECT count(*) INTO n FROM public.ai_recommendations
   WHERE id=r1 AND status='accepted' AND decided_by=s1 AND decided_at IS NOT NULL;
  RAISE NOTICE '% 14. accepting stamps who and when from the session (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN UPDATE public.ai_recommendations SET status='dismissed', decision_note='changed my mind' WHERE id=r1;
    RAISE NOTICE 'FAIL 15. a decided recommendation was decided again';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 15. a recommendation is decided once'; END;

  -- As the pipeline, who can actually reach r0. Attempting this as s1 would
  -- match zero rows and raise nothing — a test that could only ever fail.
  PERFORM set_config('test.uid', sm::text, TRUE);
  BEGIN UPDATE public.ai_recommendations SET status='invented_status' WHERE id=r0;
    RAISE NOTICE 'FAIL 16. an unknown status was accepted';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN
    RAISE NOTICE 'PASS 16. the status vocabulary is closed'; END;
  PERFORM set_config('test.uid', s1::text, TRUE);

  -- ===== accepting applies NOTHING =====
  SELECT sales_stage::text INTO t FROM public.opportunities WHERE id=o1;
  RAISE NOTICE '% 17. accepting advice did not move the deal''s stage (expect under_negotiation, got %)',
    CASE WHEN t='under_negotiation' THEN 'PASS' ELSE 'FAIL' END, t;
  SELECT count(*) INTO n FROM public.tasks WHERE related_opportunity_id=o1;
  RAISE NOTICE '% 18. …and created no task behind the user''s back (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.commitments WHERE opportunity_id=o1;
  RAISE NOTICE '% 19. …and no commitment (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the queue =====
  SELECT count(*) INTO n FROM public.ai_advice_queue WHERE id=r1;
  RAISE NOTICE '% 20. decided advice leaves the open queue (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_advice_queue WHERE id=r0;
  RAISE NOTICE '% 21. undecided advice stays in it (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.ai_advice_queue;
  RAISE NOTICE '% 22. viewer has no queue (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== nothing is deleted =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  DELETE FROM public.ai_recommendations WHERE id=r1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 23. a client DELETE removes nothing (expect 0 rows, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 11 ai advisory: done ---';
END $$;

RESET ROLE;

DO $$
DECLARE r1 UUID; n INT;
BEGIN
  SELECT a.r1 INTO r1 FROM ai1 a;
  BEGIN DELETE FROM public.ai_recommendations WHERE id=r1;
    RAISE NOTICE 'FAIL 24. a recommendation was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 24. recommendations refuse DELETE even as owner'; END;

  -- Even the service role cannot revise what the model said after the fact.
  BEGIN UPDATE public.ai_recommendations SET rationale='rewritten by the backend' WHERE id=r1;
    RAISE NOTICE 'FAIL 25. the service role rewrote the advice';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 25. not even the service role can revise the advice'; END;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname='ai_recommendations' AND p.polcmd IN ('a','d');
  RAISE NOTICE '% 26. no INSERT or DELETE policy exists for clients (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The rule this phase exists to keep: no trigger on this table writes to a
  -- canonical record.
  SELECT count(*) INTO n FROM pg_trigger tg
    JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE tg.tgrelid = 'public.ai_recommendations'::regclass
     AND NOT tg.tgisinternal
     AND pg_get_functiondef(p.oid) ~* '(INSERT INTO|UPDATE)\s+public\.(opportunities|quotations|boq_revisions|internal_prices|tasks|commitments)';
  RAISE NOTICE '% 27. no trigger here writes to a canonical table (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;
