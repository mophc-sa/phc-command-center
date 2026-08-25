-- =============================================================================
-- Phase 5 — NO BOQ, NO PROJECT NUMBER (behavioural).
--
-- Static reading cannot tell you whether a guard actually refuses a write, or
-- whether trigger ordering lets generation slip past validation. These run the
-- real triggers against a database that has replayed every migration.
--
-- Run with:  bun run test:db:behaviour
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  u_gm UUID; u_admin UUID; u_sales UUID;
  p_no_boq UUID; p_with_boq UUID; p_estimated UUID; p_missing UUID;
  o_id UUID; num TEXT; num2 TEXT;
  denied BOOLEAN; msg TEXT;
BEGIN
  INSERT INTO auth.users (email) VALUES ('gm5@phc-sa.com'),('admin5@phc-sa.com'),('sales5@phc-sa.com');
  SELECT id INTO u_gm    FROM auth.users WHERE email='gm5@phc-sa.com';
  SELECT id INTO u_admin FROM auth.users WHERE email='admin5@phc-sa.com';
  SELECT id INTO u_sales FROM auth.users WHERE email='sales5@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (u_gm,u_admin,u_sales);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_gm,'general_manager'), (u_admin,'system_admin'), (u_sales,'salesperson');

  PERFORM set_config('test.uid', '', false);   -- service role for setup

  -- ===== 1. A new project gets NO number =====
  INSERT INTO public.projects (name) VALUES ('P5 No BOQ') RETURNING id INTO p_no_boq;
  SELECT project_number INTO num FROM public.projects WHERE id=p_no_boq;
  RAISE NOTICE '%  1. a new project is created without a number (got %)',
    CASE WHEN num IS NULL THEN 'PASS' ELSE 'FAIL' END, COALESCE(num,'NULL');

  -- ===== 2. Issuing without a BOQ is refused =====
  denied := false;
  BEGIN
    PERFORM public.issue_project_number(p_no_boq);
  EXCEPTION WHEN check_violation THEN denied := true; msg := SQLERRM;
  END;
  RAISE NOTICE '%  2. issuing without a BOQ is refused (denied=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  RAISE NOTICE '%  3. the refusal is bilingual (EN+AR present)',
    CASE WHEN msg LIKE '%Project number cannot be issued%' AND msg LIKE '%جدول الكميات%'
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== 4. A direct UPDATE cannot bypass the RPC =====
  denied := false;
  BEGIN
    UPDATE public.projects SET project_number='PRJ-HACK-0001' WHERE id=p_no_boq;
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  RAISE NOTICE '%  4. a direct table UPDATE cannot set a number (blocked=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 5. has_boq checkbox alone is not evidence =====
  -- The claim lives on inbox_items; it must not unlock the number.
  INSERT INTO public.inbox_items (project_name, source_type, has_boq)
  VALUES ('P5 claims a BOQ', 'manual_rfq', true);
  denied := false;
  BEGIN
    PERFORM public.issue_project_number(p_no_boq);
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  RAISE NOTICE '%  5. a has_boq checkbox alone does not unlock a number (denied=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 6. A BOQ of status 'missing' is not a BOQ =====
  INSERT INTO public.projects (name) VALUES ('P5 missing BOQ') RETURNING id INTO p_missing;
  INSERT INTO public.opportunities (project_name, project_id) VALUES ('opp-missing', p_missing) RETURNING id INTO o_id;
  INSERT INTO public.boqs (related_opportunity_id, title, status) VALUES (o_id, 'none yet', 'missing');
  denied := false;
  BEGIN
    PERFORM public.issue_project_number(p_missing);
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  RAISE NOTICE '%  6. status=missing does not count as a BOQ (denied=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 7. 'estimated_scope' is our guess, not a received BOQ =====
  INSERT INTO public.projects (name) VALUES ('P5 estimated') RETURNING id INTO p_estimated;
  INSERT INTO public.opportunities (project_name, project_id) VALUES ('opp-est', p_estimated) RETURNING id INTO o_id;
  INSERT INTO public.boqs (related_opportunity_id, title, status) VALUES (o_id, 'our estimate', 'estimated_scope');
  denied := false;
  BEGIN
    PERFORM public.issue_project_number(p_estimated);
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  RAISE NOTICE '%  7. estimated_scope does not count as a BOQ (denied=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 8. A verified BOQ issues the number =====
  INSERT INTO public.projects (name) VALUES ('P5 with BOQ') RETURNING id INTO p_with_boq;
  INSERT INTO public.opportunities (project_name, project_id) VALUES ('opp-boq', p_with_boq) RETURNING id INTO o_id;
  INSERT INTO public.boqs (related_opportunity_id, title, status) VALUES (o_id, 'real boq', 'verified');
  SELECT public.issue_project_number(p_with_boq) INTO num;
  RAISE NOTICE '%  8. a verified BOQ issues the number (got %)',
    CASE WHEN num LIKE 'PRJ-%' THEN 'PASS' ELSE 'FAIL' END, COALESCE(num,'NULL');

  -- ===== 9. Issuance is idempotent =====
  SELECT public.issue_project_number(p_with_boq) INTO num2;
  RAISE NOTICE '%  9. issuing twice returns the same number, never a second one (% = %)',
    CASE WHEN num2 = num THEN 'PASS' ELSE 'FAIL' END, num, num2;

  -- ===== 10. An issued number cannot be overwritten =====
  denied := false;
  BEGIN
    UPDATE public.projects SET project_number='PRJ-2026-9999' WHERE id=p_with_boq;
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  RAISE NOTICE '% 10. an issued number cannot be changed (blocked=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 11. Duplicates are impossible =====
  denied := false;
  BEGIN
    INSERT INTO public.projects (name, project_number) VALUES ('P5 dupe', num);
  EXCEPTION WHEN unique_violation OR check_violation THEN denied := true;
  END;
  RAISE NOTICE '% 11. a duplicate project number is rejected (blocked=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 12. system_admin alone gets no bypass =====
  PERFORM set_config('test.uid', u_admin::text, false);
  denied := false;
  BEGIN
    PERFORM public.issue_project_number(p_no_boq);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied := true;
  END;
  RAISE NOTICE '% 12. system_admin alone cannot issue a number (denied=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 13. A salesperson gets no bypass either =====
  PERFORM set_config('test.uid', u_sales::text, false);
  denied := false;
  BEGIN
    PERFORM public.issue_project_number(p_no_boq);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN denied := true;
  END;
  RAISE NOTICE '% 13. a salesperson cannot issue a number (denied=%)',
    CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END, denied;

  -- ===== 14. A commercial manager can, when the BOQ is real =====
  PERFORM set_config('test.uid', u_gm::text, false);
  INSERT INTO public.projects (name) VALUES ('P5 gm issues') RETURNING id INTO p_no_boq;
  INSERT INTO public.opportunities (project_name, project_id) VALUES ('opp-gm', p_no_boq) RETURNING id INTO o_id;
  INSERT INTO public.boqs (related_opportunity_id, title, status) VALUES (o_id, 'gm boq', 'partially_verified');
  SELECT public.issue_project_number(p_no_boq) INTO num;
  RAISE NOTICE '% 14. a general manager issues it with a partially_verified BOQ (got %)',
    CASE WHEN num LIKE 'PRJ-%' THEN 'PASS' ELSE 'FAIL' END, COALESCE(num,'NULL');

  -- ===== 15. The intake INT- reference is untouched =====
  PERFORM set_config('test.uid', '', false);
  RAISE NOTICE '% 15. intake still gets its own INT- reference, independent of this rule',
    CASE WHEN EXISTS (SELECT 1 FROM public.inbox_items WHERE project_number LIKE 'INT-%')
         THEN 'PASS' ELSE 'FAIL' END;

  RAISE NOTICE '--- project number / BOQ governance: done ---';
END $$;
