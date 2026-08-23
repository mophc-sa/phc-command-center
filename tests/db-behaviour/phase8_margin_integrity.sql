-- =============================================================================
-- Phase 8 — margin integrity.
--
-- The control being proved: the margin the GM approves is arithmetic on the
-- price and the real cost, not a figure someone typed. Before this phase you
-- could send any margin you liked up the chain and it would be approved as
-- though it meant something.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  est UUID; fin UUID; gm UUID; sm UUID; vw UUID; s1 UUID; ven UUID;
  o1 UUID; b1 UUID; r1 UUID; l1 UUID; l2 UUID; e1 UUID; sq UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('m8_est@phc-sa.com'),('m8_fin@phc-sa.com'),('m8_gm@phc-sa.com'),
    ('m8_sm@phc-sa.com'),('m8_vw@phc-sa.com'),('m8_s1@phc-sa.com');
  SELECT id INTO est FROM auth.users WHERE email='m8_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='m8_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='m8_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='m8_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='m8_vw@phc-sa.com';
  SELECT id INTO s1  FROM auth.users WHERE email='m8_s1@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (est,fin,gm,sm,vw,s1);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (est,'estimation_manager'),(fin,'finance_manager'),(gm,'general_manager'),
    (sm,'sales_manager'),(vw,'viewer'),(s1,'salesperson');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('M8 deal', s1) RETURNING id INTO o1;
  INSERT INTO public.boqs (related_opportunity_id,title,status,source_confidence,currency,created_by)
    VALUES (o1,'M8 BOQ','estimated_scope','medium','SAR',est) RETURNING id INTO b1;
  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b1,1,'draft','manual',est) RETURNING id INTO r1;
  INSERT INTO public.boq_lines (revision_id,line_number,sign_type,quantity,unit)
    VALUES (r1,1,'M8 Pylon',1,'no') RETURNING id INTO l1;
  INSERT INTO public.boq_lines (revision_id,line_number,sign_type,quantity,unit)
    VALUES (r1,2,'M8 Totem',1,'no') RETURNING id INTO l2;

  -- Typed cost says 100000. The suppliers actually selected say 130000.
  INSERT INTO public.estimations (boq_revision_id,cost_total,wastage_pct,installation_cost,overhead_pct,created_by)
    VALUES (r1,100000,0,0,0,est) RETURNING id INTO e1;

  INSERT INTO public.vendors (name) VALUES ('M8 Supplier') RETURNING id INTO ven;
  INSERT INTO public.supplier_quotes (boq_revision_id,vendor_id,currency,created_by)
    VALUES (r1,ven,'SAR',est) RETURNING id INTO sq;
  INSERT INTO public.supplier_quote_lines (supplier_quote_id,boq_line_id,unit_cost,quantity,line_cost,is_selected,selected_by,selected_at)
    VALUES (sq,l1,80000,1,80000,TRUE,est,now());
  INSERT INTO public.supplier_quote_lines (supplier_quote_id,boq_line_id,unit_cost,quantity,line_cost,is_selected,selected_by,selected_at)
    VALUES (sq,l2,50000,1,50000,TRUE,est,now());
END $$;

CREATE TEMP TABLE m8 AS SELECT
  (SELECT e.id FROM public.estimations e JOIN public.boq_revisions r ON r.id=e.boq_revision_id
     JOIN public.boqs b ON b.id=r.boq_id WHERE b.title='M8 BOQ') AS e1;
GRANT SELECT ON m8 TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; v NUMERIC; e1 UUID; p1 UUID;
  est UUID; fin UUID; gm UUID; sm UUID; vw UUID; s1 UUID;
BEGIN
  SELECT t.e1 INTO e1 FROM m8 t;
  SELECT id INTO est FROM auth.users WHERE email='m8_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='m8_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='m8_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='m8_sm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='m8_vw@phc-sa.com';
  SELECT id INTO s1  FROM auth.users WHERE email='m8_s1@phc-sa.com';

  -- ===== the cost basis prefers what was actually committed =====
  SELECT public.estimation_cost_basis(e1) INTO v;
  RAISE NOTICE '% 1. the cost basis uses selected supplier costs, not the typed figure (expect 130000.00, got %)',
    CASE WHEN v = 130000.00 THEN 'PASS' ELSE 'FAIL' END, v;

  -- ===== margin is the database's number, not the caller's =====
  -- The arithmetic is verified as owner further down, because the owner is the
  -- only role that can read these columns back at all.
  PERFORM set_config('test.uid', est::text, TRUE);
  INSERT INTO public.internal_prices (estimation_id, proposed_price, status, proposed_by)
    VALUES (e1, 200000.00, 'draft', est) RETURNING id INTO p1;
  RAISE NOTICE 'PASS 2. a price is created without naming margin';

  -- 7A revoked SELECT on the margin columns but left writes governed
  -- table-wide, so a client CAN name them in an UPDATE. That is not the hole
  -- it looks like: the trigger recomputes the value regardless, which is
  -- verified as owner below. Both outcomes here are safe, so both pass — what
  -- must not happen is the written figure surviving.
  BEGIN
    UPDATE public.internal_prices SET margin_value = 999999, margin_percentage = 999 WHERE id=p1;
    RAISE NOTICE 'PASS 3. a client margin write is permitted at the privilege layer — the value is checked below';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 3. the client cannot write the margin columns at all';
  END;

  -- The client still cannot READ it back, which is 7A's isolation intact.
  BEGIN
    SELECT margin_percentage INTO v FROM public.internal_prices WHERE id=p1;
    RAISE NOTICE 'FAIL 4. the client read margin_percentage';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 4. …and still cannot read it back'; END;

  -- ===== the reconciliation is visible to those who may see cost =====
  SELECT typed_vs_supplier_pct INTO v FROM public.estimation_cost_reconciliation WHERE estimation_id=e1;
  RAISE NOTICE '% 6. the typed estimate is reported 30%% under the suppliers (expect 30.00, got %)',
    CASE WHEN v = 30.00 THEN 'PASS' ELSE 'FAIL' END, v;

  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.estimation_cost_reconciliation WHERE estimation_id=e1;
  RAISE NOTICE '% 7. sales_manager sees no cost reconciliation (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.estimation_cost_reconciliation WHERE estimation_id=e1;
  RAISE NOTICE '% 8. viewer sees none either (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the queue is a worklist, not a numbers leak =====
  PERFORM set_config('test.uid', est::text, TRUE);
  UPDATE public.internal_prices SET status='cost_complete'           WHERE id=p1;
  UPDATE public.internal_prices SET status='internal_price_proposed' WHERE id=p1;

  SELECT count(*) INTO n FROM public.commercial_review_queue
   WHERE internal_price_id=p1 AND awaiting='commercial';
  RAISE NOTICE '% 9. a proposed price is queued for commercial (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.commercial_review_queue WHERE internal_price_id=p1;
  RAISE NOTICE '% 10. the pipeline sees its own queue (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='commercial_review_queue'
     AND column_name IN ('margin_value','margin_percentage','proposed_price','cost_total','cost_basis');
  RAISE NOTICE '% 11. …and no money in it (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.commercial_review_queue WHERE internal_price_id=p1;
  RAISE NOTICE '% 12. viewer has no queue at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== margin stays invisible to the pipeline, exactly as 7A left it =====
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='internal_prices'
     AND grantee='authenticated' AND privilege_type='SELECT'
     AND column_name IN ('margin_value','margin_percentage');
  RAISE NOTICE '% 13. Phase 8 did not un-revoke the margin columns (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 8 margin integrity: done ---';
END $$;

RESET ROLE;

-- ===== the arithmetic itself, read as owner =====
DO $$
DECLARE e1 UUID; p1 UUID; v NUMERIC;
BEGIN
  SELECT t.e1 INTO e1 FROM m8 t;
  SELECT id INTO p1 FROM public.internal_prices
   WHERE estimation_id=e1 AND proposed_price=200000.00 ORDER BY created_at LIMIT 1;

  SELECT margin_value INTO v FROM public.internal_prices WHERE id=p1;
  RAISE NOTICE '% 30. margin_value is price minus the real cost basis (expect 70000.00, got %)',
    CASE WHEN v = 70000.00 THEN 'PASS' ELSE 'FAIL' END, v;

  -- 70000/200000 = 35%. On cost it would read 53.8%, which is the confusion
  -- this convention exists to prevent.
  SELECT margin_percentage INTO v FROM public.internal_prices WHERE id=p1;
  RAISE NOTICE '% 31. margin percent is on price, not on cost (expect 35.00, got %)',
    CASE WHEN v = 35.00 THEN 'PASS' ELSE 'FAIL' END, v;

  UPDATE public.internal_prices SET proposed_price = 260000.00 WHERE id=p1;
  SELECT margin_percentage INTO v FROM public.internal_prices WHERE id=p1;
  RAISE NOTICE '% 32. changing the price recomputes the margin (expect 50.00, got %)',
    CASE WHEN v = 50.00 THEN 'PASS' ELSE 'FAIL' END, v;

  -- Even the owner cannot make the margin lie: the trigger recomputes it.
  UPDATE public.internal_prices SET margin_value = 1, margin_percentage = 1 WHERE id=p1;
  SELECT margin_percentage INTO v FROM public.internal_prices WHERE id=p1;
  RAISE NOTICE '% 33. a hand-set margin is discarded even as owner (expect 50.00, got %)',
    CASE WHEN v = 50.00 THEN 'PASS' ELSE 'FAIL' END, v;

  UPDATE public.internal_prices SET proposed_price = 200000.00 WHERE id=p1;
  RAISE NOTICE '--- phase 8 arithmetic: done ---';
END $$;

-- ===== the floor =====
DO $$
DECLARE
  gm UUID; est UUID; sm UUID; e1 UUID; p2 UUID; n INT; v NUMERIC;
BEGIN
  SELECT id INTO gm  FROM auth.users WHERE email='m8_gm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='m8_est@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='m8_sm@phc-sa.com';
  SELECT t.e1 INTO e1 FROM m8 t;

  -- No policy yet: no gate.
  SELECT public.current_margin_floor() INTO v;
  RAISE NOTICE '% 40. with no policy there is no floor (expect NULL, got %)',
    CASE WHEN v IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(v::text,'NULL');

  PERFORM set_config('test.uid', gm::text, TRUE);
  INSERT INTO public.margin_policies (min_margin_pct, rationale, created_by)
    VALUES (30.00, 'Board floor', gm);
  SELECT public.current_margin_floor() INTO v;
  RAISE NOTICE '% 41. the floor is in force (expect 30.00, got %)',
    CASE WHEN v = 30.00 THEN 'PASS' ELSE 'FAIL' END, v;

  BEGIN
    INSERT INTO public.margin_policies (min_margin_pct, created_by) VALUES (10.00, gm);
    RAISE NOTICE 'FAIL 42. two floors are in force at once';
  EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS 42. two overlapping floors are refused'; END;

  BEGIN DELETE FROM public.margin_policies;
    RAISE NOTICE 'FAIL 43. a margin policy was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 43. margin policies refuse DELETE even as owner'; END;

  -- A price at 25% margin, below the 30% floor, with no justification.
  INSERT INTO public.internal_prices (estimation_id, proposed_price, status, proposed_by)
    VALUES (e1, 173333.34, 'draft', est) RETURNING id INTO p2;
  SELECT margin_percentage INTO v FROM public.internal_prices WHERE id=p2;
  RAISE NOTICE '% 44. the below-floor margin is computed (expect 25.00, got %)',
    CASE WHEN v = 25.00 THEN 'PASS' ELSE 'FAIL' END, v;

  UPDATE public.internal_prices SET status='cost_complete'           WHERE id=p2;
  UPDATE public.internal_prices SET status='internal_price_proposed' WHERE id=p2;
  PERFORM set_config('test.uid', sm::text, TRUE);
  UPDATE public.internal_prices SET status='commercial_review'       WHERE id=p2;
  PERFORM set_config('test.uid', (SELECT id FROM auth.users WHERE email='m8_fin@phc-sa.com')::text, TRUE);
  UPDATE public.internal_prices SET status='finance_review'          WHERE id=p2;

  BEGIN UPDATE public.internal_prices SET status='gm_pending' WHERE id=p2;
    RAISE NOTICE 'FAIL 45. a below-floor price reached the GM unexplained';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 45. a below-floor price cannot reach the GM without a justification'; END;

  UPDATE public.internal_prices SET below_floor_justification='Strategic entry into the Mataf account' WHERE id=p2;
  UPDATE public.internal_prices SET status='gm_pending' WHERE id=p2;
  SELECT count(*) INTO n FROM public.internal_prices WHERE id=p2 AND status='gm_pending';
  RAISE NOTICE '% 46. …and reaches the GM once it is explained (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 8 floor: done ---';
END $$;

-- ===== who may move the floor =====
SET ROLE rls_tester;
DO $$
DECLARE gm UUID; sm UUID; fin UUID; n INT;
BEGIN
  SELECT id INTO gm  FROM auth.users WHERE email='m8_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='m8_sm@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='m8_fin@phc-sa.com';

  PERFORM set_config('test.uid', sm::text, TRUE);
  INSERT INTO public.margin_policies (min_margin_pct, created_by, effective_from)
    VALUES (5, sm, now() + interval '10 years');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 47. sales_manager cannot set a margin floor (expect 0 rows, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'PASS 47. sales_manager cannot set a margin floor (refused)';
END $$;

DO $$
DECLARE fin UUID; vw UUID; n INT;
BEGIN
  SELECT id INTO fin FROM auth.users WHERE email='m8_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='m8_vw@phc-sa.com';

  PERFORM set_config('test.uid', fin::text, TRUE);
  SELECT count(*) INTO n FROM public.margin_policies;
  RAISE NOTICE '% 48. finance may read the floor (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.margin_policies;
  RAISE NOTICE '% 49. viewer may not (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.margin_policies;
  RAISE NOTICE '% 50. anon may not (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 8 floor authority: done ---';
END $$;
RESET ROLE;
