-- =============================================================================
-- Phase 4 — notification RLS and read-state behaviour.
--
-- Runs AFTER phase4_notifications.sql (it needs rows to exist), as the
-- non-superuser role `rls_tester`, because RLS does not apply to the table
-- owner. Without that role switch these tests would pass vacuously.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- A definer helper so a test can learn the id of a row it must NOT be able to
-- touch. Reading it here is deliberate: the point is to try the write and be
-- refused, which needs a real target id.
CREATE OR REPLACE FUNCTION public.peek_other_notification(_uid uuid)
RETURNS TABLE(id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT n.id FROM public.notifications n
    WHERE n.recipient_user_id = _uid AND n.dismissed_at IS NULL LIMIT 1 $$;

SELECT id AS uid_sm  FROM auth.users WHERE email='sm@phc-sa.com'    \gset
SELECT id AS uid_own FROM auth.users WHERE email='owner@phc-sa.com' \gset

SET ROLE rls_tester;

-- ---- 1. Recipient isolation ------------------------------------------------
SELECT set_config('test.uid', :'uid_sm', false);

SELECT CASE WHEN count(*) FILTER (WHERE recipient_user_id <> :'uid_sm'::uuid) = 0
              AND count(*) > 0
            THEN 'PASS' ELSE 'FAIL' END
       || ' 16. a user reads only their own notifications (visible=' || count(*)
       || ', foreign=' || count(*) FILTER (WHERE recipient_user_id <> :'uid_sm'::uuid) || ')'
  FROM public.notifications;

SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
       || ' 17. cross-user read is denied (other user''s rows seen=' || count(*) || ')'
  FROM public.notifications WHERE recipient_user_id = :'uid_own'::uuid;

-- ---- 2. Cross-user write is denied -----------------------------------------
DO $$
DECLARE _own UUID; _n INTEGER;
BEGIN
  SELECT id INTO _own FROM auth.users WHERE email='owner@phc-sa.com';
  UPDATE public.notifications SET read_at = now() WHERE recipient_user_id = _own;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE '% 18. cannot mark another user''s notification read (rows affected=%, expect 0)',
    CASE WHEN _n = 0 THEN 'PASS' ELSE 'FAIL' END, _n;
END $$;

-- ---- 3. Forging a notification is denied -----------------------------------
DO $$
DECLARE _own UUID; _ok BOOLEAN := false;
BEGIN
  SELECT id INTO _own FROM auth.users WHERE email='owner@phc-sa.com';
  BEGIN
    INSERT INTO public.notifications
      (recipient_user_id, notification_type, entity_type, entity_id, title,
       severity, source_event, dedupe_key)
    VALUES (_own, 'forged', 'system', NULL, 'Forged', 'info', 'forged', 'x');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN _ok := true;
  END;
  RAISE NOTICE '% 19. a client cannot insert a notification (blocked=%)',
    CASE WHEN _ok THEN 'PASS' ELSE 'FAIL' END, _ok;
END $$;

-- ---- 4. Content is immutable; only read/dismiss may change -----------------
DO $$
DECLARE _id UUID; _sm UUID; _ok BOOLEAN := false; _n INTEGER;
BEGIN
  SELECT id INTO _sm FROM auth.users WHERE email='sm@phc-sa.com';
  PERFORM set_config('test.uid', _sm::text, false);
  SELECT id INTO _id FROM public.notifications LIMIT 1;

  BEGIN
    UPDATE public.notifications SET title = 'rewritten' WHERE id = _id;
  EXCEPTION WHEN check_violation THEN _ok := true;
  END;
  RAISE NOTICE '% 20. the recipient cannot rewrite the content (blocked=%)',
    CASE WHEN _ok THEN 'PASS' ELSE 'FAIL' END, _ok;

  UPDATE public.notifications SET read_at = now() WHERE id = _id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE '% 21. the recipient CAN mark their own read (rows=%)',
    CASE WHEN _n = 1 THEN 'PASS' ELSE 'FAIL' END, _n;
END $$;

-- ---- 5. Read-state RPCs -----------------------------------------------------
DO $$
DECLARE _sm UUID; _before INTEGER; _after INTEGER; _n INTEGER; _id UUID; _ok BOOLEAN;
BEGIN
  SELECT id INTO _sm FROM auth.users WHERE email='sm@phc-sa.com';
  PERFORM set_config('test.uid', _sm::text, false);

  SELECT count(*) INTO _before FROM public.notifications
   WHERE read_at IS NULL AND dismissed_at IS NULL;
  SELECT public.mark_all_notifications_read() INTO _n;
  SELECT count(*) INTO _after FROM public.notifications
   WHERE read_at IS NULL AND dismissed_at IS NULL;
  RAISE NOTICE '% 22. mark_all_notifications_read clears unread (% -> %, marked %)',
    CASE WHEN _after = 0 AND _n = _before THEN 'PASS' ELSE 'FAIL' END, _before, _after, _n;

  SELECT id INTO _id FROM public.notifications WHERE dismissed_at IS NULL LIMIT 1;
  SELECT public.dismiss_notification(_id) INTO _ok;
  SELECT count(*) INTO _n FROM public.notifications WHERE id = _id AND dismissed_at IS NOT NULL;
  RAISE NOTICE '% 23. dismiss_notification hides the row (returned=%, dismissed=%)',
    CASE WHEN _ok AND _n = 1 THEN 'PASS' ELSE 'FAIL' END, _ok, _n;
END $$;

-- ---- 6. Dismissing someone else's notification does nothing ----------------
DO $$
DECLARE _sm UUID; _own UUID; _victim UUID; _ok BOOLEAN;
BEGIN
  SELECT id INTO _sm  FROM auth.users WHERE email='sm@phc-sa.com';
  SELECT id INTO _own FROM auth.users WHERE email='owner@phc-sa.com';
  PERFORM set_config('test.uid', _sm::text, false);
  SELECT id INTO _victim FROM public.peek_other_notification(_own);
  SELECT public.dismiss_notification(_victim) INTO _ok;
  RAISE NOTICE '% 24. cannot dismiss another user''s notification (returned=%, expect false)',
    CASE WHEN _ok IS NOT TRUE THEN 'PASS' ELSE 'FAIL' END, _ok;
END $$;

RESET ROLE;
