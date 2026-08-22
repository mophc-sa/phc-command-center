-- =============================================================================
-- Phase 7A — the sequential pricing chain and final-price authority.
--
-- The chain is the product decision: commercial review before finance review,
-- finance before GM, no skipping. These checks exist because a skip is the kind
-- of thing that happens under deadline pressure and then becomes precedent.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  est UUID; fin UUID; gm UUID; sm UUID; bd UUID; ceo UUID; md UUID; adm UUID; vw UUID; dlg UUID; s1 UUID;
  o1 UUID; b1 UUID; r1 UUID; e1 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('w_est@phc-sa.com'),('w_fin@phc-sa.com'),('w_gm@phc-sa.com'),('w_sm@phc-sa.com'),
    ('w_bd@phc-sa.com'),('w_ceo@phc-sa.com'),('w_md@phc-sa.com'),('w_adm@phc-sa.com'),
    ('w_vw@phc-sa.com'),('w_dlg@phc-sa.com'),('w_s1@phc-sa.com');
  SELECT id INTO est FROM auth.users WHERE email='w_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='w_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='w_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='w_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='w_bd@phc-sa.com';
  SELECT id INTO ceo FROM auth.users WHERE email='w_ceo@phc-sa.com';
  SELECT id INTO md  FROM auth.users WHERE email='w_md@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='w_adm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='w_vw@phc-sa.com';
  SELECT id INTO dlg FROM auth.users WHERE email='w_dlg@phc-sa.com';
  SELECT id INTO s1  FROM auth.users WHERE email='w_s1@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (est,fin,gm,sm,bd,ceo,md,adm,vw,dlg,s1);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (est,'estimation_manager'),(fin,'finance_manager'),(gm,'general_manager'),
    (sm,'sales_manager'),(bd,'bd_manager'),(ceo,'ceo'),(md,'managing_director'),
    (adm,'system_admin'),(vw,'viewer'),(dlg,'salesperson'),(s1,'salesperson');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('W7 deal', s1) RETURNING id INTO o1;
  INSERT INTO public.boqs (related_opportunity_id,title,status,source_confidence,currency,created_by)
    VALUES (o1,'W7 BOQ','estimated_scope','medium','SAR',bd) RETURNING id INTO b1;
  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b1,1,'draft','manual',est) RETURNING id INTO r1;
  INSERT INTO public.estimations (boq_revision_id,cost_total,installation_cost,created_by)
    VALUES (r1,200,50,est) RETURNING id INTO e1;
END $$;

CREATE TEMP TABLE w7 AS SELECT
  (SELECT e.id FROM public.estimations e JOIN public.boq_revisions r ON r.id=e.boq_revision_id
     JOIN public.boqs b ON b.id=r.boq_id WHERE b.title='W7 BOQ') AS e1;
GRANT SELECT ON w7 TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; e1 UUID; p UUID;
  est UUID; fin UUID; gm UUID; sm UUID; bd UUID; ceo UUID; md UUID; adm UUID; vw UUID; dlg UUID;
  st public.internal_price_status;
BEGIN
  SELECT t.e1 INTO e1 FROM w7 t;
  SELECT id INTO est FROM auth.users WHERE email='w_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='w_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='w_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='w_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='w_bd@phc-sa.com';
  SELECT id INTO ceo FROM auth.users WHERE email='w_ceo@phc-sa.com';
  SELECT id INTO md  FROM auth.users WHERE email='w_md@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='w_adm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='w_vw@phc-sa.com';
  SELECT id INTO dlg FROM auth.users WHERE email='w_dlg@phc-sa.com';

  RAISE NOTICE '%  0. CANARY: the estimation fixture resolved (got %)',
    CASE WHEN e1 IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(e1::text,'NULL');

  -- ===== the authority predicate, by role =====
  RAISE NOTICE '%  1. GM may approve a final price',        CASE WHEN public.can_approve_final_price(gm)  THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  2. sales_manager may NOT',               CASE WHEN public.can_approve_final_price(sm)  = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  3. bd_manager may NOT',                  CASE WHEN public.can_approve_final_price(bd)  = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  4. CEO may NOT — visibility, not authority',      CASE WHEN public.can_approve_final_price(ceo) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  5. managing_director may NOT',           CASE WHEN public.can_approve_final_price(md)  = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  6. estimation may NOT',                  CASE WHEN public.can_approve_final_price(est) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  7. finance may NOT',                     CASE WHEN public.can_approve_final_price(fin) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  8. system_admin may NOT',                CASE WHEN public.can_approve_final_price(adm) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '%  9. viewer may NOT',                      CASE WHEN public.can_approve_final_price(vw)  = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 10. anon may NOT',                        CASE WHEN public.can_approve_final_price(NULL) = FALSE THEN 'PASS' ELSE 'FAIL' END;

  -- ===== the chain, walked legally =====
  PERFORM set_config('test.uid', est::text, false);
  INSERT INTO public.internal_prices (estimation_id, proposed_price, margin_value, margin_percentage)
    VALUES (e1, 500, 250, 50.00) RETURNING id INTO p;
  UPDATE public.internal_prices SET status='cost_complete' WHERE id=p;
  UPDATE public.internal_prices SET status='internal_price_proposed' WHERE id=p;
  PERFORM set_config('test.uid', bd::text, false);
  UPDATE public.internal_prices SET status='commercial_review' WHERE id=p;
  PERFORM set_config('test.uid', fin::text, false);
  UPDATE public.internal_prices SET status='finance_review' WHERE id=p;
  UPDATE public.internal_prices SET status='gm_pending' WHERE id=p;
  SELECT status INTO st FROM public.internal_prices WHERE id=p;
  RAISE NOTICE '% 11. the chain walks to gm_pending (got %)', CASE WHEN st='gm_pending' THEN 'PASS' ELSE 'FAIL' END, st;

  -- ===== the terminal state =====
  PERFORM set_config('test.uid', sm::text, false);
  BEGIN UPDATE public.internal_prices SET status='gm_approved' WHERE id=p;
    RAISE NOTICE 'FAIL 12. sales_manager approved a final price';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 12. sales_manager cannot approve a final price'; END;
  PERFORM set_config('test.uid', ceo::text, false);
  BEGIN UPDATE public.internal_prices SET status='gm_approved' WHERE id=p;
    RAISE NOTICE 'FAIL 13. CEO approved a final price';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 13. CEO cannot approve a final price'; END;
  -- system_admin is neither a cost holder nor a pipeline operator, so the RLS
  -- UPDATE policy filters the row away entirely: no exception, no change. That
  -- is secure but silent, so the assertion is on the state, not on a raise —
  -- the first version of this check expected an exception and reported FAIL
  -- while the price had in fact not moved.
  PERFORM set_config('test.uid', adm::text, false);
  UPDATE public.internal_prices SET status='gm_approved' WHERE id=p;
  -- Read back as someone who can see the row: system_admin cannot SELECT it
  -- either, so reading as them returns NULL and would prove nothing.
  PERFORM set_config('test.uid', gm::text, false);
  SELECT status INTO st FROM public.internal_prices WHERE id=p;
  RAISE NOTICE '% 14. system_admin cannot approve a final price (still %)',
    CASE WHEN st='gm_pending' THEN 'PASS' ELSE 'FAIL' END, st;
  PERFORM set_config('test.uid', gm::text, false);
  UPDATE public.internal_prices SET status='gm_approved' WHERE id=p;
  SELECT status INTO st FROM public.internal_prices WHERE id=p;
  RAISE NOTICE '% 15. the GM can (got %)', CASE WHEN st='gm_approved' THEN 'PASS' ELSE 'FAIL' END, st;
  SELECT count(*) INTO n FROM public.internal_prices WHERE id=p AND gm_decided_by=gm AND gm_decided_at IS NOT NULL;
  RAISE NOTICE '% 16. the decision is stamped from the session, not the payload (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== approved is final =====
  BEGIN UPDATE public.internal_prices SET status='returned', return_reason='changed my mind' WHERE id=p;
    RAISE NOTICE 'FAIL 17. an approved price was moved again';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 17. an approved price is final'; END;

  -- ===== skipping =====
  PERFORM set_config('test.uid', est::text, false);
  INSERT INTO public.internal_prices (estimation_id, proposed_price, margin_value, margin_percentage)
    VALUES (e1, 600, 300, 50.00) RETURNING id INTO p;
  BEGIN UPDATE public.internal_prices SET status='gm_approved' WHERE id=p;
    RAISE NOTICE 'FAIL 18. draft jumped straight to gm_approved';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN RAISE NOTICE 'PASS 18. draft cannot jump to gm_approved'; END;
  UPDATE public.internal_prices SET status='cost_complete' WHERE id=p;
  UPDATE public.internal_prices SET status='internal_price_proposed' WHERE id=p;
  BEGIN UPDATE public.internal_prices SET status='finance_review' WHERE id=p;
    RAISE NOTICE 'FAIL 19. commercial review was skipped';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN RAISE NOTICE 'PASS 19. finance review cannot precede commercial review'; END;
  PERFORM set_config('test.uid', bd::text, false);
  UPDATE public.internal_prices SET status='commercial_review' WHERE id=p;
  BEGIN UPDATE public.internal_prices SET status='gm_pending' WHERE id=p;
    RAISE NOTICE 'FAIL 20. finance review was skipped';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 20. GM cannot be reached without finance review'; END;

  -- ===== return, and re-entry =====
  PERFORM set_config('test.uid', gm::text, false);
  UPDATE public.internal_prices SET status='returned', return_reason='margin too thin' WHERE id=p;
  SELECT status INTO st FROM public.internal_prices WHERE id=p;
  RAISE NOTICE '% 21. a price can be returned from mid-chain (got %)', CASE WHEN st='returned' THEN 'PASS' ELSE 'FAIL' END, st;
  PERFORM set_config('test.uid', est::text, false);
  UPDATE public.internal_prices SET status='internal_price_proposed' WHERE id=p;
  RAISE NOTICE '% 22. …and re-enters the chain at proposed',
    CASE WHEN (SELECT status FROM public.internal_prices WHERE id=p)='internal_price_proposed' THEN 'PASS' ELSE 'FAIL' END;

  -- ===== a return needs a reason =====
  PERFORM set_config('test.uid', bd::text, false);
  UPDATE public.internal_prices SET status='commercial_review' WHERE id=p;
  PERFORM set_config('test.uid', gm::text, false);
  -- Clearing the reason in the same statement: this row already carried one
  -- from check 21, and leaving it would have let the CHECK pass on a stale
  -- value rather than on the return being made now.
  BEGIN UPDATE public.internal_prices SET status='returned', return_reason=NULL WHERE id=p;
    RAISE NOTICE 'FAIL 23. a price was returned with no reason';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 23. a return must carry a reason'; END;

  -- ===== margin is protected =====
  RESET ROLE;
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='internal_prices'
     AND column_name IN ('margin_value','margin_percentage')
     AND grantee='authenticated' AND privilege_type='SELECT';
  RAISE NOTICE '% 24. authenticated holds no SELECT on either margin column (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SET ROLE rls_tester;
  PERFORM set_config('test.uid', bd::text, false);
  BEGIN EXECUTE 'SELECT margin_value FROM public.internal_prices LIMIT 1';
    RAISE NOTICE 'FAIL 25. a direct SELECT of margin_value succeeded';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 25. a direct SELECT of margin_value is refused'; END;
  SELECT count(*) INTO n FROM public.internal_price_summary;
  RAISE NOTICE '% 26. bd_manager gets nothing from the price summary (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', est::text, false);
  SELECT count(*) INTO n FROM public.internal_price_summary;
  RAISE NOTICE '% 27. estimation does (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.internal_price_summary;
  RAISE NOTICE '% 28. viewer does not (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== pricing history is not deletable =====
  RESET ROLE;
  BEGIN DELETE FROM public.internal_prices WHERE id=p;
    RAISE NOTICE 'FAIL 29. a price row was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 29. pricing history refuses DELETE even as owner'; END;
  BEGIN DELETE FROM public.estimations WHERE id=e1;
    RAISE NOTICE 'FAIL 30. an estimation was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 30. estimations refuse DELETE'; END;

  -- ===== delegation =====
  DECLARE d UUID; est2 UUID;
  BEGIN
    SELECT id INTO est2 FROM auth.users WHERE email='w_est@phc-sa.com';
    BEGIN
      INSERT INTO public.price_authority_delegations (grantor_id,grantee_id,reason,expires_at)
        VALUES (est2, dlg, 'not the GM', now() + interval '1 day');
      RAISE NOTICE 'FAIL 31. a non-GM created a delegation';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 31. only the GM may delegate'; END;

    INSERT INTO public.price_authority_delegations (grantor_id,grantee_id,reason,starts_at,expires_at)
      VALUES (gm, dlg, 'GM on leave 1-5 Sept', now() - interval '1 hour', now() + interval '1 day')
      RETURNING id INTO d;
    RAISE NOTICE '% 32. an active delegate may approve',
      CASE WHEN public.can_approve_final_price(dlg) THEN 'PASS' ELSE 'FAIL' END;

    BEGIN
      INSERT INTO public.price_authority_delegations (grantor_id,grantee_id,reason,starts_at,expires_at)
        VALUES (gm, (SELECT id FROM auth.users WHERE email='w_s1@phc-sa.com'), 'overlapping', now(), now() + interval '2 days');
      RAISE NOTICE 'FAIL 33. two overlapping active delegations were allowed';
    EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS 33. overlapping active delegations are refused'; END;

    BEGIN UPDATE public.price_authority_delegations SET expires_at = now() + interval '30 days' WHERE id=d;
      RAISE NOTICE 'FAIL 34. a delegation period was edited';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 34. a delegation cannot be edited, only revoked'; END;

    UPDATE public.price_authority_delegations SET revoked_at=now(), revoked_by=gm WHERE id=d;
    RAISE NOTICE '% 35. a revoked delegate may no longer approve',
      CASE WHEN public.can_approve_final_price(dlg) = FALSE THEN 'PASS' ELSE 'FAIL' END;

    INSERT INTO public.price_authority_delegations (grantor_id,grantee_id,reason,starts_at,expires_at)
      VALUES (gm, dlg, 'expired window', now() - interval '10 days', now() - interval '9 days');
    RAISE NOTICE '% 36. an expired delegation grants nothing',
      CASE WHEN public.can_approve_final_price(dlg) = FALSE THEN 'PASS' ELSE 'FAIL' END;

    BEGIN DELETE FROM public.price_authority_delegations WHERE id=d;
      RAISE NOTICE 'FAIL 37. a delegation was deleted';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 37. delegations refuse DELETE'; END;
  END;

  RAISE NOTICE '--- phase 7A pricing workflow: done ---';
END $$;
