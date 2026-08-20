-- =============================================================================
-- Phase 4 — notification behaviour, run against a real Postgres.
--
-- These are not pgTAP: they run against a throwaway database that has replayed
-- every migration, and they exercise the triggers by writing to the source
-- tables the way the application does. What they prove is behaviour a static
-- reading of the SQL cannot — fan-out membership, dedupe under repeated writes,
-- self-notification suppression, and the ordering between governance triggers
-- and notification triggers.
--
-- Run with:  bun run test:db:behaviour
-- (see scripts/db-behaviour.sh — it spins up the container and replays first)
--
-- Every check prints PASS or FAIL. Any ERROR aborts the run.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  u_owner UUID; u_sm UUID; u_bd UUID; u_admin UUID; u_other UUID;
  o_id UUID; a_id UUID; i_id UUID;
  n INTEGER;
BEGIN
  -- ---- fixtures ----
  INSERT INTO auth.users (email) VALUES
    ('owner@phc-sa.com'),('sm@phc-sa.com'),('bd@phc-sa.com'),
    ('admin@phc-sa.com'),('other@phc-sa.com');
  SELECT id INTO u_owner FROM auth.users WHERE email='owner@phc-sa.com';
  SELECT id INTO u_sm    FROM auth.users WHERE email='sm@phc-sa.com';
  SELECT id INTO u_bd    FROM auth.users WHERE email='bd@phc-sa.com';
  SELECT id INTO u_admin FROM auth.users WHERE email='admin@phc-sa.com';
  SELECT id INTO u_other FROM auth.users WHERE email='other@phc-sa.com';

  -- profiles rows are created by the on-auth-user trigger; just activate them.
  UPDATE public.profiles SET status='active'
   WHERE id IN (u_owner, u_sm, u_bd, u_admin, u_other);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_owner,'salesperson'), (u_sm,'sales_manager'),
    (u_bd,'bd_manager'), (u_admin,'system_admin');

  -- Act as a third party so emit_notification's self-skip does not swallow
  -- notifications aimed at the owner.
  PERFORM set_config('test.uid', u_other::text, false);

  -- ===== 1. Intake review fans out to reviewers, and only to reviewers =====
  -- Intake lives on inbox_items: the Phase 2 gate runs before an opportunity
  -- exists, which is the point of the gate.
  INSERT INTO public.inbox_items (project_name, assigned_owner_id, review_state, request_type, source_type)
  VALUES ('T1 Intake', u_owner, 'pending_review', 'jih', 'manual_rfq') RETURNING id INTO i_id;

  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='intake_review_requested' AND entity_id=i_id;
  RAISE NOTICE '%  1. intake_review_requested fans out to reviewers (expect 2: sm+bd, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='intake_review_requested' AND entity_id=i_id AND recipient_user_id=u_admin;
  RAISE NOTICE '%  2. system_admin gets NO intake review notification (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 2. Dedupe: the same state does not re-notify =====
  UPDATE public.inbox_items SET project_name='T1 Intake (renamed)' WHERE id=i_id;
  UPDATE public.inbox_items SET review_state='pending_review' WHERE id=i_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='intake_review_requested' AND entity_id=i_id;
  RAISE NOTICE '%  3. re-saving the same state does not spam (still 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 3. A meaningful state change DOES notify =====
  -- Review decisions must be taken by a reviewer — the Phase 2 governance
  -- trigger rejects anyone else, which is itself exercised here.
  PERFORM set_config('test.uid', u_sm::text, false);
  UPDATE public.inbox_items
     SET review_state='need_information', info_responsible_id=u_owner,
         info_comment='Send the BOQ', info_requested_at=now()
   WHERE id=i_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='intake_need_information' AND recipient_user_id=u_owner;
  RAISE NOTICE '%  4. need_information notifies the responsible user (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The requester resubmits, not the reviewer.
  PERFORM set_config('test.uid', u_owner::text, false);
  UPDATE public.inbox_items
     SET review_state='pending_review', resubmit_count=1, resubmitted_at=now()
   WHERE id=i_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='intake_review_requested' AND entity_id=i_id;
  RAISE NOTICE '%  5. resubmission raises a NEW review notification (expect 4, got %)',
    CASE WHEN n=4 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.notifications WHERE notification_type='intake_resubmitted';
  RAISE NOTICE '%  6. intake_resubmitted reaches the reviewers (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', u_sm::text, false);
  UPDATE public.inbox_items SET review_state='approved_for_pricing', reviewed_at=now() WHERE id=i_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='intake_approved' AND recipient_user_id=u_owner;
  RAISE NOTICE '%  7. intake_approved reaches the owner (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 4. Stage and handoff =====
  -- Stage moves run as the service role in production (sales-os-api); the
  -- protect_commercial_stage guard rejects ordinary users, so mirror that.
  PERFORM set_config('test.uid', '', false);
  INSERT INTO public.opportunities (project_name, owner_id)
  VALUES ('T1 Opportunity', u_owner) RETURNING id INTO o_id;
  UPDATE public.opportunities SET sales_stage='jih' WHERE id=o_id;
  UPDATE public.opportunities SET sales_stage='jih_bafo' WHERE id=o_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='stage_changed' AND entity_id=o_id;
  RAISE NOTICE '%  8. two distinct stage moves = two notifications (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  UPDATE public.opportunities SET sales_stage='jih' WHERE id=o_id;
  UPDATE public.opportunities SET sales_stage='jih_bafo' WHERE id=o_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='stage_changed' AND entity_id=o_id;
  RAISE NOTICE '%  9. revisiting the same stages does not spam (still 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  UPDATE public.opportunities SET commercial_handoff_status='with_commercial' WHERE id=o_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='handoff_changed' AND entity_id=o_id;
  RAISE NOTICE '% 10. handoff change notifies the owner (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 5. No echo of your own action =====
  UPDATE public.opportunities SET owner_id=u_sm WHERE id=o_id;
  PERFORM set_config('test.uid', u_sm::text, false);
  UPDATE public.opportunities SET sales_stage='under_negotiation' WHERE id=o_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='stage_changed' AND entity_id=o_id AND recipient_user_id=u_sm;
  RAISE NOTICE '% 11. moving your own deal gives you no echo (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='assigned' AND recipient_user_id=u_sm AND entity_id=o_id;
  RAISE NOTICE '% 12. reassignment notifies the new owner (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', u_other::text, false);

  -- ===== 6. Approvals =====
  INSERT INTO public.approvals (approval_type, related_opportunity_id, requested_by, assigned_approver, status)
  VALUES ('owner_grant', o_id, u_owner, u_sm, 'pending') RETURNING id INTO a_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='approval_requested' AND recipient_user_id=u_sm;
  RAISE NOTICE '% 13. approval_requested reaches the approver (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  UPDATE public.approvals SET status='approved', decided_at=now() WHERE id=a_id;
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='approval_approved' AND recipient_user_id=u_owner;
  RAISE NOTICE '% 14. the decision returns to the requester (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 7. Suspended recipients =====
  UPDATE public.profiles SET status='suspended' WHERE id=u_bd;
  INSERT INTO public.inbox_items (project_name, assigned_owner_id, review_state, request_type, source_type)
  VALUES ('T2 Intake', u_owner, 'pending_review', 'jih', 'manual_rfq');
  SELECT count(*) INTO n FROM public.notifications
   WHERE notification_type='intake_review_requested' AND recipient_user_id=u_bd AND title='T2 Intake';
  RAISE NOTICE '% 15. a suspended user accrues nothing new (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- notification triggers: done ---';
END $$;
