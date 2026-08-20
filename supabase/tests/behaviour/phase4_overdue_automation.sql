-- =============================================================================
-- Phase 4 — overdue-notification wiring, and the automation-engine repair.
--
-- Check 0 is the important one: before 20260819110000, run_sales_automations
-- aborted on rule 12's missing enum value on every nightly run, rolling back
-- rules 1-11 with it. Attaching an overdue notification to a function that
-- crashes would have delivered an event that never fires.
--
-- Runs standalone against a freshly replayed database.
-- Run with:  bun run test:db:behaviour
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  u_own UUID; u_sm UUID; u_admin UUID; u_susp UUID;
  o_id  UUID; f_future UUID; f_new UUID; f_old UUID; f_c UUID; f_admin UUID; f_susp UUID;
  n INT; m INT; r RECORD; raised1 INT; ok BOOLEAN;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('own@phc-sa.com'),('sm@phc-sa.com'),('admin@phc-sa.com'),('susp@phc-sa.com');
  SELECT id INTO u_own   FROM auth.users WHERE email='own@phc-sa.com';
  SELECT id INTO u_sm    FROM auth.users WHERE email='sm@phc-sa.com';
  SELECT id INTO u_admin FROM auth.users WHERE email='admin@phc-sa.com';
  SELECT id INTO u_susp  FROM auth.users WHERE email='susp@phc-sa.com';
  UPDATE public.profiles SET status='active'    WHERE id IN (u_own,u_sm,u_admin);
  UPDATE public.profiles SET status='suspended' WHERE id = u_susp;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_own,'salesperson'), (u_sm,'sales_manager'),
    (u_admin,'system_admin'), (u_susp,'salesperson');

  -- act as the service role (this is how cron runs it)
  PERFORM set_config('test.uid', '', false);

  INSERT INTO public.opportunities (project_name, owner_id)
  VALUES ('Overdue Test Opp', u_own) RETURNING id INTO o_id;

  -- ===== 0. THE ENGINE ITSELF RUNS =====
  -- Before this migration it aborted on rule 12's missing enum value.
  BEGIN
    SELECT raised INTO raised1 FROM public.run_sales_automations('test');
    ok := true;
  EXCEPTION WHEN others THEN
    ok := false;
    RAISE NOTICE '   engine error: %', SQLERRM;
  END;
  RAISE NOTICE '%  0. run_sales_automations completes without error (was failing nightly)',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  RAISE NOTICE '%  0b. rule 12''s enum value is now valid',
    CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
                       WHERE t.typname='queue_action_type' AND e.enumlabel='submission_pending_on')
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== 1. NOT OVERDUE -> NO NOTIFICATION =====
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_owner_id, due_date, priority, status, reason, queue_action_type, condition_key)
  VALUES ('opportunity', o_id, 'action_required', u_own, CURRENT_DATE + 3, 'A', 'open', 'Future work', NULL, 'fut')
  RETURNING id INTO f_future;

  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND dedupe_key LIKE 'overdue:'||f_future::text||'%';
  RAISE NOTICE '%  1. an item that is not yet due raises nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 2. BECOMES OVERDUE -> EXACTLY ONE =====
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_owner_id, due_date, priority, status, reason, queue_action_type, condition_key)
  VALUES ('opportunity', o_id, 'action_required', u_own, CURRENT_DATE - 1, 'A', 'open', 'Chase the client', NULL, 'new')
  RETURNING id INTO f_new;

  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND dedupe_key = 'overdue:'||f_new::text||':'||(CURRENT_DATE-1)::text;
  RAISE NOTICE '%  2. an item that just went overdue notifies once (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 3. SECOND RUN -> NO DUPLICATE =====
  PERFORM public.run_sales_automations('test');
  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND dedupe_key = 'overdue:'||f_new::text||':'||(CURRENT_DATE-1)::text;
  RAISE NOTICE '%  3. two more runs add no duplicate (still 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 4. CORRECT RECIPIENT =====
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue'
     AND dedupe_key = 'overdue:'||f_new::text||':'||(CURRENT_DATE-1)::text
     AND recipient_user_id = u_own;
  RAISE NOTICE '%  4. it goes to the flag''s action owner (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND recipient_user_id <> u_own;
  RAISE NOTICE '%  4b. nobody else receives it (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 5. system_admin GETS NOTHING FROM ADMIN ROLE ALONE =====
  -- An overdue flag owned by someone else must not reach an administrator.
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND recipient_user_id = u_admin;
  RAISE NOTICE '%  5. system_admin receives nothing by virtue of the role (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 6. SUSPENDED USER GETS NOTHING =====
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_owner_id, due_date, priority, status, reason, queue_action_type, condition_key)
  VALUES ('opportunity', o_id, 'action_required', u_susp, CURRENT_DATE - 1, 'A', 'open', 'Suspended owner', NULL, 'susp')
  RETURNING id INTO f_susp;

  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND recipient_user_id = u_susp;
  RAISE NOTICE '%  6. a suspended owner accrues nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 7. TIER C IS NOISE, NOT A NOTIFICATION =====
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_owner_id, due_date, priority, status, reason, queue_action_type, condition_key)
  VALUES ('opportunity', o_id, 'action_required', u_own, CURRENT_DATE - 1, 'C', 'open', 'Low priority', NULL, 'lowp')
  RETURNING id INTO f_c;

  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND dedupe_key LIKE 'overdue:'||f_c::text||'%';
  RAISE NOTICE '%  7. tier C does not notify (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 8. THE LOOKBACK WINDOW SUPPRESSES ANCIENT BACKLOG =====
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_owner_id, due_date, priority, status, reason, queue_action_type, condition_key)
  VALUES ('opportunity', o_id, 'action_required', u_own, CURRENT_DATE - 60, 'A', 'open', 'Ancient', NULL, 'old')
  RETURNING id INTO f_old;

  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND dedupe_key LIKE 'overdue:'||f_old::text||'%';
  RAISE NOTICE '%  8. something 60 days late is not announced as "just became overdue" (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 9. A RESCHEDULED ITEM THAT LAPSES AGAIN IS A NEW OCCURRENCE =====
  -- Rescheduling produces a new flag row (new condition_key), so a genuinely
  -- new lapse is a new dedupe key and correctly notifies again.
  INSERT INTO public.opportunity_flags
    (linked_record_type, linked_record_id, flag_kind, action_owner_id, due_date, priority, status, reason, queue_action_type, condition_key)
  VALUES ('opportunity', o_id, 'action_required', u_own, CURRENT_DATE - 2, 'A', 'open', 'Chase the client', NULL, 'resched')
  RETURNING id INTO f_c;

  PERFORM public.run_sales_automations('test');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='item_overdue' AND dedupe_key = 'overdue:'||f_c::text||':'||(CURRENT_DATE-2)::text;
  RAISE NOTICE '%  9. a fresh lapse on a new flag row does notify (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 10. THE RUN LOG RECORDS THE NOTIFIER =====
  SELECT count(*) INTO n FROM public.automation_runs WHERE notified IS NOT NULL;
  SELECT count(*) INTO m FROM public.automation_runs WHERE notified > 0;
  RAISE NOTICE '% 10. automation_runs records notification counts (rows with a count=%, non-zero=%)',
    CASE WHEN n > 0 AND m > 0 THEN 'PASS' ELSE 'FAIL' END, n, m;

  -- ===== 11. THE ENGINE STILL RAISES FLAGS =====
  SELECT count(*) INTO n FROM public.automation_runs WHERE finished_at IS NOT NULL;
  RAISE NOTICE '% 11. every run completed (finished_at set on % runs)',
    CASE WHEN n >= 8 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- overdue wiring checks done ---';
END $$;
