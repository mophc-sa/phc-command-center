-- =============================================================================
-- Hotfix — the opportunity score's guards, enforced by the database.
--
-- Both rules were previously TypeScript-only, so every check here is written
-- as a direct SQL write: that is the path that bypassed them.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE s1 UUID; s2 UUID; sm UUID; o1 UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('sc_s1@phc-sa.com'),('sc_s2@phc-sa.com'),('sc_sm@phc-sa.com');
  SELECT id INTO s1 FROM auth.users WHERE email='sc_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='sc_s2@phc-sa.com';
  SELECT id INTO sm FROM auth.users WHERE email='sc_sm@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (s1,s2,sm);
  -- on_auth_user_created already grants a default role, so this must tolerate
  -- the overlap rather than assume the table is empty for these users.
  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(sm,'sales_manager')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.opportunities (project_name, owner_id, score, score_tier)
    VALUES ('SC deal', s1, 40, 'B') RETURNING id INTO o1;
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; who UUID; reason TEXT; o1 UUID; s1 UUID; s2 UUID; sm UUID; t TEXT;
BEGIN
  SELECT id INTO s1 FROM auth.users WHERE email='sc_s1@phc-sa.com';
  SELECT id INTO s2 FROM auth.users WHERE email='sc_s2@phc-sa.com';
  SELECT id INTO sm FROM auth.users WHERE email='sc_sm@phc-sa.com';
  PERFORM set_config('test.uid', s1::text, TRUE);
  SELECT id INTO o1 FROM public.opportunities WHERE project_name='SC deal';

  -- ===== an override must say why =====
  BEGIN
    UPDATE public.opportunities SET score_tier='A', score_manual_override=TRUE WHERE id=o1;
    RAISE NOTICE 'FAIL 1. a tier was overridden with no reason';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 1. an override with no reason is refused by the database'; END;

  UPDATE public.opportunities
     SET score_tier='A', score_manual_override=TRUE, score_override_reason='Client confirmed budget verbally'
   WHERE id=o1;
  SELECT count(*) INTO n FROM public.opportunities
   WHERE id=o1 AND score_tier='A' AND score_manual_override;
  RAISE NOTICE '% 2. an explained override is accepted (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN
    UPDATE public.opportunities SET score_override_reason='   ' WHERE id=o1;
    RAISE NOTICE 'FAIL 3. the reason was blanked while the override stood';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 3. the reason cannot be blanked while the override stands'; END;

  -- ===== the scorer is the session, not the payload =====
  SELECT scored_by INTO who FROM public.opportunities WHERE id=o1;
  RAISE NOTICE '% 4. scoring stamps the session user (expect s1, got %)',
    CASE WHEN who=s1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN who=s1 THEN 's1' WHEN who IS NULL THEN 'NULL' ELSE 'someone else' END;

  -- The whole point: a hand-written payload naming a colleague.
  UPDATE public.opportunities
     SET score=55, scored_by=s2, score_manual_override=TRUE, score_override_reason='still mine'
   WHERE id=o1;
  SELECT scored_by INTO who FROM public.opportunities WHERE id=o1;
  RAISE NOTICE '% 5. a payload naming someone else is overwritten with the session (expect s1, got %)',
    CASE WHEN who=s1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN who=s1 THEN 's1' WHEN who=s2 THEN 's2 — NOT overwritten' ELSE 'other' END;

  -- ===== clearing the override clears its justification =====
  UPDATE public.opportunities SET score_manual_override=FALSE WHERE id=o1;
  SELECT score_override_reason INTO reason FROM public.opportunities WHERE id=o1;
  RAISE NOTICE '% 6. clearing the override clears the stale reason (expect NULL, got %)',
    CASE WHEN reason IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(reason,'NULL');

  -- ===== ordinary edits are untouched =====
  -- The guard must not fire for every update on a busy table; if it did, an
  -- unrelated edit would silently restamp scored_by.
  PERFORM set_config('test.uid', sm::text, TRUE);
  UPDATE public.opportunities SET location='Jeddah' WHERE id=o1;
  SELECT scored_by INTO who FROM public.opportunities WHERE id=o1;
  RAISE NOTICE '% 7. an unrelated edit does not restamp the scorer (expect s1, got %)',
    CASE WHEN who=s1 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN who=s1 THEN 's1' WHEN who=sm THEN 'sm — wrongly restamped' ELSE 'other' END;

  SELECT location INTO t FROM public.opportunities WHERE id=o1;
  RAISE NOTICE '% 8. …and the edit itself still lands (expect Jeddah, got %)',
    CASE WHEN t='Jeddah' THEN 'PASS' ELSE 'FAIL' END, coalesce(t,'NULL');

  -- ===== the range check still holds =====
  BEGIN
    UPDATE public.opportunities SET score=250 WHERE id=o1;
    RAISE NOTICE 'FAIL 9. a score outside 0-100 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 9. a score outside 0-100 is still refused'; END;

  RAISE NOTICE '--- score integrity: done ---';
END $$;
RESET ROLE;

-- ===== unauthenticated paths keep their own attribution =====
-- The seed and migrations have no session to attribute a score to, so the
-- guard must not blank what they set.
DO $$
DECLARE s2 UUID; o2 UUID; who UUID;
BEGIN
  SELECT id INTO s2 FROM auth.users WHERE email='sc_s2@phc-sa.com';
  PERFORM set_config('test.uid', '', TRUE);
  INSERT INTO public.opportunities (project_name, owner_id, score, score_tier, scored_by)
    VALUES ('SC seeded', s2, 30, 'C', s2) RETURNING id INTO o2;
  UPDATE public.opportunities SET score=35 WHERE id=o2;
  SELECT scored_by INTO who FROM public.opportunities WHERE id=o2;
  RAISE NOTICE '% 10. an unauthenticated write keeps the attribution it set (expect s2, got %)',
    CASE WHEN who=s2 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN who=s2 THEN 's2' WHEN who IS NULL THEN 'NULL — wrongly cleared' ELSE 'other' END;
END $$;
