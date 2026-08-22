-- =============================================================================
-- Historical sales staging — security and immutability (behavioural).
--
-- The archive carries amounts for 679 deals, so it is commercial data and the
-- D24 line applies: the sales team, estimation and finance; not viewer, not
-- system_admin alone. And the raw row is the source record — if it can be
-- edited, the archive stops agreeing with the spreadsheet people check it
-- against, which is the only thing that makes it trustworthy.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE sp UUID; sm UUID; est UUID; fin UUID; vw UUID; adm UUID; sus UUID; b UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('hs_sp@phc-sa.com'),('hs_sm@phc-sa.com'),('hs_est@phc-sa.com'),('hs_fin@phc-sa.com'),
    ('hs_vw@phc-sa.com'),('hs_adm@phc-sa.com'),('hs_sus@phc-sa.com');
  SELECT id INTO sp  FROM auth.users WHERE email='hs_sp@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='hs_sm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='hs_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='hs_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='hs_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='hs_adm@phc-sa.com';
  SELECT id INTO sus FROM auth.users WHERE email='hs_sus@phc-sa.com';
  UPDATE public.profiles SET status='active'    WHERE id IN (sp,sm,est,fin,vw,adm);
  UPDATE public.profiles SET status='suspended' WHERE id = sus;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (sp,'salesperson'),(sm,'sales_manager'),(est,'estimation_manager'),(fin,'finance_manager'),
    (vw,'viewer'),(adm,'system_admin'),(sus,'salesperson');

  INSERT INTO public.historical_sales_batches (source_file, source_sha256, source_rows)
    VALUES ('hs-test.csv','deadbeef',2) RETURNING id INTO b;
  -- Keys reproduce the spreadsheet's whitespace exactly, newline and typo included.
  INSERT INTO public.historical_sales_rows (batch_id,row_number,raw) VALUES
    (b,1,jsonb_build_object('SALES CODE','AH25081-RV.02','CLIENT COMPANY','Acme',
        'PROJECT NAME','Tower','AMOUNT','1,250,000','QUOTATION '||chr(10)||'STATUS','SUBMITTED',
        'SUBMISSION DATE','2/15/2026','DATE RECEIEVED','16/07/23','JIH / TENDER','JIH-DIRECT')),
    (b,2,jsonb_build_object('SALES CODE','BA','CLIENT COMPANY','No record',
        'PROJECT NAME','Placeholder','AMOUNT','RATES ONLY','QUOTATION '||chr(10)||'STATUS','DECLINE',
        'SUBMISSION DATE','No record','DATE RECEIEVED','','JIH / TENDER',''));
  PERFORM public.remap_historical_sales(b);
END $$;

SET ROLE rls_tester;

DO $$
DECLARE n INT; sp UUID; sm UUID; est UUID; fin UUID; vw UUID; adm UUID; sus UUID; m RECORD;
BEGIN
  SELECT id INTO sp  FROM auth.users WHERE email='hs_sp@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='hs_sm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='hs_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='hs_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='hs_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='hs_adm@phc-sa.com';
  SELECT id INTO sus FROM auth.users WHERE email='hs_sus@phc-sa.com';

  PERFORM set_config('test.uid', sm::text, false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  0. CANARY: a permitted role sees the archive (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', sp::text, false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  1. salesperson sees the whole archive — it is team-wide, not owner-scoped (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', est::text, false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  2. estimation_manager too (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  3. finance_manager too (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  4. viewer sees nothing (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  5. system_admin alone sees nothing (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sus::text, false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  6. a suspended salesperson sees nothing (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM public.historical_sales_search;
  RAISE NOTICE '%  7. anon sees nothing (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- read-only by construction
  PERFORM set_config('test.uid', sm::text, false);
  BEGIN
    INSERT INTO public.historical_sales_rows (batch_id,row_number,raw)
      SELECT batch_id, 99, '{}'::jsonb FROM public.historical_sales_rows LIMIT 1;
    RAISE NOTICE 'FAIL  8. a user inserted into the archive';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  8. users cannot insert into the archive';
  END;
  BEGIN
    UPDATE public.historical_sales_mapped SET client_name_raw='x';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '%  9. users cannot update derived rows (rows=%)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  9. users cannot update derived rows';
  END;

  RESET ROLE;
  -- The raw row resists even the owner, which is what "source record" means.
  BEGIN
    UPDATE public.historical_sales_rows SET raw='{}'::jsonb WHERE row_number=1;
    RAISE NOTICE 'FAIL 10. the raw source row was edited';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 10. the raw source row is immutable even as owner';
  END;
  BEGIN
    DELETE FROM public.historical_sales_rows WHERE row_number=1;
    RAISE NOTICE 'FAIL 11. the raw source row was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 11. the raw source row cannot be deleted';
  END;

  -- deterministic mapping
  SELECT * INTO m FROM public.historical_sales_mapped WHERE sales_code_raw='AH25081-RV.02';
  RAISE NOTICE '% 12. a revision code splits into base + number (got %/%)',
    CASE WHEN m.base_code='AH25081' AND m.revision_no=2 THEN 'PASS' ELSE 'FAIL' END, m.base_code, m.revision_no;
  RAISE NOTICE '% 13. the amount parses excluding VAT (expect 1250000, got %)',
    CASE WHEN m.amount_excl_vat=1250000 THEN 'PASS' ELSE 'FAIL' END, m.amount_excl_vat;
  RAISE NOTICE '% 14. a month-first date parses (2/15/2026 -> %)',
    CASE WHEN m.date_submitted=DATE '2026-02-15' THEN 'PASS' ELSE 'FAIL' END, m.date_submitted;
  RAISE NOTICE '% 15. a provable day-first date parses the other way (16/07/23 -> %)',
    CASE WHEN m.date_received=DATE '2023-07-16' THEN 'PASS' ELSE 'FAIL' END, m.date_received;
  RAISE NOTICE '% 16. the status maps through the rules table (SUBMITTED -> %)',
    CASE WHEN m.status_canonical='submitted' AND NOT m.status_needs_decision THEN 'PASS' ELSE 'FAIL' END, m.status_canonical;
  RAISE NOTICE '% 17. JIH-DIRECT normalises to jih (got %)',
    CASE WHEN m.route='jih' THEN 'PASS' ELSE 'FAIL' END, m.route;
  RAISE NOTICE '% 18. no fake user is invented — owner is a legacy label (user_id=% label=%)',
    CASE WHEN m.owner_user_id IS NULL AND m.owner_label IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    coalesce(m.owner_user_id::text,'null'), m.owner_label;

  SELECT * INTO m FROM public.historical_sales_mapped WHERE sales_code_raw='BA';
  RAISE NOTICE '% 19. a bare prefix is a placeholder, not a real code',
    CASE WHEN m.code_placeholder AND m.revision_no IS NULL THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 20. RATES ONLY does not become zero (amount=% unparsed=%)',
    CASE WHEN m.amount_excl_vat IS NULL AND m.amount_unparsed THEN 'PASS' ELSE 'FAIL' END,
    coalesce(m.amount_excl_vat::text,'null'), m.amount_unparsed;
  RAISE NOTICE '% 21. DECLINE has no enum home and is flagged, not guessed',
    CASE WHEN m.status_canonical IS NULL AND m.status_needs_decision THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 22. an unmatched client becomes a candidate, never a company',
    CASE WHEN NOT m.company_matched AND m.company_id IS NULL THEN 'PASS' ELSE 'FAIL' END;

  -- re-runnable
  DECLARE a INT; c INT;
  BEGIN
    SELECT count(*) INTO a FROM public.historical_sales_mapped;
    PERFORM public.remap_historical_sales((SELECT id FROM public.historical_sales_batches WHERE source_file='hs-test.csv'));
    SELECT count(*) INTO c FROM public.historical_sales_mapped;
    RAISE NOTICE '% 23. remapping is idempotent (% -> %)', CASE WHEN a=c THEN 'PASS' ELSE 'FAIL' END, a, c;
  END;
  SELECT count(*) INTO n FROM public.historical_sales_rows;
  RAISE NOTICE '% 24. remapping never touches the raw rows (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- nothing canonical was created
  -- Scoped to this suite's own codes: other suites create quotations, and an
  -- absolute count would assert something about them instead.
  SELECT count(*) INTO n FROM public.quotations WHERE quote_number IN ('AH25081-RV.02','BA');
  RAISE NOTICE '% 25. staging created no quotation from these records (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.companies WHERE name='Acme';
  RAISE NOTICE '% 26. …and no company either (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- historical sales staging: done ---';
END $$;
