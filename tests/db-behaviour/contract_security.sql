-- =============================================================================
-- SECURITY HOTFIX — contract read AND write governance (behavioural, adversarial).
--
-- The old read policy was `USING (true)`, so every read check here would have
-- returned every row. The old write policies admitted system_admin, so every
-- write check would have succeeded. Both are written to fail loudly if either
-- comes back.
--
-- Counts are scoped to this suite's own two fixture contracts. Other suites
-- share this database and create contracts of their own — the Phase 6
-- attachment suite does — so an absolute `count(*) FROM contracts` would assert
-- something about them rather than about this policy.
--
-- Runs as `rls_tester`, which the harness now grants membership in
-- `authenticated`. That grant is load-bearing here: this policy is scoped
-- `TO authenticated`, so a tester outside the role would match no policy, see
-- zero rows, and pass every denial check for entirely the wrong reason — and
-- would keep passing with the policy deleted.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; bd UUID; fin UUID; est UUID;
  vw UUID; adm UUID; sus UUID; resp UUID; vwo UUID; abd UUID; gm UUID;
  o1 UUID; o2 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('c_s1@phc-sa.com'),('c_s2@phc-sa.com'),('c_sm@phc-sa.com'),('c_bd@phc-sa.com'),
    ('c_fin@phc-sa.com'),('c_est@phc-sa.com'),('c_vw@phc-sa.com'),('c_adm@phc-sa.com'),
    ('c_sus@phc-sa.com'),('c_resp@phc-sa.com'),('c_vwonly@phc-sa.com'),
    ('c_admbd@phc-sa.com'),('c_gm@phc-sa.com');
  SELECT id INTO s1   FROM auth.users WHERE email='c_s1@phc-sa.com';
  SELECT id INTO s2   FROM auth.users WHERE email='c_s2@phc-sa.com';
  SELECT id INTO sm   FROM auth.users WHERE email='c_sm@phc-sa.com';
  SELECT id INTO bd   FROM auth.users WHERE email='c_bd@phc-sa.com';
  SELECT id INTO fin  FROM auth.users WHERE email='c_fin@phc-sa.com';
  SELECT id INTO est  FROM auth.users WHERE email='c_est@phc-sa.com';
  SELECT id INTO vw   FROM auth.users WHERE email='c_vw@phc-sa.com';
  SELECT id INTO adm  FROM auth.users WHERE email='c_adm@phc-sa.com';
  SELECT id INTO sus  FROM auth.users WHERE email='c_sus@phc-sa.com';
  SELECT id INTO resp FROM auth.users WHERE email='c_resp@phc-sa.com';
  SELECT id INTO vwo  FROM auth.users WHERE email='c_vwonly@phc-sa.com';
  SELECT id INTO abd  FROM auth.users WHERE email='c_admbd@phc-sa.com';
  SELECT id INTO gm   FROM auth.users WHERE email='c_gm@phc-sa.com';

  UPDATE public.profiles SET status='active'
   WHERE id IN (s1,s2,sm,bd,fin,est,vw,adm,resp,vwo,abd,gm);
  -- Holds sales_manager, which would otherwise pass. Suspension must win.
  UPDATE public.profiles SET status='suspended' WHERE id = sus;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'), (s2,'salesperson'), (sm,'sales_manager'), (bd,'bd_manager'),
    (fin,'finance_manager'), (est,'estimation_manager'), (vw,'viewer'),
    (adm,'system_admin'), (sus,'sales_manager'), (resp,'salesperson'),
    -- Multi-role: a viewer who is ALSO sales_ops. If roles were resolved by
    -- precedence rather than union, the read-only role would cancel the other.
    (vw,'sales_ops'),
    -- …and a viewer holding nothing else, so the denial below is about the
    -- viewer role rather than about a user who happens not to exist.
    (vwo,'viewer'),
    -- system_admin PLUS a real business role. Must behave exactly like the
    -- business role — roles are a union, so holding system_admin neither adds
    -- nor subtracts.
    (abd,'system_admin'), (abd,'bd_manager'),
    (gm,'general_manager');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('C deal mine', s1)   RETURNING id INTO o1;
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('C deal theirs', s2) RETURNING id INTO o2;

  INSERT INTO public.contracts (opportunity_id, contract_name, contract_value, created_by, responsible_user_id)
    VALUES (o1, 'C mine',   500000, bd, resp);
  INSERT INTO public.contracts (opportunity_id, contract_name, contract_value, created_by, responsible_user_id)
    VALUES (o2, 'C theirs', 900000, bd, NULL);
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; s1 UUID; s2 UUID; sm UUID; bd UUID; fin UUID; est UUID;
  vw UUID; adm UUID; sus UUID; resp UUID; vwo UUID; abd UUID; gm UUID;
  o1 UUID; ok BOOLEAN;
BEGIN
  SELECT id INTO s1   FROM auth.users WHERE email='c_s1@phc-sa.com';
  SELECT id INTO s2   FROM auth.users WHERE email='c_s2@phc-sa.com';
  SELECT id INTO sm   FROM auth.users WHERE email='c_sm@phc-sa.com';
  SELECT id INTO bd   FROM auth.users WHERE email='c_bd@phc-sa.com';
  SELECT id INTO fin  FROM auth.users WHERE email='c_fin@phc-sa.com';
  SELECT id INTO est  FROM auth.users WHERE email='c_est@phc-sa.com';
  SELECT id INTO vw   FROM auth.users WHERE email='c_vw@phc-sa.com';
  SELECT id INTO adm  FROM auth.users WHERE email='c_adm@phc-sa.com';
  SELECT id INTO sus  FROM auth.users WHERE email='c_sus@phc-sa.com';
  SELECT id INTO resp FROM auth.users WHERE email='c_resp@phc-sa.com';
  SELECT id INTO vwo  FROM auth.users WHERE email='c_vwonly@phc-sa.com';
  SELECT id INTO abd  FROM auth.users WHERE email='c_admbd@phc-sa.com';
  SELECT id INTO gm   FROM auth.users WHERE email='c_gm@phc-sa.com';

  -- ===== the guard against a vacuous run =====
  -- If rls_tester were not in `authenticated`, everything below would report 0
  -- and every denial check would "pass". This is the canary.
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '%  0. CANARY: a permitted role sees rows at all — otherwise every denial below is vacuous (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== owner allowed, other salesperson denied =====
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name='C mine';
  RAISE NOTICE '%  1. the deal owner reads their own contract (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.contracts WHERE contract_name='C theirs';
  RAISE NOTICE '%  2. …and NOT another salesperson''s (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '%  3. a salesperson sees exactly one contract, not the table (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name='C mine';
  RAISE NOTICE '%  4. the mirror case: the other rep cannot read the first deal''s contract (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== commercial managers allowed =====
  PERFORM set_config('test.uid', sm::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '%  5. sales_manager reads both (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '%  6. bd_manager reads both (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== finance allowed: they bill against these =====
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '%  7. finance_manager reads both (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== estimation denied: BOQs are their work, commercial terms are not =====
  PERFORM set_config('test.uid', est::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '%  8. estimation_manager reads no contract records (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the two roles this hotfix exists to exclude =====
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '%  9. system_admin ALONE reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- vw is viewer + sales_ops, so this also proves roles are additive rather
  -- than resolved by precedence: the read-only role must not cancel the other.
  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '% 10. multi-role is additive: viewer + sales_ops reads both (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- …and viewer on its own reaches nothing. A dedicated fixture user rather
  -- than a lookup: a lookup that finds nobody returns NULL, `NULL IS NOT TRUE`
  -- is true, and the check would pass without testing anything — the same
  -- vacuity the harness `GRANT authenticated` fixes at the other end.
  PERFORM set_config('test.uid', vwo::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '% 11. a viewer holding no other role reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  RAISE NOTICE '% 11b. …and the predicate says so directly, for a user that provably exists',
    CASE WHEN vwo IS NOT NULL
          AND public.can_read_contract(gen_random_uuid(), NULL, NULL, vwo) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== personal stake without any qualifying role =====
  PERFORM set_config('test.uid', resp::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name='C mine';
  RAISE NOTICE '% 12. the responsible user reads their contract despite owning neither deal nor role (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name='C theirs';
  RAISE NOTICE '% 13. …and only that one (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== suspended account =====
  PERFORM set_config('test.uid', sus::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '% 14. a SUSPENDED sales_manager reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== anon =====
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '% 15. unauthenticated reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  RAISE NOTICE '% 16. …and the predicate refuses a null user outright',
    CASE WHEN public.can_read_contract(gen_random_uuid(), NULL, NULL, NULL) IS NOT TRUE
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== forged / unresolvable relationship =====
  -- opportunity_id is NOT NULL with a CASCADE FK so this cannot occur through
  -- the table, but the predicate must still fail closed when handed one.
  RAISE NOTICE '% 17. an opportunity id that resolves to nothing grants nothing',
    CASE WHEN public.can_read_contract(gen_random_uuid(), NULL, NULL, s1) IS NOT TRUE
         THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 18. a null opportunity id grants nothing',
    CASE WHEN public.can_read_contract(NULL, NULL, NULL, s1) IS NOT TRUE
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== GM/MD reach it too =====
  PERFORM set_config('test.uid', gm::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '% 19. general_manager reads both (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== system_admin + a business role behaves as that role, exactly =====
  PERFORM set_config('test.uid', abd::text, false);
  SELECT count(*) INTO n FROM public.contracts WHERE contract_name IN ('C mine','C theirs');
  RAISE NOTICE '% 20. system_admin + bd_manager reads exactly what bd_manager reads (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  RAISE NOTICE '% 21. …and the predicate agrees for both, so system_admin neither adds nor subtracts',
    CASE WHEN public.can_read_contract(NULL, NULL, NULL, abd)
              = public.can_read_contract(NULL, NULL, NULL, bd)
          AND public.can_write_contract(abd) = public.can_write_contract(bd)
         THEN 'PASS' ELSE 'FAIL' END;

  -- ==================== WRITES ====================
  SELECT id INTO o1 FROM public.opportunities WHERE project_name='C deal mine';

  -- ---- system_admin alone: the whole point of this half ----
  PERFORM set_config('test.uid', adm::text, false);
  BEGIN
    INSERT INTO public.contracts (opportunity_id, contract_name, created_by)
      VALUES (o1, 'C admin insert', adm);
    RAISE NOTICE 'FAIL 22. system_admin ALONE inserted a contract';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 22. system_admin ALONE cannot INSERT a contract';
  END;

  UPDATE public.contracts SET notes='touched by admin' WHERE contract_name='C mine';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 23. system_admin ALONE cannot UPDATE a contract (rows affected expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  DELETE FROM public.contracts WHERE contract_name='C mine';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 24. system_admin ALONE cannot DELETE a contract (rows expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ---- the pipeline can ----
  PERFORM set_config('test.uid', bd::text, false);
  BEGIN
    INSERT INTO public.contracts (opportunity_id, contract_name, created_by)
      VALUES (o1, 'C bd insert', bd);
    RAISE NOTICE 'PASS 25. bd_manager CAN insert a contract';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'FAIL 25. bd_manager was refused an insert it should be allowed';
  END;

  UPDATE public.contracts SET notes='by bd' WHERE contract_name='C mine';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 26. bd_manager CAN update (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ---- …but nobody may delete, ever ----
  DELETE FROM public.contracts WHERE contract_name='C bd insert';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 27. not even a pipeline operator can DELETE (rows expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ---- system_admin + bd_manager writes, because bd_manager writes ----
  PERFORM set_config('test.uid', abd::text, false);
  UPDATE public.contracts SET notes='by admin+bd' WHERE contract_name='C mine';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 28. system_admin + bd_manager CAN update — authority comes from the business role (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ---- reading does not imply writing ----
  PERFORM set_config('test.uid', fin::text, false);
  BEGIN
    INSERT INTO public.contracts (opportunity_id, contract_name, created_by)
      VALUES (o1, 'C fin insert', fin);
    RAISE NOTICE 'FAIL 29. finance_manager inserted a contract — read access must not imply write';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 29. finance_manager reads but cannot INSERT';
  END;
  UPDATE public.contracts SET notes='by finance' WHERE contract_name='C mine';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 30. …and cannot UPDATE either (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ---- the deal owner reads their contract but does not author it ----
  PERFORM set_config('test.uid', s1::text, false);
  UPDATE public.contracts SET notes='by owner' WHERE contract_name='C mine';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 31. the deal owner can read but not UPDATE — today''s workflow routes edits through the pipeline (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vwo::text, false);
  BEGIN
    INSERT INTO public.contracts (opportunity_id, contract_name, created_by)
      VALUES (o1, 'C viewer insert', vwo);
    RAISE NOTICE 'FAIL 32. a viewer inserted a contract';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 32. a viewer cannot INSERT';
  END;

  -- ---- suspended: the write path had no is_active_user check at all before ----
  PERFORM set_config('test.uid', sus::text, false);
  BEGIN
    INSERT INTO public.contracts (opportunity_id, contract_name, created_by)
      VALUES (o1, 'C suspended insert', sus);
    RAISE NOTICE 'FAIL 33. a SUSPENDED sales_manager inserted a contract';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 33. a SUSPENDED sales_manager cannot INSERT';
  END;
  UPDATE public.contracts SET notes='by suspended' WHERE contract_name='C mine';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% 34. …nor UPDATE (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ---- anon ----
  PERFORM set_config('test.uid', '', false);
  BEGIN
    INSERT INTO public.contracts (opportunity_id, contract_name)
      VALUES (o1, 'C anon insert');
    RAISE NOTICE 'FAIL 35. an unauthenticated session inserted a contract';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 35. unauthenticated cannot INSERT';
  END;

  RAISE NOTICE '% 36. the write predicate refuses a null user outright',
    CASE WHEN public.can_write_contract(NULL) = FALSE THEN 'PASS' ELSE 'FAIL' END;

  -- ===== the exposure itself must not come back =====
  RESET ROLE;
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid='public.contracts'::regclass AND polcmd='r'
     AND pg_get_expr(polqual, polrelid) = 'true';
  RAISE NOTICE '% 37. no SELECT policy on contracts is USING (true) (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== write policies untouched by this hotfix =====
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid='public.contracts'::regclass AND polcmd IN ('a','w');
  RAISE NOTICE '% 38. the table still has exactly one INSERT and one UPDATE policy (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid='public.contracts'::regclass AND polcmd='d';
  RAISE NOTICE '% 39. there is still no DELETE policy (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- and the one that would silently undo the write half
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid='public.contracts'::regclass
     AND coalesce(pg_get_expr(polqual,polrelid),'') || coalesce(pg_get_expr(polwithcheck,polrelid),'')
         LIKE '%system_admin%';
  RAISE NOTICE '% 40. no policy on contracts mentions system_admin (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- contract security: done ---';
END $$;
