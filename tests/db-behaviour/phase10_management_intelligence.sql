-- =============================================================================
-- Phase 10 — management intelligence.
--
-- Two things worth proving. First the arithmetic, because a forecast that is
-- quietly wrong is worse than no forecast. Second the scope: an aggregate of
-- deals nobody may open individually is the more sensitive artefact, so viewer
-- and system_admin must get nothing here.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; fin UUID; vw UUID; adm UUID; est UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('mi_s1@phc-sa.com'),('mi_s2@phc-sa.com'),('mi_sm@phc-sa.com'),
    ('mi_fin@phc-sa.com'),('mi_vw@phc-sa.com'),('mi_adm@phc-sa.com'),('mi_est@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='mi_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='mi_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='mi_sm@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='mi_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='mi_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='mi_adm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='mi_est@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,fin,vw,adm,est);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),
    (fin,'finance_manager'),(vw,'viewer'),(adm,'system_admin'),(est,'estimation_manager');

  -- s1: one open deal at 100k weighted 50%, one won at 200k, one lost.
  INSERT INTO public.opportunities
    (project_name, owner_id, sales_stage, quotation_value, human_win_probability, expected_contract_date, last_activity_at)
    VALUES ('MI open', s1, 'under_negotiation', 100000, 50, date_trunc('month', current_date)::date, now());
  INSERT INTO public.opportunities
    (project_name, owner_id, sales_stage, contract_value, quotation_value, won_at, created_at)
    VALUES ('MI won', s1, 'won', 200000, 190000, now() - interval '2 days', now() - interval '12 days');
  INSERT INTO public.opportunities
    (project_name, owner_id, sales_stage, quotation_value, loss_reason, lost_at_stage, lost_to_competitor, lost_at)
    VALUES ('MI lost', s1, 'lost', 50000, 'price', 'under_negotiation', 'Rival Signs', now() - interval '1 day');
  -- A lost deal with no reason recorded: must surface as 'unrecorded'.
  INSERT INTO public.opportunities
    (project_name, owner_id, sales_stage, quotation_value, lost_at)
    VALUES ('MI lost silent', s1, 'lost', 25000, now() - interval '1 day');

  -- s2's deal, which s1 must never aggregate.
  INSERT INTO public.opportunities
    (project_name, owner_id, sales_stage, quotation_value, last_activity_at)
    VALUES ('MI other', s2, 'jih', 999000, now() - interval '30 days');

  INSERT INTO public.sales_targets (user_id, period_type, period_start, sales_target, created_by)
    VALUES (s1, 'monthly', date_trunc('month', current_date)::date, 400000, sm);
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; v NUMERIC; s1 UUID; s2 UUID; sm UUID; fin UUID; vw UUID; adm UUID; est UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='mi_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='mi_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='mi_sm@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='mi_fin@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='mi_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='mi_adm@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='mi_est@phc-sa.com';

  -- ===== the value definition =====
  SELECT public.opportunity_value(200000, 190000, 180000) INTO v;
  RAISE NOTICE '% 1. a signed contract is reported at its contract value (expect 200000, got %)',
    CASE WHEN v=200000 THEN 'PASS' ELSE 'FAIL' END, v;
  SELECT public.opportunity_value(NULL, 190000, 180000) INTO v;
  RAISE NOTICE '% 2. …else the quotation (expect 190000, got %)',
    CASE WHEN v=190000 THEN 'PASS' ELSE 'FAIL' END, v;
  SELECT public.opportunity_value(NULL, NULL, 180000) INTO v;
  RAISE NOTICE '% 3. …else the estimate, rather than nothing (expect 180000, got %)',
    CASE WHEN v=180000 THEN 'PASS' ELSE 'FAIL' END, v;

  -- ===== the forecast weight =====
  SELECT public.opportunity_win_weight(50, 'sure_win') INTO v;
  RAISE NOTICE '% 4. a human probability beats the confidence label (expect 0.50, got %)',
    CASE WHEN v=0.50 THEN 'PASS' ELSE 'FAIL' END, v;
  SELECT public.opportunity_win_weight(NULL, 'sure_win') INTO v;
  RAISE NOTICE '% 5. …and the label is used when there is no human number (expect 0.90, got %)',
    CASE WHEN v=0.90 THEN 'PASS' ELSE 'FAIL' END, v;
  -- Was: "weighted pessimistically (expect 0.20)". That 0.20 was forecast
  -- manufactured out of ignorance — 63.4M of unassessed pipeline became 12.7M
  -- of forecast — and it is indistinguishable downstream from a real estimate
  -- somebody made. NULL in, NULL out: the caller decides what to do with an
  -- unknown instead of being handed a number that looks considered.
  SELECT public.opportunity_win_weight(NULL, NULL) INTO v;
  RAISE NOTICE '% 6. an unassessed deal weighs NULL, never an invented default (expect NULL, got %)',
    CASE WHEN v IS NULL THEN 'PASS' ELSE 'FAIL' END, COALESCE(v::text, 'NULL');

  -- ===== pipeline excludes decided deals =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.pipeline_by_stage WHERE sales_stage IN ('won','lost');
  RAISE NOTICE '% 7. won and lost never appear in open pipeline (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT pipeline_value INTO v FROM public.pipeline_by_stage WHERE sales_stage='under_negotiation';
  RAISE NOTICE '% 8. the open deal carries its quotation value (expect 100000, got %)',
    CASE WHEN v=100000 THEN 'PASS' ELSE 'FAIL' END, v;

  -- ===== forecast arithmetic =====
  SELECT weighted_value INTO v FROM public.sales_forecast
   WHERE owner_id=s1 AND forecast_month=date_trunc('month', current_date)::date;
  RAISE NOTICE '% 9. 100000 at 50%% weights to 50000 (got %)',
    CASE WHEN v=50000.00 THEN 'PASS' ELSE 'FAIL' END, v;
  SELECT gross_value INTO v FROM public.sales_forecast
   WHERE owner_id=s1 AND forecast_month=date_trunc('month', current_date)::date;
  RAISE NOTICE '% 10. …and the gross is reported alongside it (expect 100000, got %)',
    CASE WHEN v=100000 THEN 'PASS' ELSE 'FAIL' END, v;

  -- ===== target vs actual =====
  SELECT won_value INTO v FROM public.target_vs_actual WHERE user_id=s1;
  RAISE NOTICE '% 11. the won contract counts toward the target (expect 200000, got %)',
    CASE WHEN v=200000 THEN 'PASS' ELSE 'FAIL' END, v;
  SELECT attainment_pct INTO v FROM public.target_vs_actual WHERE user_id=s1;
  RAISE NOTICE '% 12. 200000 of a 400000 target is 50%% attainment (got %)',
    CASE WHEN v=50.0 THEN 'PASS' ELSE 'FAIL' END, v;

  -- ===== conversion =====
  SELECT win_rate_pct INTO v FROM public.conversion_summary WHERE owner_id=s1;
  RAISE NOTICE '% 13. win rate is over decided deals only — 1 won of 3 decided (expect 33.3, got %)',
    CASE WHEN v=33.3 THEN 'PASS' ELSE 'FAIL' END, v;
  SELECT open_deals INTO n FROM public.conversion_summary WHERE owner_id=s1;
  RAISE NOTICE '% 14. …with open deals counted separately (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== losses =====
  SELECT deals INTO n FROM public.loss_analysis WHERE loss_reason='price';
  RAISE NOTICE '% 15. a recorded loss reason is grouped (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT deals INTO n FROM public.loss_analysis WHERE loss_reason='unrecorded';
  RAISE NOTICE '% 16. an unexplained loss is surfaced, not dropped (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT lost_to_a_named_competitor INTO n FROM public.loss_analysis WHERE loss_reason='price';
  RAISE NOTICE '% 17. a named competitor is counted (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== scope: a salesperson aggregates only their own =====
  SELECT count(*) INTO n FROM public.team_performance;
  RAISE NOTICE '% 18. a salesperson sees one row in team performance — their own (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.analytics_scope_opportunities WHERE owner_id=s2;
  RAISE NOTICE '% 19. …and none of a colleague''s deals (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT coalesce(sum(pipeline_value),0) INTO v FROM public.pipeline_by_stage;
  RAISE NOTICE '% 20. the colleague''s 999000 deal is not in their pipeline total (expect 100000, got %)',
    CASE WHEN v=100000 THEN 'PASS' ELSE 'FAIL' END, v;

  -- ===== scope: management sees the board =====
  -- Scoped to this suite's owners: the behavioural database is shared, so
  -- "every owner" counts fixtures from every other suite too.
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.team_performance WHERE owner_id IN (s1,s2);
  RAISE NOTICE '% 21. sales_manager sees both owners (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, TRUE);
  SELECT count(*) INTO n FROM public.team_performance WHERE owner_id IN (s1,s2);
  RAISE NOTICE '% 22. finance sees the board too (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== scope: the aggregate is not a back door =====
  -- viewer and system_admin cannot open a single one of these deals, so they
  -- must not be handed the sum of them either.
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.team_performance;
  RAISE NOTICE '% 23. viewer aggregates nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.sales_forecast;
  RAISE NOTICE '% 24. …and gets no forecast (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.loss_analysis;
  RAISE NOTICE '% 25. …and no loss book (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.team_performance;
  RAISE NOTICE '% 26. system_admin alone aggregates nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.target_vs_actual;
  RAISE NOTICE '% 27. …and sees no targets (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', est::text, TRUE);
  SELECT count(*) INTO n FROM public.team_performance;
  RAISE NOTICE '% 28. estimation is not a sales-analytics role (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', '', TRUE);
  SELECT count(*) INTO n FROM public.pipeline_by_stage;
  RAISE NOTICE '% 29. anon aggregates nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== no commercial internals leak into reporting =====
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('pipeline_by_stage','sales_forecast','target_vs_actual',
                        'conversion_summary','loss_analysis','team_performance')
     AND (column_name LIKE '%margin%' OR column_name LIKE '%cost%' OR column_name = 'proposed_price');
  RAISE NOTICE '% 30. no cost or margin column exists in any Phase 10 view (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 10 management intelligence: done ---';
END $$;
RESET ROLE;
