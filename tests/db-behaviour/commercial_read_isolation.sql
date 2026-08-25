-- =============================================================================
-- HOTFIX A + B — commercial cost isolation and BOQ history safety (adversarial).
--
-- The point of the column-privilege half is that it holds against a direct
-- PostgREST query, not just against the UI. `rls_tester` is a member of
-- `authenticated`, which is the role PostgREST uses, so "can this role name
-- unit_rate in a SELECT" is exactly the question these checks ask.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; bd UUID; ops UUID; est UUID; fin UUID; gm UUID;
  vw UUID; adm UUID; sus UUID;
  o1 UUID; o2 UUID; b1 UUID; b2 UUID; i1 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('ci_s1@phc-sa.com'),('ci_s2@phc-sa.com'),('ci_sm@phc-sa.com'),('ci_bd@phc-sa.com'),
    ('ci_ops@phc-sa.com'),('ci_est@phc-sa.com'),('ci_fin@phc-sa.com'),('ci_gm@phc-sa.com'),
    ('ci_vw@phc-sa.com'),('ci_adm@phc-sa.com'),('ci_sus@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='ci_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ci_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ci_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='ci_bd@phc-sa.com';
  SELECT id INTO ops FROM auth.users WHERE email='ci_ops@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='ci_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='ci_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='ci_gm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ci_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ci_adm@phc-sa.com';
  SELECT id INTO sus FROM auth.users WHERE email='ci_sus@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,bd,ops,est,fin,gm,vw,adm);
  UPDATE public.profiles SET status='suspended' WHERE id = sus;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),(bd,'bd_manager'),
    (ops,'sales_ops'),(est,'estimation_manager'),(fin,'finance_manager'),
    (gm,'general_manager'),(vw,'viewer'),(adm,'system_admin'),(sus,'estimation_manager');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('CI mine', s1)   RETURNING id INTO o1;
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('CI theirs', s2) RETURNING id INTO o2;

  INSERT INTO public.boqs (related_opportunity_id, title, status, source_confidence, currency, estimated_value, created_by)
    VALUES (o1,'CI BOQ mine','verified','high','SAR',400,bd) RETURNING id INTO b1;
  INSERT INTO public.boqs (related_opportunity_id, title, status, source_confidence, currency, estimated_value, created_by)
    VALUES (o2,'CI BOQ theirs','verified','high','SAR',900,bd) RETURNING id INTO b2;

  INSERT INTO public.boq_items (boq_id, sign_type, quantity, unit_rate, cost_estimate, selling_price, confidence)
    VALUES (b1,'Pylon',2,100,200,500,'high') RETURNING id INTO i1;
  INSERT INTO public.boq_items (boq_id, sign_type, quantity, unit_rate, cost_estimate, selling_price, confidence)
    VALUES (b2,'Totem',3,300,900,1500,'high');
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; txt TEXT;
  s1 UUID; s2 UUID; sm UUID; bd UUID; ops UUID; est UUID; fin UUID; gm UUID; vw UUID; adm UUID; sus UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='ci_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ci_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ci_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='ci_bd@phc-sa.com';
  SELECT id INTO ops FROM auth.users WHERE email='ci_ops@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='ci_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='ci_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='ci_gm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ci_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ci_adm@phc-sa.com';
  SELECT id INTO sus FROM auth.users WHERE email='ci_sus@phc-sa.com';

  -- ===== canary: without this, every denial below is vacuous =====
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM public.boqs WHERE title LIKE 'CI BOQ%';
  RAISE NOTICE '%  0. CANARY: a permitted role sees BOQ rows at all (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== row visibility =====
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.boqs WHERE title='CI BOQ mine';
  RAISE NOTICE '%  1. the deal owner sees their own BOQ (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boqs WHERE title='CI BOQ theirs';
  RAISE NOTICE '%  2. …and NOT another salesperson''s (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boq_items i JOIN public.boqs b ON b.id=i.boq_id WHERE b.title='CI BOQ theirs';
  RAISE NOTICE '%  3. nor its lines (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.boqs WHERE title LIKE 'CI BOQ%';
  RAISE NOTICE '%  4. viewer sees no BOQ at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.boqs WHERE title LIKE 'CI BOQ%';
  RAISE NOTICE '%  5. system_admin ALONE sees no BOQ (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM public.boqs WHERE title LIKE 'CI BOQ%';
  RAISE NOTICE '%  6. anon sees no BOQ (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the column privilege, tested the way PostgREST would hit it =====
  -- rls_tester IS authenticated, so this is the real question: can the role
  -- name the column in a SELECT at all?
  RESET ROLE;
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='boq_items' AND column_name='unit_rate' AND grantee='authenticated';
  RAISE NOTICE '%  7. `authenticated` holds NO privilege on boq_items.unit_rate (got %)',
    CASE WHEN txt IS NULL OR txt NOT LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='boq_items' AND column_name='cost_estimate' AND grantee='authenticated';
  RAISE NOTICE '%  8. …nor on cost_estimate (got %)',
    CASE WHEN txt IS NULL OR txt NOT LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='boqs' AND column_name='estimated_value' AND grantee='authenticated';
  RAISE NOTICE '%  9. …nor on boqs.estimated_value, the cost roll-up (got %)',
    CASE WHEN txt IS NULL OR txt NOT LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='boq_items' AND column_name='selling_price' AND grantee='authenticated';
  RAISE NOTICE '% 10. …but selling_price IS still granted, so sales keep their number (got %)',
    CASE WHEN txt LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SET ROLE rls_tester;

  -- The direct attempt. Even a role the row policy admits cannot name it.
  PERFORM set_config('test.uid', bd::text, false);
  BEGIN
    EXECUTE 'SELECT unit_rate FROM public.boq_items LIMIT 1';
    RAISE NOTICE 'FAIL 11. a direct SELECT of unit_rate succeeded for bd_manager';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 11. a direct SELECT of unit_rate is refused, even for a permitted row';
  END;
  BEGIN
    EXECUTE 'SELECT estimated_value FROM public.boqs LIMIT 1';
    RAISE NOTICE 'FAIL 12. a direct SELECT of boqs.estimated_value succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 12. a direct SELECT of boqs.estimated_value is refused';
  END;
  BEGIN
    EXECUTE 'SELECT selling_price FROM public.boq_items LIMIT 1';
    RAISE NOTICE 'PASS 13. selling_price is still selectable';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'FAIL 13. selling_price was revoked too — sales lost their number';
  END;

  -- ===== the cost view: who gets rows back =====
  PERFORM set_config('test.uid', est::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 14. estimation_manager reads cost through the view (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 15. finance_manager too (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', gm::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 16. general_manager too (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The pipeline roles: rows yes, cost no. This is the distinction the whole
  -- hotfix turns on.
  PERFORM set_config('test.uid', sm::text, false);
  SELECT count(*) INTO n FROM public.boqs WHERE title LIKE 'CI BOQ%';
  RAISE NOTICE '% 17. sales_manager sees the BOQs (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 18. …but NO cost through the view (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 19. bd_manager: no cost either (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', ops::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 20. sales_ops: no cost either (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The owner sees their BOQ and their selling price, never the floor.
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 21. the deal owner gets no cost (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boq_sales_totals WHERE selling_total = 500;
  RAISE NOTICE '% 22. …but does get the selling roll-up for their own BOQ (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boq_sales_totals;
  RAISE NOTICE '% 23. …and only their own (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the view must not become a back door =====
  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 24. viewer gets nothing from the cost view (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boq_sales_totals;
  RAISE NOTICE '% 25. …nor from the selling view (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 26. system_admin alone gets nothing from the cost view (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 27. anon gets nothing from the cost view (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== suspended beats role =====
  PERFORM set_config('test.uid', sus::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 28. a SUSPENDED estimation_manager gets no cost (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== multi-role is additive =====
  RESET ROLE;
  INSERT INTO public.user_roles (user_id, role) VALUES (vw,'finance_manager');
  SET ROLE rls_tester;
  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.boq_item_costs;
  RAISE NOTICE '% 29. viewer + finance_manager now reads cost — roles are a union (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== quotations: the row fix =====
  RESET ROLE;
  INSERT INTO public.quotations (quote_number, related_opportunity_id, owner_id, value, currency, version, status, created_by)
    SELECT 'CI-Q-1', id, (SELECT u.id FROM auth.users u WHERE u.email='ci_s1@phc-sa.com'), 500,'SAR',1,'draft',
           (SELECT u.id FROM auth.users u WHERE u.email='ci_bd@phc-sa.com')
      FROM public.opportunities WHERE project_name='CI mine';
  SET ROLE rls_tester;
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.quotations WHERE quote_number='CI-Q-1';
  RAISE NOTICE '% 30. the owner reads their quotation (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s2::text, false);
  SELECT count(*) INTO n FROM public.quotations WHERE quote_number='CI-Q-1';
  RAISE NOTICE '% 31. an unrelated salesperson does not (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.quotations WHERE quote_number='CI-Q-1';
  RAISE NOTICE '% 32. system_admin alone does not (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RESET ROLE;
  RAISE NOTICE '--- hotfix A: done ---';
END $$;

-- =============================================================================
-- HOTFIX B — BOQ history cannot be destroyed, by anyone, including the
-- service role that the Edge Function uses.
-- =============================================================================
DO $$
DECLARE n INT; b UUID; bd UUID;
BEGIN
  SELECT id INTO bd FROM auth.users WHERE email='ci_bd@phc-sa.com';
  SELECT id INTO b  FROM public.boqs WHERE title='CI BOQ mine';

  -- This block runs as the migration owner — i.e. with more power than the
  -- Edge Function's service role — so if the delete is refused here it is
  -- refused everywhere.
  BEGIN
    DELETE FROM public.boq_items WHERE boq_id=b;
    RAISE NOTICE 'FAIL 33. BOQ lines were deleted — the extractor could still destroy history';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 33. deleting BOQ lines is refused even as owner (trigger, not privilege)';
  END;

  SELECT count(*) INTO n FROM public.boq_items WHERE boq_id=b;
  RAISE NOTICE '% 34. the lines are still there (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN
    DELETE FROM public.boqs WHERE id=b;
    RAISE NOTICE 'FAIL 35. the BOQ header was deleted — cascade would take the lines with it';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 35. deleting a BOQ header is refused, so cascade cannot bypass check 33';
  END;

  -- Inserting and updating still work: this is a history guard, not a freeze.
  BEGIN
    INSERT INTO public.boq_items (boq_id, sign_type, quantity, unit_rate, cost_estimate, selling_price, confidence)
      VALUES (b,'Added later',1,10,10,20,'high');
    RAISE NOTICE 'PASS 36. adding a line still works';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL 36. adding a line was blocked too — the guard is too wide';
  END;

  -- The exact shape the deployed extractor sends.
  BEGIN
    INSERT INTO public.boq_items (boq_id, sign_type, unit, quantity, unit_rate) VALUES (b,'x','pcs',1,1);
    RAISE NOTICE 'FAIL 37. boq_items accepted a `unit` column it does not have';
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE 'PASS 37. the extractor''s `unit` insert is still rejected — hence staging, not canonical';
  END;

  -- Staging is where it should go, and `unit` is a real column there.
  DECLARE _e UUID;
  BEGIN
    INSERT INTO public.boq_extractions (related_opportunity_id, source_type, status, uploaded_by)
      SELECT related_opportunity_id,'file_import','pending_review',bd FROM public.boqs WHERE id=b
      RETURNING id INTO _e;
    INSERT INTO public.extracted_boq_items (extraction_id, item_description, quantity, unit, uncertain)
      VALUES (_e,'Pylon',2,'pcs',false);
    SELECT count(*) INTO n FROM public.extracted_boq_items WHERE extraction_id=_e;
    RAISE NOTICE '% 38. staging accepts the parsed line, `unit` and all (expect 1, got %)',
      CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  END;

  -- And staging is not canonical: nothing about it touched the BOQ.
  SELECT count(*) INTO n FROM public.boq_items WHERE boq_id=b;
  RAISE NOTICE '% 39. the BOQ is untouched by staging (expect 2 after check 36, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   WHERE c.relname IN ('boqs','boq_items') AND p.polcmd='d';
  RAISE NOTICE '% 40. no DELETE policy remains on either table (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- hotfix B: done ---';
END $$;
