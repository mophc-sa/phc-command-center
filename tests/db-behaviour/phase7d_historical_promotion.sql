-- =============================================================================
-- Phase 7D — historical promotion.
--
-- The controls that matter here all protect the same thing: that turning a
-- three-year-old spreadsheet row into live pipeline data is a deliberate,
-- individually-reviewed act which leaves the archive exactly as it was.
--
--   * mappings are mandatory and nothing is auto-created
--   * only sales leadership decides
--   * one record per statement — no bulk conversion
--   * the archive is never written to
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  sm UUID; bd UUID; gm UUID; est UUID; vw UUID; adm UUID; s1 UUID;
  bat UUID; row1 UUID; row2 UUID; row3 UUID; co UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('d7_sm@phc-sa.com'),('d7_bd@phc-sa.com'),('d7_gm@phc-sa.com'),('d7_est@phc-sa.com'),
    ('d7_vw@phc-sa.com'),('d7_adm@phc-sa.com'),('d7_s1@phc-sa.com');
  SELECT id INTO sm  FROM auth.users WHERE email='d7_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='d7_bd@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='d7_gm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='d7_est@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='d7_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='d7_adm@phc-sa.com';
  SELECT id INTO s1  FROM auth.users WHERE email='d7_s1@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (sm,bd,gm,est,vw,adm,s1);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (sm,'sales_manager'),(bd,'bd_manager'),(gm,'general_manager'),
    (est,'estimation_manager'),(vw,'viewer'),(adm,'system_admin'),(s1,'salesperson');

  INSERT INTO public.companies (name) VALUES ('D7 Contracting') RETURNING id INTO co;

  INSERT INTO public.historical_sales_batches (source_file, source_sha256, loaded_by)
    VALUES ('d7.csv', repeat('d',64), sm) RETURNING id INTO bat;
  INSERT INTO public.historical_sales_rows (batch_id, row_number, raw)
    VALUES (bat, 1, '{"SALES CODE":"D7-001","CLIENT":"D7 Contracting"}'::jsonb) RETURNING id INTO row1;
  INSERT INTO public.historical_sales_rows (batch_id, row_number, raw)
    VALUES (bat, 2, '{"SALES CODE":"D7-002"}'::jsonb) RETURNING id INTO row2;
  INSERT INTO public.historical_sales_rows (batch_id, row_number, raw)
    VALUES (bat, 3, '{"SALES CODE":"D7-003"}'::jsonb) RETURNING id INTO row3;
END $$;

CREATE TEMP TABLE d7 AS SELECT
  (SELECT id FROM public.companies WHERE name='D7 Contracting') AS co,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='d7.csv' AND r.row_number=1) AS row1,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='d7.csv' AND r.row_number=2) AS row2,
  (SELECT r.id FROM public.historical_sales_rows r JOIN public.historical_sales_batches b ON b.id=r.batch_id
    WHERE b.source_file='d7.csv' AND r.row_number=3) AS row3;
GRANT SELECT ON d7 TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; co UUID; row1 UUID; row2 UUID; row3 UUID;
  sm UUID; bd UUID; gm UUID; est UUID; vw UUID; adm UUID; s1 UUID;
  req1 UUID; req2 UUID; req3 UUID; opp UUID; opp2 UUID; before_raw JSONB;
BEGIN
  SELECT t.co, t.row1, t.row2, t.row3 INTO co, row1, row2, row3 FROM d7 t;
  SELECT id INTO sm  FROM auth.users WHERE email='d7_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='d7_bd@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='d7_gm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='d7_est@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='d7_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='d7_adm@phc-sa.com';
  SELECT id INTO s1  FROM auth.users WHERE email='d7_s1@phc-sa.com';

  PERFORM set_config('test.uid', sm::text, TRUE);

  -- ===== a request starts as a draft =====
  INSERT INTO public.historical_promotion_requests (row_id) VALUES (row1) RETURNING id INTO req1;
  RAISE NOTICE 'PASS 1. a promotion request can be opened against an archive row';

  BEGIN INSERT INTO public.historical_promotion_requests (row_id, status) VALUES (row2,'approved');
    RAISE NOTICE 'FAIL 2. a request was inserted straight into approved';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 2. a request can only be born as a draft'; END;

  -- ===== mandatory mappings =====
  BEGIN UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req1;
    RAISE NOTICE 'FAIL 3. a request with no mappings was submitted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 3. a request with no company is refused'; END;

  UPDATE public.historical_promotion_requests SET company_id=co WHERE id=req1;
  BEGIN UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req1;
    RAISE NOTICE 'FAIL 4. a request with no owner was submitted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 4. a legacy owner label is not an owner — a real user is required'; END;

  UPDATE public.historical_promotion_requests SET owner_user_id=s1 WHERE id=req1;
  BEGIN UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req1;
    RAISE NOTICE 'FAIL 5. a request with no project name was submitted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 5. a project name is required'; END;

  UPDATE public.historical_promotion_requests SET project_name='D7 Tower Signage' WHERE id=req1;
  BEGIN UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req1;
    RAISE NOTICE 'FAIL 6. a request with no canonical status was submitted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 6. an undecided status blocks the request'; END;

  UPDATE public.historical_promotion_requests SET status_canonical='won' WHERE id=req1;
  BEGIN UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req1;
    RAISE NOTICE 'FAIL 7. a missing amount passed without explanation';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 7. an absent amount must be explained, never assumed zero'; END;

  UPDATE public.historical_promotion_requests SET amount_excl_vat=250000.00 WHERE id=req1;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id=req1;
  RAISE NOTICE 'PASS 8. a fully mapped request reaches review';

  -- The queue view agrees with the trigger about readiness.
  SELECT cardinality(missing_mappings) INTO n FROM public.historical_promotion_queue WHERE request_id=req1;
  RAISE NOTICE '% 9. the queue reports nothing missing for a ready request (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== who may decide =====
  PERFORM set_config('test.uid', est::text, TRUE);
  BEGIN UPDATE public.historical_promotion_requests SET status='approved' WHERE id=req1;
    RAISE NOTICE 'FAIL 10. estimation_manager approved a promotion';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 10. estimation_manager cannot approve a promotion'; END;

  -- system_admin is stopped one layer earlier than estimation_manager, and the
  -- difference matters when writing the assertion. estimation_manager can READ
  -- the archive, so their row is visible and the trigger raises. system_admin
  -- is not in can_read_historical_sales() at all, so the UPDATE matches no rows
  -- and returns quietly — there is no exception to catch. Asserting one here
  -- would be a check that can only ever fail, which is how it first read.
  -- What proves the rule is that the request did not move.
  PERFORM set_config('test.uid', adm::text, TRUE);
  UPDATE public.historical_promotion_requests SET status='approved' WHERE id=req1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 11. system_admin''s approval matches no rows at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.historical_promotion_requests
   WHERE id=req1 AND status='pending_review';
  RAISE NOTICE '% 11b. …and the request is still awaiting review (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, TRUE);

  PERFORM set_config('test.uid', s1::text, TRUE);
  BEGIN UPDATE public.historical_promotion_requests SET status='approved' WHERE id=req1;
    RAISE NOTICE 'FAIL 12. a salesperson approved their own promotion';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 12. a salesperson cannot approve their own promotion'; END;

  PERFORM set_config('test.uid', sm::text, TRUE);
  UPDATE public.historical_promotion_requests SET status='approved' WHERE id=req1;
  SELECT count(*) INTO n FROM public.historical_promotion_requests
   WHERE id=req1 AND status='approved' AND reviewed_by=sm AND reviewed_at IS NOT NULL;
  RAISE NOTICE '% 13. sales_manager approves and is stamped from the session (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== promotion =====
  PERFORM set_config('test.uid', est::text, TRUE);
  BEGIN PERFORM public.promote_historical_row(req1);
    RAISE NOTICE 'FAIL 14. estimation_manager promoted a record';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 14. promotion itself is gated, not just the approval'; END;

  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT public.promote_historical_row(req1) INTO opp;
  RAISE NOTICE '% 15. promotion creates one opportunity (got %)',
    CASE WHEN opp IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(opp::text,'null');

  SELECT count(*) INTO n FROM public.opportunities
   WHERE id=opp AND project_name='D7 Tower Signage' AND owner_id=s1 AND company_id=co;
  RAISE NOTICE '% 16. the opportunity carries the mapped company, owner and name (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.opportunities
   WHERE id=opp AND extra_data->>'source'='historical_promotion' AND (extra_data->>'historical_row_id')::uuid = row1;
  RAISE NOTICE '% 17. provenance is recorded on the opportunity (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- Idempotent: a retry returns the same opportunity rather than making a second.
  SELECT public.promote_historical_row(req1) INTO opp2;
  RAISE NOTICE '% 18. promoting twice returns the first opportunity, not a second (%)',
    CASE WHEN opp2 = opp THEN 'PASS' ELSE 'FAIL' END, coalesce(opp2::text,'null');
  SELECT count(*) INTO n FROM public.opportunities WHERE (extra_data->>'historical_row_id')::uuid = row1;
  RAISE NOTICE '% 19. …and only one opportunity exists for that archive row (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== nothing is auto-created =====
  SELECT count(*) INTO n FROM public.companies WHERE name='D7 Contracting';
  RAISE NOTICE '% 20. no duplicate company was invented (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.quotations WHERE related_opportunity_id=opp;
  RAISE NOTICE '% 21. no quotation was fabricated (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the archive is untouched =====
  SELECT raw INTO before_raw FROM public.historical_sales_rows WHERE id=row1;
  RAISE NOTICE '% 22. the archive row still reads exactly as loaded (%)',
    CASE WHEN before_raw->>'SALES CODE' = 'D7-001' THEN 'PASS' ELSE 'FAIL' END,
    coalesce(before_raw->>'SALES CODE','null');
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='historical_sales_rows'
     AND column_name IN ('promoted','promoted_at','opportunity_id','status');
  RAISE NOTICE '% 23. promotion added no state column to the archive (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== a completed request is closed =====
  BEGIN UPDATE public.historical_promotion_requests SET company_id=NULL WHERE id=req1;
    RAISE NOTICE 'FAIL 24. a promoted request was re-mapped';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 24. a promoted request cannot be re-mapped'; END;

  BEGIN UPDATE public.historical_promotion_requests SET promoted_opportunity_id=gen_random_uuid() WHERE id=req1;
    RAISE NOTICE 'FAIL 25. the promotion link was rewritten by hand';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 25. the promotion link is set by the function only'; END;

  -- ===== one archive row, one live request =====
  BEGIN INSERT INTO public.historical_promotion_requests (row_id) VALUES (row1);
    RAISE NOTICE 'FAIL 26. a second live request was opened for the same archive row';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 26. one open request per archive row'; END;

  -- ===== no bulk conversion =====
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row2, co, s1, 'D7 Two', 'lost', 10) RETURNING id INTO req2;
  INSERT INTO public.historical_promotion_requests
    (row_id, company_id, owner_user_id, project_name, status_canonical, amount_excl_vat)
    VALUES (row3, co, s1, 'D7 Three', 'lost', 20) RETURNING id INTO req3;
  UPDATE public.historical_promotion_requests SET status='pending_review' WHERE id IN (req2,req3);
  RAISE NOTICE 'PASS 27. many drafts may be moved to review in one statement';

  BEGIN UPDATE public.historical_promotion_requests SET status='approved' WHERE id IN (req2,req3);
    RAISE NOTICE 'FAIL 28. two records were approved in one statement';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 28. approving two records in one statement is refused'; END;

  UPDATE public.historical_promotion_requests SET status='approved' WHERE id=req2;
  RAISE NOTICE 'PASS 29. …but one at a time is fine';

  -- ===== rejection =====
  BEGIN UPDATE public.historical_promotion_requests SET status='rejected' WHERE id=req3;
    RAISE NOTICE 'FAIL 30. a rejection carried no reason';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 30. a rejection must carry a reason'; END;

  UPDATE public.historical_promotion_requests
     SET status='rejected', rejection_reason='Client entity no longer trades' WHERE id=req3;
  RAISE NOTICE 'PASS 31. a rejection with a reason is recorded';

  BEGIN PERFORM public.promote_historical_row(req3);
    RAISE NOTICE 'FAIL 32. a rejected request was promoted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 32. a rejected request cannot be promoted'; END;

  -- A rejected row may be retried later — that is why the unique index is partial.
  BEGIN INSERT INTO public.historical_promotion_requests (row_id) VALUES (row3);
    RAISE NOTICE 'PASS 33. a rejected archive row may be re-opened later';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'FAIL 33. a rejected row can never be retried'; END;

  -- ===== who can see the queue =====
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.historical_promotion_requests;
  RAISE NOTICE '% 34. viewer sees no promotion requests (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.historical_promotion_requests;
  RAISE NOTICE '% 35. anon sees none (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== nothing is deleted =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  DELETE FROM public.historical_promotion_requests WHERE id=req1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 36. a client DELETE removes no request (expect 0 rows, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 7D historical promotion: done ---';
END $$;

RESET ROLE;

DO $$
DECLARE n INT; req UUID;
BEGIN
  SELECT id INTO req FROM public.historical_promotion_requests WHERE status='promoted' LIMIT 1;

  BEGIN DELETE FROM public.historical_promotion_requests WHERE id=req;
    RAISE NOTICE 'FAIL 37. a promotion request was deleted as owner';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 37. promotion requests refuse DELETE even as owner'; END;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname='historical_promotion_requests' AND p.polcmd='d';
  RAISE NOTICE '% 38. there is no DELETE policy on the queue (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The archive keeps its read-only shape: still exactly one policy per table,
  -- and that policy is still a SELECT.
  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname LIKE 'historical_sales%' AND p.polcmd <> 'r';
  RAISE NOTICE '% 39. the archive still has no write policy of any kind (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 7D archive immutability: done ---';
END $$;
