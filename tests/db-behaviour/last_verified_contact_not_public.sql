-- =============================================================================
-- Who can call last_verified_client_contact(), and what still works once they
-- cannot.
--
-- WHY THIS ASKS THE ACL DIRECTLY RATHER THAN SWITCHING ROLES
-- ----------------------------------------------------------
-- The harness runs `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO
-- rls_tester`. rls_tester therefore holds a DIRECT execute grant on this
-- function, independent of the `authenticated` role it inherits. A test that
-- did `SET ROLE rls_tester; SELECT last_verified_client_contact(...)` would
-- succeed whether or not the fix is present, and would have reported the
-- vulnerable database as safe.
--
-- has_function_privilege() asks the question the fix actually changes: does
-- the role `anon`, or the role `authenticated`, hold EXECUTE. That is the
-- privilege PostgREST uses, and it is what an unauthenticated POST to
-- /rest/v1/rpc/ resolves against.
--
-- The behavioural half — the views and the automation still working — IS run
-- under a real role, because that is a question about rows, not privileges.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- Seed a deal with genuine client contact, so the function has something real
-- to return and "no disclosure" cannot pass merely because the answer is NULL.
DO $$
DECLARE own UUID; other UUID; mgr UUID; vw UUID; adm UUID; o UUID; thr INT;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('lvc_own@phc-sa.com'),('lvc_other@phc-sa.com'),('lvc_mgr@phc-sa.com'),
    ('lvc_vw@phc-sa.com'),('lvc_adm@phc-sa.com');
  SELECT id INTO own   FROM auth.users WHERE email='lvc_own@phc-sa.com';
  SELECT id INTO other FROM auth.users WHERE email='lvc_other@phc-sa.com';
  SELECT id INTO mgr   FROM auth.users WHERE email='lvc_mgr@phc-sa.com';
  SELECT id INTO vw    FROM auth.users WHERE email='lvc_vw@phc-sa.com';
  SELECT id INTO adm   FROM auth.users WHERE email='lvc_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (own,other,mgr,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (own,'salesperson'),(other,'salesperson'),(mgr,'sales_manager'),
    (vw,'viewer'),(adm,'system_admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, quotation_value)
    VALUES ('LVC — private deal', own, 'jih', 'A', 9000000) RETURNING id INTO o;
  -- An APPROVED threshold must exist, in the throwaway harness only. Without
  -- one, current_sla_days('stalled_deal') is NULL by design and the
  -- stalled_deal branch of sla_breaches returns nothing — so a check that the
  -- view "works" would pass against a branch that never ran the function.
  --
  -- Suites share one database and sla_policies carries a no-overlap exclusion
  -- constraint, so an earlier suite may already have set this. Adopt whatever
  -- is in force rather than inserting a second, conflicting row.
  IF public.current_sla_days('stalled_deal') IS NULL THEN
    INSERT INTO public.sla_policies (subject, threshold_days, rationale)
      VALUES ('stalled_deal', 30, 'harness fixture — proves the view reaches the function');
  END IF;
  thr := public.current_sla_days('stalled_deal');

  -- Comfortably past the threshold in force, whatever it turned out to be.
  INSERT INTO public.activities (related_opportunity_id, activity_type, status, occurred_at, created_by)
    VALUES (o, 'meeting', 'logged', now() - make_interval(days => thr + 10), own);
END $$;

-- ===== the privilege itself =====
DO $$
DECLARE ok BOOLEAN; ts TIMESTAMPTZ; o UUID;
BEGIN
  SELECT id INTO o FROM public.opportunities WHERE project_name='LVC — private deal';

  -- The owner path must still produce a real answer, or the checks below are
  -- passing against a function that simply never works.
  SELECT public.last_verified_client_contact(o) INTO ts;
  RAISE NOTICE '% 1. the owner path returns a real timestamp (expect not-null, got %)',
    CASE WHEN ts IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, ts;

  ok := has_function_privilege('anon', 'public.last_verified_client_contact(uuid)', 'EXECUTE');
  RAISE NOTICE '% 2. anon CANNOT execute it (expect f, got %)',
    CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END, ok;

  ok := has_function_privilege('authenticated', 'public.last_verified_client_contact(uuid)', 'EXECUTE');
  RAISE NOTICE '% 3. authenticated CANNOT execute it (expect f, got %)',
    CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END, ok;

  -- PUBLIC is the one the original migration forgot; it is the reason anon had
  -- access at all, and it is invisible in a dump because it is the default.
  ok := (SELECT bool_or(grantee = 0) FROM pg_proc p,
           aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.oid = 'public.last_verified_client_contact(uuid)'::regprocedure
           AND a.privilege_type = 'EXECUTE');
  RAISE NOTICE '% 4. PUBLIC holds no EXECUTE (expect f, got %)',
    CASE WHEN COALESCE(ok,false) = false THEN 'PASS' ELSE 'FAIL' END, COALESCE(ok,false);

  ok := has_function_privilege('service_role', 'public.last_verified_client_contact(uuid)', 'EXECUTE');
  RAISE NOTICE '% 5. service_role KEEPS execute — the internal path survives (expect t, got %)',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, ok;

  -- Guards the fix against being widened later by a blanket grant.
  ok := has_function_privilege('authenticated', 'public.run_sales_automations(text)', 'EXECUTE');
  RAISE NOTICE '% 6. run_sales_automations stays closed to authenticated too (expect f, got %)',
    CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END, ok;
END $$;

-- ===== what must keep working, under a real role =====
SET ROLE rls_tester;

DO $$
DECLARE n INT; own UUID; other UUID; mgr UUID; vw UUID; adm UUID; o UUID;
BEGIN
  SELECT id INTO own   FROM auth.users WHERE email='lvc_own@phc-sa.com';
  SELECT id INTO other FROM auth.users WHERE email='lvc_other@phc-sa.com';
  SELECT id INTO mgr   FROM auth.users WHERE email='lvc_mgr@phc-sa.com';
  SELECT id INTO vw    FROM auth.users WHERE email='lvc_vw@phc-sa.com';
  SELECT id INTO adm   FROM auth.users WHERE email='lvc_adm@phc-sa.com';
  -- Resolved under a role that can see it; the id itself is subject to RLS.
  PERFORM set_config('test.uid', mgr::text, TRUE);
  SELECT id INTO o FROM public.opportunities WHERE project_name='LVC — private deal';

  -- The two views are the supported way to reach the same fact. They run as
  -- their owner, so revoking the caller's EXECUTE must not have broken them.
  PERFORM set_config('test.uid', own::text, TRUE);
  SELECT count(*) INTO n FROM public.pipeline_by_stage;
  RAISE NOTICE '% 7. the owner still reads pipeline_by_stage (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The load-bearing one: this row EXISTS ONLY because the view successfully
  -- called last_verified_client_contact() after the caller's EXECUTE was
  -- revoked. `>= 0` would have passed on a broken view; this cannot.
  SELECT count(*) INTO n FROM public.sla_breaches WHERE subject = 'stalled_deal' AND opportunity_id = o;
  RAISE NOTICE '% 8. sla_breaches still reaches the function and reports the deal (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', mgr::text, TRUE);
  SELECT count(*) INTO n FROM public.pipeline_by_stage;
  RAISE NOTICE '% 9. sales_manager still reads pipeline_by_stage (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.sla_breaches WHERE subject = 'stalled_deal' AND opportunity_id = o;
  RAISE NOTICE '% 10. …and sees the stalled deal through the function path (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- viewer sees NOTHING here, and that is the design, not a casualty of the
  -- revoke: sla_breaches reads analytics_scope_opportunities, and
  -- can_read_sales_analytics() lists neither viewer nor system_admin. Paired
  -- with check 10 above this cannot pass vacuously — the same query returns 1
  -- for a manager and 0 for a viewer in the same database, same instant.
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.sla_breaches WHERE subject = 'stalled_deal' AND opportunity_id = o;
  RAISE NOTICE '% 11. viewer is still outside analytics scope (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The unrelated salesperson is the actual disclosure case: they must not be
  -- able to learn anything about a deal they cannot read. With no EXECUTE the
  -- direct route is closed, and the row route was always closed by RLS.
  PERFORM set_config('test.uid', other::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunities WHERE id = o;
  RAISE NOTICE '% 12. an unrelated salesperson cannot see the deal at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- system_admin's row visibility is UNCHANGED, not removed. can_view_all_sales_data()
  -- has always listed system_admin, so expecting 0 here would be inventing a
  -- constraint this database never had — and a revoke on one function cannot
  -- alter a table policy in any case. What must hold is that it is the same as
  -- before: this migration adds no policy, so it grants nothing new. Column-level
  -- cost/margin isolation is a separate mechanism, covered by
  -- phase8_margin_integrity.sql, and is likewise untouched here.
  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunities WHERE id = o;
  RAISE NOTICE '% 13. system_admin visibility is unchanged by this migration (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
END $$;

RESET ROLE;

-- ===== the automation, which is the reason the function exists =====
DO $$
DECLARE rid UUID; raised INT;
BEGIN
  -- RETURNS TABLE(run_id uuid, raised int) — not a scalar, and not JSON.
  SELECT a.run_id, a.raised INTO rid, raised FROM public.run_sales_automations('test') a;
  RAISE NOTICE '% 14. the nightly automation still runs after the revoke (expect a run id, got %)',
    CASE WHEN rid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, rid;
  RAISE NOTICE '% 15. …and it still evaluates rules rather than erroring out (expect >=0, got %)',
    CASE WHEN raised >= 0 THEN 'PASS' ELSE 'FAIL' END, raised;
END $$;
