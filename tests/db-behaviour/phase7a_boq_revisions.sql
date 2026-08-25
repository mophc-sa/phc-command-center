-- =============================================================================
-- Phase 7A — BOQ revisions, lines, cost isolation, and the Phase 5 rule.
--
-- The cost half is tested the way PostgREST would hit it: rls_tester is a
-- member of `authenticated`, so "can this role name unit_price in a SELECT" is
-- exactly the question asked.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; bd UUID; est UUID; fin UUID; gm UUID; vw UUID; adm UUID; sm UUID;
  o1 UUID; p1 UUID; b1 UUID; r1 UUID; r2 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('r_s1@phc-sa.com'),('r_bd@phc-sa.com'),('r_est@phc-sa.com'),('r_fin@phc-sa.com'),
    ('r_gm@phc-sa.com'),('r_vw@phc-sa.com'),('r_adm@phc-sa.com'),('r_sm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='r_s1@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='r_bd@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='r_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='r_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='r_gm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='r_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='r_adm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='r_sm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,bd,est,fin,gm,vw,adm,sm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(bd,'bd_manager'),(est,'estimation_manager'),(fin,'finance_manager'),
    (gm,'general_manager'),(vw,'viewer'),(adm,'system_admin'),(sm,'sales_manager');

  INSERT INTO public.projects (name) VALUES ('R7 site') RETURNING id INTO p1;
  INSERT INTO public.opportunities (project_name, owner_id, project_id) VALUES ('R7 deal', s1, p1) RETURNING id INTO o1;
  INSERT INTO public.boqs (related_opportunity_id,title,status,source_confidence,currency,created_by)
    VALUES (o1,'R7 BOQ','estimated_scope','medium','SAR',bd) RETURNING id INTO b1;

  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b1,1,'draft','manual',est) RETURNING id INTO r1;
  INSERT INTO public.boq_lines (revision_id,sign_type,quantity,unit_price,line_total,selling_price)
    VALUES (r1,'Pylon',2,100,200,500);
END $$;

-- Resolved as owner: after SET ROLE, boqs RLS hides these rows until a
-- test.uid is set, so a lookup here would silently return NULL and every
-- assertion downstream would pass or fail for the wrong reason. The canary
-- caught exactly that on the first run.
CREATE TEMP TABLE p7a AS SELECT
  (SELECT id FROM public.boqs        WHERE title='R7 BOQ')  AS b1,
  (SELECT id FROM public.projects    WHERE name='R7 site')  AS p1,
  (SELECT r.id FROM public.boq_revisions r JOIN public.boqs b ON b.id=r.boq_id
    WHERE b.title='R7 BOQ' AND r.revision_number=1)         AS r1;
GRANT SELECT ON p7a TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; txt TEXT; s1 UUID; bd UUID; est UUID; fin UUID; gm UUID; vw UUID; adm UUID; sm UUID;
  r1 UUID; b1 UUID; p1 UUID; r2 UUID;
BEGIN
  SELECT id INTO s1 FROM auth.users WHERE email='r_s1@phc-sa.com';
  SELECT id INTO bd FROM auth.users WHERE email='r_bd@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='r_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='r_fin@phc-sa.com';
  SELECT id INTO gm FROM auth.users WHERE email='r_gm@phc-sa.com';
  SELECT id INTO vw FROM auth.users WHERE email='r_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='r_adm@phc-sa.com';
  SELECT id INTO sm FROM auth.users WHERE email='r_sm@phc-sa.com';
  SELECT t.b1, t.p1, t.r1 INTO b1, p1, r1 FROM p7a t;

  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM public.boq_revisions WHERE boq_id=b1;
  RAISE NOTICE '%  0. CANARY: a permitted role sees the revision (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== row visibility =====
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.boq_revisions WHERE boq_id=b1;
  RAISE NOTICE '%  1. the deal owner sees their revision (expect 1, got %)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.boq_revisions;
  RAISE NOTICE '%  2. viewer sees none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.boq_revisions;
  RAISE NOTICE '%  3. system_admin alone sees none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM public.boq_revisions;
  RAISE NOTICE '%  4. anon sees none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== cost columns: the privilege, not the UI =====
  RESET ROLE;
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='boq_lines' AND column_name='unit_price' AND grantee='authenticated';
  RAISE NOTICE '%  5. authenticated holds no SELECT on boq_lines.unit_price (got %)',
    CASE WHEN txt IS NULL OR txt NOT LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='boq_lines' AND column_name='line_total' AND grantee='authenticated';
  RAISE NOTICE '%  6. …nor on line_total (got %)',
    CASE WHEN txt IS NULL OR txt NOT LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='boq_lines' AND column_name='selling_price' AND grantee='authenticated';
  RAISE NOTICE '%  7. …but selling_price IS granted (got %)',
    CASE WHEN txt LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SET ROLE rls_tester;

  PERFORM set_config('test.uid', bd::text, false);
  BEGIN EXECUTE 'SELECT unit_price FROM public.boq_lines LIMIT 1';
    RAISE NOTICE 'FAIL  8. a direct SELECT of unit_price succeeded';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  8. a direct SELECT of unit_price is refused'; END;
  BEGIN EXECUTE 'SELECT selling_price FROM public.boq_lines LIMIT 1';
    RAISE NOTICE 'PASS  9. selling_price is still selectable';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'FAIL  9. selling_price was revoked too'; END;

  -- ===== the cost view, by role =====
  PERFORM set_config('test.uid', est::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 10. estimation reads cost (expect 1, got %)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 11. finance reads cost (expect 1, got %)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', gm::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 12. GM reads cost (expect 1, got %)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 13. sales_manager reads NO cost (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 14. bd_manager reads NO cost (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 15. the deal owner reads NO cost (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boq_revision_sales_totals WHERE selling_total=500;
  RAISE NOTICE '% 16. …but does get the selling roll-up (expect 1, got %)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 17. viewer gets nothing from the cost view (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.boq_line_costs;
  RAISE NOTICE '% 18. system_admin alone gets nothing (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the sales view must never carry margin =====
  RESET ROLE;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='boq_revision_sales_totals'
     AND column_name IN ('unit_price','line_total','margin_value','margin_pct');
  RAISE NOTICE '% 19. the sales roll-up exposes no cost or margin column (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== freezing =====
  UPDATE public.boq_revisions SET frozen_at=now(), frozen_by=(SELECT id FROM auth.users WHERE email='r_est@phc-sa.com') WHERE id=r1;
  BEGIN UPDATE public.boq_revisions SET status='verified' WHERE id=r1;
    RAISE NOTICE 'FAIL 20. a frozen revision accepted a status change';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 20. a frozen revision refuses a status change'; END;
  BEGIN UPDATE public.boq_revisions SET frozen_at=NULL, frozen_by=NULL WHERE id=r1;
    RAISE NOTICE 'FAIL 21. a frozen revision was unfrozen';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'PASS 21. unfreezing is refused'; END;
  BEGIN UPDATE public.boq_lines SET quantity=99 WHERE revision_id=r1;
    RAISE NOTICE 'FAIL 22. a line under a frozen revision was edited';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 22. lines under a frozen revision refuse UPDATE'; END;
  BEGIN DELETE FROM public.boq_lines WHERE revision_id=r1;
    RAISE NOTICE 'FAIL 23. a line under a frozen revision was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 23. lines under a frozen revision refuse DELETE'; END;
  BEGIN DELETE FROM public.boq_revisions WHERE id=r1;
    RAISE NOTICE 'FAIL 24. a revision was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 24. revisions refuse DELETE even as owner'; END;

  -- ===== supersede keeps both =====
  -- Un-current the old one FIRST: the partial unique index allows exactly one
  -- current revision per BOQ, so the reverse order is a constraint violation
  -- rather than a race. That ordering is the intended workflow, not a quirk.
  UPDATE public.boq_revisions SET is_current=FALSE WHERE id=r1;
  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b1,2,'draft','ai_extraction',est) RETURNING id INTO r2;
  UPDATE public.boq_revisions SET superseded_by=r2, superseded_at=now() WHERE id=r1;
  SELECT count(*) INTO n FROM public.boq_revisions WHERE boq_id=b1;
  RAISE NOTICE '% 25. superseding keeps both revisions (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.boq_revisions WHERE boq_id=b1 AND is_current;
  RAISE NOTICE '% 26. exactly one current revision (expect 1, got %)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  BEGIN
    INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by,is_current)
      VALUES (b1,3,'draft','manual',est,TRUE);
    RAISE NOTICE 'FAIL 27. a second current revision was allowed';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 27. a second current revision is refused'; END;
  BEGIN
    INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by,is_current)
      VALUES (b1,1,'draft','manual',est,FALSE);
    RAISE NOTICE 'FAIL 28. a duplicate revision_number was allowed';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 28. revision numbers are unique per BOQ'; END;

  -- ===== source_type audit trail =====
  SELECT count(DISTINCT source_type) INTO n FROM public.boq_revisions WHERE boq_id=b1;
  RAISE NOTICE '% 29. source_type records how each revision arose (expect 2 kinds, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== Phase 5 rule: extended, not replaced =====
  RAISE NOTICE '% 30. a DRAFT frozen-less revision does not qualify a project',
    CASE WHEN public.project_has_valid_boq(p1) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  UPDATE public.boq_revisions SET status='verified' WHERE id=r2;
  RAISE NOTICE '% 31. …nor does an UNFROZEN verified revision',
    CASE WHEN public.project_has_valid_boq(p1) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  UPDATE public.boq_revisions SET frozen_at=now(), frozen_by=est WHERE id=r2;
  RAISE NOTICE '% 32. a FROZEN verified revision does qualify',
    CASE WHEN public.project_has_valid_boq(p1) THEN 'PASS' ELSE 'FAIL' END;
  UPDATE public.boqs SET status='verified' WHERE id=b1;
  RAISE NOTICE '% 33. the legacy boqs.status path still qualifies (Phase 5 unchanged)',
    CASE WHEN public.project_has_valid_boq(p1) THEN 'PASS' ELSE 'FAIL' END;

  -- ===== legacy tables preserved =====
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('boqs','boq_items','quotations');
  RAISE NOTICE '% 34. boqs, boq_items and quotations all still exist (expect 3, got %)',
    CASE WHEN n=3 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 7A BOQ revisions: done ---';
END $$;
