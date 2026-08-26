-- =============================================================================
-- What each role can actually SEE — the rows that would reach an AI context.
--
-- This closes the outstanding Package D Major. The frontend containment is
-- structural (Ask AI is handed rows, never a client) but that only guarantees
-- the AI sees no MORE than the user; it says nothing about what the user sees.
-- That is RLS's job, and RLS is only provable by running it.
--
-- The question each check asks is the same one: if this role opened the
-- Command Center right now, which opportunities, stakeholders and follow-ups
-- would be in the payload the brief, the search and the side panel all read
-- from? Anything visible here can reach an AI context; anything invisible here
-- cannot, because it never leaves the database.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; bd UUID; vw UUID; adm UUID;
  o1 UUID; o2 UUID;
  n INT; ok BOOLEAN;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('ai_s1@phc-sa.com'),('ai_s2@phc-sa.com'),('ai_sm@phc-sa.com'),
    ('ai_bd@phc-sa.com'),('ai_vw@phc-sa.com'),('ai_adm@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='ai_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ai_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ai_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='ai_bd@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ai_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ai_adm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm,bd,vw,adm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager'),
    (bd,'bd_manager'),(vw,'viewer'),(adm,'system_admin')
  -- A default role is assigned on profile creation, so an explicit grant of the
  -- same role collides. The grant is what matters, not who wrote it first.
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, quotation_value)
    VALUES ('AI ctx — s1 deal', s1, 'jih', 'A', 5000000) RETURNING id INTO o1;
  INSERT INTO public.opportunities (project_name, owner_id, sales_stage, tier, quotation_value)
    VALUES ('AI ctx — s2 deal', s2, 'jih', 'A', 7000000) RETURNING id INTO o2;

  INSERT INTO public.stakeholders (opportunity_id, name, role_code)
    VALUES (o1, 'AI ctx DM', 'decision_maker');
  INSERT INTO public.follow_ups (opportunity_id, owner_id, due_date, status)
    VALUES (o1, s1, current_date - 3, 'overdue');
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  s1 UUID; s2 UUID; sm UUID; bd UUID; vw UUID; adm UUID;
  o1 UUID; o2 UUID;
  n INT; ok BOOLEAN;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='ai_s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='ai_s2@phc-sa.com';
  SELECT id INTO sm  FROM auth.users WHERE email='ai_sm@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='ai_bd@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='ai_vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='ai_adm@phc-sa.com';
  -- The id lookup is itself subject to RLS now, so it needs a user who can see
  -- both deals. Without this the ids come back NULL and every positive check
  -- below "passes" against nothing.
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT id INTO o1 FROM public.opportunities WHERE project_name='AI ctx — s1 deal';
  SELECT id INTO o2 FROM public.opportunities WHERE project_name='AI ctx — s2 deal';

  -- ===== salesperson: their own book only =====
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunities WHERE id = o2;
  RAISE NOTICE '% 1. a salesperson cannot see another salesperson''s opportunity (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.opportunities WHERE id = o1;
  RAISE NOTICE '% 2. …and does see their own (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.stakeholders WHERE opportunity_id = o1;
  RAISE NOTICE '% 3. …including its stakeholders (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', s2::text, TRUE);
  SELECT count(*) INTO n FROM public.stakeholders WHERE opportunity_id = o1;
  RAISE NOTICE '% 4. an unrelated salesperson sees none of its stakeholders (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.follow_ups WHERE opportunity_id = o1;
  RAISE NOTICE '% 5. …nor its follow-ups, which the brief also reads (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== sales_manager and bd_manager: the company =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunities WHERE id IN (o1, o2);
  RAISE NOTICE '% 6. sales_manager sees the whole book (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', bd::text, TRUE);
  SELECT count(*) INTO n FROM public.opportunities WHERE id IN (o1, o2);
  RAISE NOTICE '% 7. bd_manager sees the whole book (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== viewer: reads nothing commercial, writes nothing =====
  PERFORM set_config('test.uid', vw::text, TRUE);
  SELECT count(*) INTO n FROM public.stakeholders;
  RAISE NOTICE '% 8. viewer reads no stakeholders at all (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  ok := FALSE;
  BEGIN
    INSERT INTO public.stakeholders (opportunity_id, name, role_code)
      VALUES (o1, 'viewer tried', 'influencer');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN ok := TRUE;
  END;
  RAISE NOTICE '% 9. viewer cannot create a stakeholder (expect refused, got %)',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, CASE WHEN ok THEN 'refused' ELSE 'ALLOWED' END;

  ok := FALSE;
  BEGIN
    INSERT INTO public.follow_ups (opportunity_id, owner_id, due_date, status)
      VALUES (o1, vw, current_date, 'scheduled');
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  RAISE NOTICE '% 10. viewer cannot create a follow-up — the draft loop''s write path (expect refused, got %)',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, CASE WHEN ok THEN 'refused' ELSE 'ALLOWED' END;

  -- ===== system_admin ALONE: administering is not selling =====
  PERFORM set_config('test.uid', adm::text, TRUE);
  SELECT count(*) INTO n FROM public.stakeholders;
  RAISE NOTICE '% 11. system_admin alone reads no stakeholders (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '% 12. system_admin alone holds no commercial authority (expect false, got %)',
    CASE WHEN NOT public.is_commercial_manager(adm) THEN 'PASS' ELSE 'FAIL' END,
    public.is_commercial_manager(adm);

  ok := FALSE;
  BEGIN
    INSERT INTO public.stakeholders (opportunity_id, name, role_code)
      VALUES (o1, 'admin tried', 'decision_maker');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN ok := TRUE;
  END;
  RAISE NOTICE '% 13. …and cannot write one either (expect refused, got %)',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, CASE WHEN ok THEN 'refused' ELSE 'ALLOWED' END;

  -- ===== the controlled vocabulary =====
  PERFORM set_config('test.uid', sm::text, TRUE);
  ok := FALSE;
  BEGIN
    INSERT INTO public.stakeholders (opportunity_id, name, role_code)
      VALUES (o1, 'bad role', 'chief_vibes_officer');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  RAISE NOTICE '% 14. a role outside the vocabulary is refused (expect refused, got %)',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, CASE WHEN ok THEN 'refused' ELSE 'ALLOWED' END;

  INSERT INTO public.stakeholders (opportunity_id, name, role, role_code)
    VALUES (o1, 'legacy person', 'Main Contact — Procurement Dept', NULL);
  SELECT count(*) INTO n FROM public.stakeholders
   WHERE opportunity_id=o1 AND role = 'Main Contact — Procurement Dept';
  RAISE NOTICE '% 15. a historical free-text role is still writable and preserved (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '  (AI context role isolation suite complete)';
END $$;

RESET ROLE;
