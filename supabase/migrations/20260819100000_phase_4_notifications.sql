-- =========================================================
-- Phase 4 — Notifications as an independent domain entity
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- Until now "notifications" were derived at read time by useNotifications.ts:
-- it queried opportunity_flags + approvals and rendered whatever was currently
-- open. That conflates two different questions the PRD separates:
--
--   Action       "what needs to be done"   — a standing condition
--   Notification "what happened"           — a point-in-time event
--
-- A derived list cannot answer the second. It has no read/unread (the same row
-- reappears every session), it cannot record an event whose condition has since
-- cleared (an approval decided yesterday leaves no trace), and it cannot be
-- deduplicated, because there is no row to compare against. So notifications
-- become a real table with recipient isolation, read/dismiss state, and a
-- dedupe key.
--
-- Actions keep their existing homes (opportunity_flags, tasks, follow_ups,
-- approvals, the intake gate). Nothing here replaces them — src/lib/action-center.ts
-- projects those five sources into one read model. This table is only for events.
--
-- DEDUPLICATION
-- -------------
-- Modelled on the `condition_key` fingerprint already proven on
-- opportunity_flags (20260806100000): identify the *occurrence*, not the type.
-- `dedupe_key` carries the state that made the event true. While that state is
-- unchanged the event is the same occurrence and is not re-raised, whatever the
-- user has done with it. When the state changes — a new stage, a new decision,
-- a new assignee — the key changes and a fresh notification is correct.
--
-- This is what stops the daily-spam failure mode the PRD calls out: a standing
-- condition like "opportunity is stalled" fingerprints to the same key on every
-- run, so it notifies once, not once per day.
--
-- ⚠️ DEPLOY ORDER: apply this migration BEFORE deploying the Phase 4 frontend.
-- useNotifications() selects from public.notifications on every authenticated
-- page load. Without the table the query 404s. It degrades rather than crashes
-- (react-query returns an error, the bell renders as empty), but every session
-- would retry a failing request, so the ordering is not optional.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Table ============
CREATE TABLE IF NOT EXISTS public.notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type   TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  entity_id           UUID,
  title               TEXT NOT NULL,
  body                TEXT,
  severity            TEXT NOT NULL DEFAULT 'info',
  source_event        TEXT NOT NULL,
  source_event_id     UUID,
  dedupe_key          TEXT NOT NULL,
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at             TIMESTAMPTZ,
  dismissed_at        TIMESTAMPTZ,

  CONSTRAINT notifications_severity_check
    CHECK (severity IN ('info', 'attention', 'critical')),
  CONSTRAINT notifications_entity_type_check
    CHECK (entity_type IN ('opportunity','rfq','tender','approval','quotation','inbox_item','system'))
);

COMMENT ON TABLE public.notifications IS
  'Point-in-time events addressed to one user. Distinct from actions (opportunity_flags/tasks/follow_ups/approvals/intake gate), which are standing conditions projected by src/lib/action-center.ts.';
COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Fingerprint of the state that raised this event. Same (recipient, type, entity, key) = same occurrence = do not raise again. Change the state, change the key, get a new notification. Same idea as opportunity_flags.condition_key.';
COMMENT ON COLUMN public.notifications.source_event IS
  'The domain event that produced this row (e.g. intake_review_requested). Kept separate from notification_type so one event can fan out to recipients who each see a different framing.';

-- ============ 2. Deduplication ============
-- The whole anti-spam guarantee is this index. Enforced in the database, not in
-- the emitting function, so a future writer that forgets the check cannot
-- reintroduce daily duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe
    ON public.notifications (recipient_user_id, notification_type, entity_type, entity_id, dedupe_key);

-- ============ 3. Read-path indexes ============
-- The bell polls unread-count on every page; keep it a partial index scan.
CREATE INDEX IF NOT EXISTS notifications_unread
    ON public.notifications (recipient_user_id, created_at DESC)
 WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_recent
    ON public.notifications (recipient_user_id, created_at DESC)
 WHERE dismissed_at IS NULL;

-- ============ 4. RLS — strict recipient isolation ============
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Read: your own only. Deliberately NOT is_active_user() (the convention on
-- shared tables like tasks) — a notification is addressed to one person, and
-- "every active user may read" would expose every other user's inbox.
-- No admin bypass either: platform administration is not a reason to read
-- someone's notifications, consistent with Phase 1 governance.
DROP POLICY IF EXISTS "Notifications readable by recipient" ON public.notifications;
CREATE POLICY "Notifications readable by recipient"
  ON public.notifications FOR SELECT
  USING (recipient_user_id = (SELECT auth.uid()));

-- Update: recipient only, and only the read/dismiss fields matter. WITH CHECK
-- repeats the predicate so a row cannot be handed to another user.
DROP POLICY IF EXISTS "Notifications updatable by recipient" ON public.notifications;
CREATE POLICY "Notifications updatable by recipient"
  ON public.notifications FOR UPDATE
  USING (recipient_user_id = (SELECT auth.uid()))
  WITH CHECK (recipient_user_id = (SELECT auth.uid()));

-- No INSERT or DELETE policy on purpose. Rows are written only by
-- emit_notification() (SECURITY DEFINER, called from triggers), so a client
-- cannot forge a notification to another user or delete its own audit trail.
-- Users hide rows with dismissed_at, which the UPDATE policy already allows.

-- A recipient must not be able to rewrite the content of a notification while
-- "marking it read" — the UPDATE policy cannot express column-level limits, so
-- pin the immutable fields here.
CREATE OR REPLACE FUNCTION public.protect_notification_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Triggered writes run as the definer with no auth.uid(); leave those alone.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.source_event IS DISTINCT FROM OLD.source_event
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Only read_at and dismissed_at may be changed on a notification'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_notification_content ON public.notifications;
CREATE TRIGGER trg_protect_notification_content
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.protect_notification_content();

-- ============ 5. Emitter ============
-- Single writer. Every event path goes through here so the dedupe contract and
-- the "never notify yourself about your own action" rule are enforced once.
CREATE OR REPLACE FUNCTION public.emit_notification(
  _recipient        UUID,
  _type             TEXT,
  _entity_type      TEXT,
  _entity_id        UUID,
  _title            TEXT,
  _body             TEXT,
  _severity         TEXT,
  _source_event     TEXT,
  _dedupe_key       TEXT,
  _metadata         JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id UUID;
BEGIN
  IF _recipient IS NULL THEN
    RETURN NULL;
  END IF;

  -- Do not notify someone about something they just did themselves. Without
  -- this every actor gets an echo of their own click, which trains people to
  -- ignore the bell.
  IF _recipient = auth.uid() THEN
    RETURN NULL;
  END IF;

  -- Deactivated accounts keep their history but stop accruing new items.
  IF NOT public.is_active_user(_recipient) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    recipient_user_id, notification_type, entity_type, entity_id,
    title, body, severity, source_event, dedupe_key, metadata
  )
  VALUES (
    _recipient, _type, _entity_type, _entity_id,
    _title, _body, COALESCE(_severity, 'info'), _source_event, _dedupe_key, _metadata
  )
  ON CONFLICT (recipient_user_id, notification_type, entity_type, entity_id, dedupe_key)
  DO NOTHING
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_notification(UUID,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;

COMMENT ON FUNCTION public.emit_notification IS
  'The only writer of public.notifications. Skips self-notification, inactive recipients, and duplicates (ON CONFLICT on the dedupe index). Not granted to clients — trigger use only.';

-- Fan-out to everyone holding any of the given roles. Used where the recipient
-- is defined by authority rather than by a column (intake review is assigned to
-- a role, not a person).
CREATE OR REPLACE FUNCTION public.emit_notification_to_roles(
  _roles            public.app_role[],
  _type             TEXT,
  _entity_type      TEXT,
  _entity_id        UUID,
  _title            TEXT,
  _body             TEXT,
  _severity         TEXT,
  _source_event     TEXT,
  _dedupe_key       TEXT,
  _metadata         JSONB DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid   UUID;
  _count INTEGER := 0;
BEGIN
  FOR _uid IN
    SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = ANY(_roles)
  LOOP
    IF public.emit_notification(
         _uid, _type, _entity_type, _entity_id, _title, _body,
         _severity, _source_event, _dedupe_key, _metadata
       ) IS NOT NULL
    THEN
      _count := _count + 1;
    END IF;
  END LOOP;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_notification_to_roles(public.app_role[],TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;

-- ============ 6a. Event: intake lifecycle (inbox_items) ============
-- The Phase 2 intake gate lives on inbox_items, not opportunities: a request is
-- reviewed *before* it becomes an opportunity, which is the whole point of the
-- gate. So the intake events are triggered here.
CREATE OR REPLACE FUNCTION public.notify_inbox_intake_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name TEXT := COALESCE(NEW.project_name, NEW.company_name, 'New request');
BEGIN
  -- ---- Intake review requested → the reviewers (role-derived) --------------
  -- system_admin is absent by design: reviewing intake is commercial judgement
  -- (Phase 1 governance, mirrored by can_review_intake).
  IF NEW.review_state = 'pending_review'
     AND (TG_OP = 'INSERT' OR OLD.review_state IS DISTINCT FROM NEW.review_state)
  THEN
    PERFORM public.emit_notification_to_roles(
      ARRAY['sales_manager','bd_manager','general_manager','managing_director','ceo']::public.app_role[],
      'intake_review_requested', 'inbox_item', NEW.id,
      _name, 'A new request is waiting for intake review.',
      'attention', 'intake_review_requested',
      -- Fingerprint includes resubmit_count so a genuine resubmission raises a
      -- new notification while a no-op re-save does not.
      'pending_review:' || COALESCE(NEW.resubmit_count, 0)::TEXT,
      jsonb_build_object('request_type', NEW.request_type)
    );
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.review_state IS DISTINCT FROM NEW.review_state THEN
    -- ---- Need information → whoever must supply it -------------------------
    IF NEW.review_state = 'need_information' THEN
      PERFORM public.emit_notification(
        COALESCE(NEW.info_responsible_id, NEW.assigned_owner_id, NEW.created_by),
        'intake_need_information', 'inbox_item', NEW.id,
        _name, COALESCE(NEW.info_comment, 'Information was requested on this request.'),
        'attention', 'intake_need_information',
        'need_information:' || COALESCE(NEW.info_requested_at, NEW.updated_at, now())::TEXT,
        jsonb_build_object('due', NEW.info_due_date)
      );
    END IF;

    -- ---- Approved for pricing → the requester/owner ------------------------
    IF NEW.review_state = 'approved_for_pricing' THEN
      PERFORM public.emit_notification(
        COALESCE(NEW.assigned_owner_id, NEW.created_by),
        'intake_approved', 'inbox_item', NEW.id,
        _name, 'Approved for pricing.',
        'info', 'intake_approved',
        'approved:' || COALESCE(NEW.reviewed_at, NEW.updated_at, now())::TEXT,
        NULL
      );
    END IF;

    -- ---- Rejected → the requester/owner ------------------------------------
    IF NEW.review_state = 'rejected' THEN
      PERFORM public.emit_notification(
        COALESCE(NEW.assigned_owner_id, NEW.created_by),
        'intake_rejected', 'inbox_item', NEW.id,
        _name, COALESCE(NEW.reject_reason, 'This request was rejected.'),
        'attention', 'intake_rejected',
        'rejected:' || COALESCE(NEW.reviewed_at, NEW.updated_at, now())::TEXT,
        NULL
      );
    END IF;
  END IF;

  -- ---- Intake resubmitted → the reviewers ---------------------------------
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.resubmit_count, 0) > COALESCE(OLD.resubmit_count, 0)
  THEN
    PERFORM public.emit_notification_to_roles(
      ARRAY['sales_manager','bd_manager','general_manager','managing_director','ceo']::public.app_role[],
      'intake_resubmitted', 'inbox_item', NEW.id,
      _name, 'The requester supplied the information asked for.',
      'attention', 'intake_resubmitted',
      'resubmitted:' || NEW.resubmit_count::TEXT,
      NULL
    );
  END IF;

  -- ---- Intake assigned → the new owner ------------------------------------
  IF TG_OP = 'UPDATE'
     AND OLD.assigned_owner_id IS DISTINCT FROM NEW.assigned_owner_id
     AND NEW.assigned_owner_id IS NOT NULL
  THEN
    PERFORM public.emit_notification(
      NEW.assigned_owner_id,
      'intake_assigned', 'inbox_item', NEW.id,
      _name, 'This request was assigned to you.',
      'attention', 'intake_assigned',
      'assigned:' || NEW.assigned_owner_id::TEXT,
      NULL
    );
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_inbox_intake_events ON public.inbox_items;
CREATE TRIGGER trg_notify_inbox_intake_events
  AFTER INSERT OR UPDATE ON public.inbox_items
  FOR EACH ROW EXECUTE FUNCTION public.notify_inbox_intake_events();

-- ============ 6b. Event: opportunity lifecycle ============
-- Sales stage change, commercial handoff change, and reassignment.
CREATE OR REPLACE FUNCTION public.notify_opportunity_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name TEXT := COALESCE(NEW.project_name, 'Untitled');
BEGIN
  -- ---- Sales stage changed → the owner ------------------------------------
  IF TG_OP = 'UPDATE' AND OLD.sales_stage IS DISTINCT FROM NEW.sales_stage THEN
    PERFORM public.emit_notification(
      NEW.owner_id,
      'stage_changed', 'opportunity', NEW.id,
      _name,
      'Stage moved to ' || COALESCE(NEW.sales_stage::TEXT, 'unset') || '.',
      CASE WHEN NEW.sales_stage IN ('won','lost') THEN 'attention' ELSE 'info' END,
      'stage_changed',
      -- Keyed on the destination: moving jih→jih_bafo→jih notifies twice,
      -- which is correct, but a repeated write of the same stage does not.
      'stage:' || COALESCE(NEW.sales_stage::TEXT, 'null'),
      jsonb_build_object('from', OLD.sales_stage, 'to', NEW.sales_stage)
    );
  END IF;

  -- ---- Commercial handoff changed → the owner ------------------------------
  IF TG_OP = 'UPDATE'
     AND OLD.commercial_handoff_status IS DISTINCT FROM NEW.commercial_handoff_status
  THEN
    PERFORM public.emit_notification(
      NEW.owner_id,
      'handoff_changed', 'opportunity', NEW.id,
      _name,
      'Commercial handoff is now ' || COALESCE(NEW.commercial_handoff_status, 'unset') || '.',
      'info', 'handoff_changed',
      'handoff:' || COALESCE(NEW.commercial_handoff_status, 'null'),
      jsonb_build_object('from', OLD.commercial_handoff_status, 'to', NEW.commercial_handoff_status)
    );
  END IF;

  -- ---- Reassigned → the new owner -----------------------------------------
  IF TG_OP = 'UPDATE'
     AND OLD.owner_id IS DISTINCT FROM NEW.owner_id
     AND NEW.owner_id IS NOT NULL
  THEN
    PERFORM public.emit_notification(
      NEW.owner_id,
      'assigned', 'opportunity', NEW.id,
      _name, 'This opportunity was assigned to you.',
      'attention', 'assignment_changed',
      'assigned:' || NEW.owner_id::TEXT,
      NULL
    );
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_opportunity_events ON public.opportunities;
CREATE TRIGGER trg_notify_opportunity_events
  -- UPDATE only: every event here is a transition (stage moved, handoff moved,
  -- owner changed). A freshly inserted row has not transitioned.
  AFTER UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.notify_opportunity_events();

-- ============ 7. Event: approvals ============
CREATE OR REPLACE FUNCTION public.notify_approval_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _label TEXT := COALESCE(NEW.approval_type, 'Approval');
BEGIN
  -- Requested → the assigned approver
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    PERFORM public.emit_notification(
      NEW.assigned_approver,
      'approval_requested', 'approval', NEW.id,
      _label, 'A decision is waiting for you.',
      'attention', 'approval_requested',
      'requested:' || NEW.id::TEXT,
      jsonb_build_object('opportunity_id', NEW.related_opportunity_id)
    );
  END IF;

  -- Decided → back to whoever asked
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('approved','returned','escalated')
  THEN
    PERFORM public.emit_notification(
      NEW.requested_by,
      CASE WHEN NEW.status = 'approved' THEN 'approval_approved' ELSE 'approval_rejected' END,
      'approval', NEW.id,
      _label,
      COALESCE(NEW.decision_notes, 'Your request was ' || NEW.status || '.'),
      CASE WHEN NEW.status = 'approved' THEN 'info' ELSE 'attention' END,
      'approval_decided',
      'decided:' || NEW.status::TEXT || ':' || COALESCE(NEW.decided_at, now())::TEXT,
      jsonb_build_object('opportunity_id', NEW.related_opportunity_id)
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_approval_events ON public.approvals;
CREATE TRIGGER trg_notify_approval_events
  AFTER INSERT OR UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.notify_approval_events();

-- ============ 8. Event: item became overdue ============
-- Not a trigger: nothing writes to a row at the moment it becomes late. This is
-- called by the scheduled automation run. The dedupe key is the due date, so an
-- item that stays overdue for a month still notifies exactly once — and if it
-- is rescheduled and goes late again, the new date is a new occurrence.
CREATE OR REPLACE FUNCTION public.notify_overdue_items()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r      RECORD;
  _count  INTEGER := 0;
BEGIN
  FOR _r IN
    SELECT f.id, f.action_owner_id AS owner_id, f.due_date, f.reason,
           f.linked_record_id, f.priority
      FROM public.opportunity_flags f
     WHERE f.due_date < CURRENT_DATE
       AND f.status IN ('open','in_progress','escalated','blocked')
       AND f.action_owner_id IS NOT NULL
       -- Only tier A/B become notifications; C would be noise.
       AND f.priority IN ('A','B')
  LOOP
    IF public.emit_notification(
         _r.owner_id, 'item_overdue', 'opportunity', _r.linked_record_id,
         COALESCE(_r.reason, 'Action overdue'),
         'This action passed its due date on ' || _r.due_date::TEXT || '.',
         'critical', 'item_became_overdue',
         'overdue:' || _r.id::TEXT || ':' || _r.due_date::TEXT,
         NULL
       ) IS NOT NULL
    THEN
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_overdue_items() FROM PUBLIC;

COMMENT ON FUNCTION public.notify_overdue_items IS
  'Emits item_overdue notifications for late tier A/B flags. Call from the scheduled automation run. Idempotent: the dedupe key is (flag id, due date), so a standing overdue item notifies once, not once per run.';

-- ============ 9. Client-callable read-state helpers ============
-- The UPDATE policy already permits these, but going through RPCs keeps the
-- "only read_at/dismissed_at" rule in one place and gives the client a single
-- round trip for mark-all-read.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER          -- RLS applies: you can only touch your own rows
SET search_path = public
AS $$
DECLARE _n INTEGER;
BEGIN
  UPDATE public.notifications
     SET read_at = now()
   WHERE id = ANY(_ids)
     AND recipient_user_id = auth.uid()
     AND read_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE _n INTEGER;
BEGIN
  UPDATE public.notifications
     SET read_at = now()
   WHERE recipient_user_id = auth.uid()
     AND read_at IS NULL
     AND dismissed_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_notification(_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE _n INTEGER;
BEGIN
  UPDATE public.notifications
     SET dismissed_at = now(),
         read_at = COALESCE(read_at, now())
   WHERE id = _id
     AND recipient_user_id = auth.uid();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_notification(UUID) TO authenticated;
