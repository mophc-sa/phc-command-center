-- =============================================================================
-- Phase 7B — supplier quotes, cost isolation and the selection rules.
--
-- Supplier unit cost is the floor beneath every other number in the system, so
-- the access half is tested the way PostgREST would hit it: rls_tester is a
-- member of `authenticated`, and "can this role name unit_cost in a SELECT" is
-- the question that matters.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; bd UUID; est UUID; fin UUID; gm UUID; sm UUID; ops UUID; vw UUID; adm UUID;
  o1 UUID; b1 UUID; r1 UUID; r2 UUID; l1 UUID; l2 UUID; v1 UUID; v2 UUID; q1 UUID; q2 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('sc_s1@phc-sa.com'),('sc_bd@phc-sa.com'),('sc_est@phc-sa.com'),('sc_fin@phc-sa.com'),
    ('sc_gm@phc-sa.com'),('sc_sm@phc-sa.com'),('sc_ops@phc-sa.com'),('sc_vw@phc-sa.com'),('sc_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='sc_s1@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='sc_bd@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='sc_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='sc_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='sc_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='sc_sm@phc-sa.com';
  SELECT id INTO ops FROM auth.users WHERE email='sc_ops@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='sc_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='sc_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,bd,est,fin,gm,sm,ops,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(bd,'bd_manager'),(est,'estimation_manager'),(fin,'finance_manager'),
    (gm,'general_manager'),(sm,'sales_manager'),(ops,'sales_ops'),(vw,'viewer'),(adm,'system_admin');

  INSERT INTO public.vendors (name, created_by) VALUES ('SC Signs Co.', bd) RETURNING id INTO v1;
  INSERT INTO public.vendors (name, created_by) VALUES ('SC Metals',    bd) RETURNING id INTO v2;

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('SC deal', s1) RETURNING id INTO o1;
  INSERT INTO public.boqs (related_opportunity_id,title,status,source_confidence,currency,created_by)
    VALUES (o1,'SC BOQ','estimated_scope','medium','SAR',bd) RETURNING id INTO b1;
  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b1,1,'draft','manual',est) RETURNING id INTO r1;
  INSERT INTO public.boq_lines (revision_id,sign_type,quantity,selling_price)
    VALUES (r1,'Pylon',2,500) RETURNING id INTO l1;

  -- A second revision, for the cross-revision check.
  UPDATE public.boq_revisions SET is_current=FALSE WHERE id=r1;
  INSERT INTO public.boq_revisions (boq_id,revision_number,status,source_type,created_by)
    VALUES (b1,2,'draft','manual',est) RETURNING id INTO r2;
  INSERT INTO public.boq_lines (revision_id,sign_type,quantity,selling_price)
    VALUES (r2,'Totem',1,900) RETURNING id INTO l2;

  INSERT INTO public.supplier_quotes (boq_revision_id,vendor_id,rfq_reference,status,currency,created_by)
    VALUES (r1,v1,'RFQ-1','responses_received','SAR',est) RETURNING id INTO q1;
  INSERT INTO public.supplier_quotes (boq_revision_id,vendor_id,rfq_reference,status,currency,created_by)
    VALUES (r1,v2,'RFQ-2','responses_received','SAR',est) RETURNING id INTO q2;
  INSERT INTO public.supplier_quote_lines (supplier_quote_id,boq_line_id,unit_cost,quantity,line_cost)
    VALUES (q1,l1,100,2,200);
  INSERT INTO public.supplier_quote_lines (supplier_quote_id,boq_line_id,unit_cost,quantity,line_cost)
    VALUES (q2,l1,140,2,280);
END $$;

CREATE TEMP TABLE sc AS SELECT
  (SELECT r.id FROM public.boq_revisions r JOIN public.boqs b ON b.id=r.boq_id
    WHERE b.title='SC BOQ' AND r.revision_number=1) AS r1,
  (SELECT r.id FROM public.boq_revisions r JOIN public.boqs b ON b.id=r.boq_id
    WHERE b.title='SC BOQ' AND r.revision_number=2) AS r2,
  -- Scoped to this suite's own BOQ: other suites share the database and also
  -- use sign_type 'Pylon', so an unscoped lookup returns more than one row.
  (SELECT l.id FROM public.boq_lines l JOIN public.boq_revisions r ON r.id=l.revision_id
     JOIN public.boqs b ON b.id=r.boq_id WHERE b.title='SC BOQ' AND l.sign_type='Pylon') AS l1,
  (SELECT l.id FROM public.boq_lines l JOIN public.boq_revisions r ON r.id=l.revision_id
     JOIN public.boqs b ON b.id=r.boq_id WHERE b.title='SC BOQ' AND l.sign_type='Totem') AS l2,
  (SELECT q.id FROM public.supplier_quotes q WHERE q.rfq_reference='RFQ-1') AS q1,
  (SELECT q.id FROM public.supplier_quotes q WHERE q.rfq_reference='RFQ-2') AS q2,
  (SELECT v.id FROM public.vendors v WHERE v.name='SC Signs Co.') AS v1;
GRANT SELECT ON sc TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; txt TEXT;
  s1 UUID; bd UUID; est UUID; fin UUID; gm UUID; sm UUID; ops UUID; vw UUID; adm UUID;
  r1 UUID; r2 UUID; l1 UUID; l2 UUID; q1 UUID; q2 UUID; v1 UUID; q3 UUID;
BEGIN
  SELECT t.r1,t.r2,t.l1,t.l2,t.q1,t.q2,t.v1 INTO r1,r2,l1,l2,q1,q2,v1 FROM sc t;
  SELECT id INTO s1  FROM auth.users WHERE email='sc_s1@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='sc_bd@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='sc_est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='sc_fin@phc-sa.com';
  SELECT id INTO gm  FROM auth.users WHERE email='sc_gm@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='sc_sm@phc-sa.com';
  SELECT id INTO ops FROM auth.users WHERE email='sc_ops@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='sc_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='sc_adm@phc-sa.com';

  PERFORM set_config('test.uid', est::text, false);
  SELECT count(*) INTO n FROM public.supplier_quotes;
  RAISE NOTICE '%  0. CANARY: estimation sees the quotes (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== who reads supplier cost =====
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  1. estimation reads supplier cost (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  2. finance reads it (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', gm::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  3. GM reads it (expect 2, got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', sm::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  4. sales_manager reads NO supplier cost (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  5. bd_manager reads none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', ops::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  6. sales_ops reads none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  7. the deal owner reads none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  8. viewer reads none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '%  9. system_admin alone reads none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM public.supplier_quote_costs;
  RAISE NOTICE '% 10. anon reads none (expect 0, got %)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- the quote rows themselves, not just the view
  PERFORM set_config('test.uid', sm::text, false);
  SELECT count(*) INTO n FROM public.supplier_quotes;
  RAISE NOTICE '% 11. sales_manager cannot even see that a quote exists (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the column privilege, as PostgREST would hit it =====
  RESET ROLE;
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='supplier_quote_lines' AND column_name='unit_cost' AND grantee='authenticated';
  RAISE NOTICE '% 12. authenticated holds no SELECT on unit_cost (got %)',
    CASE WHEN txt IS NULL OR txt NOT LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SELECT string_agg(privilege_type,',') INTO txt FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='supplier_quote_lines' AND column_name='line_cost' AND grantee='authenticated';
  RAISE NOTICE '% 13. …nor on line_cost (got %)',
    CASE WHEN txt IS NULL OR txt NOT LIKE '%SELECT%' THEN 'PASS' ELSE 'FAIL' END, coalesce(txt,'none');
  SET ROLE rls_tester;
  PERFORM set_config('test.uid', est::text, false);
  BEGIN EXECUTE 'SELECT unit_cost FROM public.supplier_quote_lines LIMIT 1';
    RAISE NOTICE 'FAIL 14. a direct SELECT of unit_cost succeeded';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 14. a direct SELECT of unit_cost is refused, even for estimation'; END;

  -- ===== comparison =====
  SELECT count(*) INTO n FROM public.supplier_comparison WHERE boq_line_id=l1;
  RAISE NOTICE '% 15. comparison groups both suppliers on one line (expect 1 row, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT quotes_received INTO n FROM public.supplier_comparison WHERE boq_line_id=l1;
  RAISE NOTICE '% 16. …and counts two quotes (got %)', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT spread::INT INTO n FROM public.supplier_comparison WHERE boq_line_id=l1;
  RAISE NOTICE '% 17. …with the spread computed (expect 40, got %)', CASE WHEN n=40 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', sm::text, false);
  SELECT count(*) INTO n FROM public.supplier_comparison;
  RAISE NOTICE '% 18. sales_manager gets nothing from the comparison (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== selection =====
  PERFORM set_config('test.uid', est::text, false);
  UPDATE public.supplier_quote_lines SET is_selected=TRUE WHERE supplier_quote_id=q1 AND boq_line_id=l1;
  SELECT count(*) INTO n FROM public.supplier_quote_lines WHERE boq_line_id=l1 AND is_selected;
  RAISE NOTICE '% 19. estimation selects a supplier line (expect 1, got %)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.supplier_quote_lines
   WHERE boq_line_id=l1 AND is_selected AND selected_by=est AND selected_at IS NOT NULL;
  RAISE NOTICE '% 20. …stamped from the session, not the payload (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  BEGIN
    UPDATE public.supplier_quote_lines SET is_selected=TRUE WHERE supplier_quote_id=q2 AND boq_line_id=l1;
    RAISE NOTICE 'FAIL 21. two suppliers were selected for one BOQ line';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 21. exactly one selected supplier per BOQ line'; END;

  -- ===== supersede, and selecting from a superseded quote =====
  UPDATE public.supplier_quotes SET is_current=FALSE, status='superseded' WHERE id=q2;
  INSERT INTO public.supplier_quotes (boq_revision_id,vendor_id,rfq_reference,status,currency,revision_number,supersedes_id,created_by)
    VALUES (r1,(SELECT vendor_id FROM public.supplier_quotes WHERE id=q2),'RFQ-2b','responses_received','SAR',2,q2,est)
    RETURNING id INTO q3;
  SELECT count(*) INTO n FROM public.supplier_quotes WHERE boq_revision_id=r1;
  RAISE NOTICE '% 22. superseding keeps both quote rows (expect 3, got %)', CASE WHEN n=3 THEN 'PASS' ELSE 'FAIL' END, n;
  BEGIN
    INSERT INTO public.supplier_quote_lines (supplier_quote_id,boq_line_id,unit_cost,quantity,line_cost,is_selected)
      VALUES (q2,l1,140,2,280,TRUE);
    RAISE NOTICE 'FAIL 23. a line on a superseded quote was selected';
  EXCEPTION WHEN check_violation OR unique_violation THEN RAISE NOTICE 'PASS 23. a superseded quote cannot be selected from'; END;

  -- ===== one current quote per vendor per revision =====
  BEGIN
    INSERT INTO public.supplier_quotes (boq_revision_id,vendor_id,rfq_reference,status,currency,created_by)
      VALUES (r1,v1,'RFQ-dupe','draft','SAR',est);
    RAISE NOTICE 'FAIL 24. a second current quote for the same vendor was allowed';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS 24. one current quote per vendor per revision'; END;

  -- ===== a line must price its own revision =====
  BEGIN
    INSERT INTO public.supplier_quote_lines (supplier_quote_id,boq_line_id,unit_cost,quantity,line_cost)
      VALUES (q1,l2,50,1,50);
    RAISE NOTICE 'FAIL 25. a quote priced a BOQ line from another revision';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 25. a quote line must belong to the quote''s revision'; END;

  -- ===== currency must match the BOQ =====
  BEGIN
    INSERT INTO public.supplier_quotes (boq_revision_id,vendor_id,rfq_reference,status,currency,created_by)
      VALUES (r2,v1,'RFQ-usd','draft','USD',est);
    RAISE NOTICE 'FAIL 26. a USD quote was accepted against a SAR BOQ';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 26. a currency mismatch is refused rather than converted'; END;

  -- ===== a cancellation needs a reason =====
  BEGIN UPDATE public.supplier_quotes SET status='cancelled' WHERE id=q3;
    RAISE NOTICE 'FAIL 27. a quote was cancelled with no reason';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS 27. a cancellation must carry a reason'; END;

  -- ===== nothing is deletable =====
  RESET ROLE;
  BEGIN DELETE FROM public.supplier_quote_lines WHERE supplier_quote_id=q1;
    RAISE NOTICE 'FAIL 28. supplier quote lines were deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 28. supplier lines refuse DELETE even as owner'; END;
  BEGIN DELETE FROM public.supplier_quotes WHERE id=q1;
    RAISE NOTICE 'FAIL 29. a supplier quote was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 29. supplier quotes refuse DELETE'; END;

  -- A quote cannot freeze itself — that is the revision's decision, and this
  -- runs while the revision is still open so the refusal is about the stamp,
  -- not about the revision being frozen already.
  BEGIN UPDATE public.supplier_quotes SET frozen_at=now(), frozen_by=est WHERE id=q1;
    RAISE NOTICE 'FAIL 29b. a supplier quote was frozen by hand';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 29b. frozen_at cannot be set on the quote itself'; END;

  -- ===== freezing the BOQ revision freezes the costing =====
  UPDATE public.boq_revisions SET frozen_at=now(), frozen_by=est WHERE id=r1;

  -- The stamp propagated, and it agrees with the revision.
  SELECT count(*) INTO n FROM public.supplier_quotes q JOIN public.boq_revisions r ON r.id=q.boq_revision_id
   WHERE q.boq_revision_id=r1 AND q.frozen_at=r.frozen_at AND q.frozen_by=r.frozen_by;
  RAISE NOTICE '% 29c. freezing the revision stamps its quotes with the same actor and time (got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.supplier_quotes WHERE boq_revision_id=r1 AND status='frozen';
  RAISE NOTICE '% 29d. the frozen status is reachable (got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN UPDATE public.supplier_quotes SET notes='after freeze' WHERE id=q1;
    RAISE NOTICE 'FAIL 30. a supplier quote changed after its revision froze';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 30. a frozen revision freezes its supplier quotes'; END;
  BEGIN UPDATE public.supplier_quote_lines SET unit_cost=1 WHERE supplier_quote_id=q1;
    RAISE NOTICE 'FAIL 31. a supplier line changed after its revision froze';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 31. …and its supplier lines'; END;
  BEGIN UPDATE public.supplier_quote_lines SET is_selected=FALSE WHERE supplier_quote_id=q1 AND boq_line_id=l1;
    RAISE NOTICE 'FAIL 32. the selection changed after freeze';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 32. the selection is immutable once the revision freezes'; END;

  -- ===== vendor duplicate DETECTION — surfaced, never blocked =====
  -- Both must be accepted. Suffix stripping collapses "Trading" and "Group"
  -- too, so refusing here would block genuinely different firms with no way
  -- around it.
  BEGIN
    INSERT INTO public.vendors (name) VALUES ('AL-RAJHI CO.');
    INSERT INTO public.vendors (name) VALUES ('Al Rajhi Company');
    RAISE NOTICE 'PASS 33. a near-duplicate vendor name is accepted, not refused';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'FAIL 33. a legitimate vendor was blocked as a duplicate'; END;
  SELECT count(*) INTO n FROM public.vendor_duplicate_candidates
   WHERE name_normalized = public.normalize_vendor_name('Al Rajhi');
  RAISE NOTICE '% 33b. …and reported as a duplicate candidate instead (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT vendor_count INTO n FROM public.vendor_duplicate_candidates
   WHERE name_normalized = public.normalize_vendor_name('Al Rajhi');
  RAISE NOTICE '% 33c. the candidate row names both spellings (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='public' AND indexname='vendors_name_normalized_unique';
  RAISE NOTICE '% 33d. no unique index enforces vendor name normalisation (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.vendors WHERE name_normalized = public.normalize_vendor_name('SC  Signs   Co');
  RAISE NOTICE '% 34. normalisation is insensitive to case, punctuation and spacing (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== vendors_private untouched =====
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='vendors_private';
  RAISE NOTICE '% 35. vendors_private is unchanged (expect 5 columns, got %)',
    CASE WHEN n=5 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 7B supplier costing: done ---';
END $$;
