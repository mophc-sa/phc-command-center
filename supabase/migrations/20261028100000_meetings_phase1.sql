-- =============================================================================
-- Meetings, phase 1: every meeting ends in decided tasks tied to a deal.
--
-- Measured 2026-10-22: 6 meetings, 74 action items, 0 approved, 59 pending.
-- The module worked; the workflow did not. Three gaps, and Mo's four decisions
-- (spec docs/superpowers/specs/2026-10-22-meetings-phase1-scope.md):
--
-- 1. Meetings arrive from one Fireflies account only. Each salesperson now
--    saves their own Fireflies API key in Settings. It is kept in Vault
--    (fireflies_connections, service role only, like Outlook's refresh token),
--    and pg_cron asks meetings-inbound every 30 minutes to pull each connected
--    person's recent meetings. The webhook and "Fetch from Fireflies" stay.
-- 2. Nobody is told a meeting arrived. ingest_meeting now notifies the people
--    who can decide its items; a daily digest repeats the count; the Work
--    Queue and My Day read meeting_review_queue().
-- 3. Only management reviews. The person who organised or attended a meeting
--    now decides the items suggested to them (the organiser also decides the
--    unassigned ones); managers keep full review (can_decide_meeting_item).
--
-- Also: a default due date three Saudi business days out (Sun–Thu); a deal
-- suggested from the project names in the summary, confirmed by a reviewer;
-- the summary written to the deal's update log on approval; items undecided
-- for 14 days dismissed with a reason and the meeting owner told — and, for
-- the 59 already waiting, a one-week window to review them before that rule
-- reaches them.
-- =============================================================================

-- ============ 1. Columns ============
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS connected_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.meetings.connected_user_id IS
  'Whose own Fireflies account this meeting was pulled from. That person reads it and decides the items suggested to them.';
COMMENT ON COLUMN public.meetings.suggested_opportunity_id IS
  'A deal whose project name or RFQ number appears in the title or summary. Only a suggestion: related_opportunity_id is set when a reviewer confirms.';

-- When an undecided item is dismissed by itself. New items get 14 days; the
-- items already waiting get one week from this migration (the clean-up window).
ALTER TABLE public.meeting_action_items
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
UPDATE public.meeting_action_items
   SET expires_at = CASE WHEN status = 'pending' THEN greatest(created_at + interval '14 days', now() + interval '7 days')
                         ELSE created_at + interval '14 days' END
 WHERE expires_at IS NULL;
ALTER TABLE public.meeting_action_items
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '14 days'),
  ALTER COLUMN expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS meeting_action_items_expiry_idx
  ON public.meeting_action_items (expires_at) WHERE status = 'pending';
COMMENT ON COLUMN public.meeting_action_items.expires_at IS
  'A pending item still undecided at this time is dismissed by run_meetings_daily, with a reason.';

-- The deal's update log (20261022100000) gets one entry per meeting.
ALTER TABLE public.opportunity_updates
  ADD COLUMN IF NOT EXISTS meeting_id UUID REFERENCES public.meetings(id) ON DELETE SET NULL;
ALTER TABLE public.opportunity_updates DROP CONSTRAINT IF EXISTS opportunity_updates_kind_check;
ALTER TABLE public.opportunity_updates ADD CONSTRAINT opportunity_updates_kind_check CHECK (kind IN (
  'offer_sent', 'revised_offer_sent', 'po_received', 'contract_signed',
  'awaiting_payment', 'payment_received', 'awaiting_client', 'site_visit',
  'progress_update', 'other', 'meeting_summary'));
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_updates_meeting_key
  ON public.opportunity_updates (opportunity_id, meeting_id) WHERE meeting_id IS NOT NULL;

-- Notifications may now point at a meeting. 'company' is listed too so this
-- check is a superset of the samples/reminders migration whichever lands first.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('opportunity','rfq','tender','approval','quotation','inbox_item','system','task','company','meeting'));

-- ============ 2. Saudi business days ============
-- The working week is Sunday to Thursday; Friday and Saturday are skipped.
CREATE OR REPLACE FUNCTION public.add_business_days(_from date, _n integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE d date := _from; remaining integer := greatest(coalesce(_n, 0), 0);
BEGIN
  WHILE remaining > 0 LOOP
    d := d + 1;
    IF extract(isodow FROM d) NOT IN (5, 6) THEN remaining := remaining - 1; END IF;
  END LOOP;
  RETURN d;
END $$;
GRANT EXECUTE ON FUNCTION public.add_business_days(date, integer) TO authenticated, service_role;

-- ============ 3. Who was in a meeting, who decides what ============
-- In the meeting: the sign-in email is the organiser or a participant, or the
-- meeting came from the person's own Fireflies account.
CREATE OR REPLACE FUNCTION public.is_meeting_attendee(_meeting_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.meetings m
      JOIN auth.users u ON u.id = _user_id
     WHERE m.id = _meeting_id
       AND (m.connected_user_id = _user_id
            OR (u.email IS NOT NULL
                AND (lower(m.organizer_email) = lower(u.email)
                     -- Fireflies sometimes sends several addresses in one entry.
                     OR lower(u.email) = ANY (SELECT lower(btrim(x)) FROM unnest(m.participants) p,
                                                     unnest(string_to_array(p, ',')) x))))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_meeting_organizer(_meeting_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetings m JOIN auth.users u ON u.id = _user_id
     WHERE m.id = _meeting_id AND u.email IS NOT NULL AND lower(m.organizer_email) = lower(u.email)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_meeting(_meeting_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_review_meetings(_user_id)
    OR public.is_meeting_attendee(_meeting_id, _user_id)
    OR EXISTS (
      SELECT 1 FROM public.meeting_action_items i
       WHERE i.meeting_id = _meeting_id AND i.status = 'approved' AND i.owner_id = _user_id
    );
$$;

-- Managers decide every item. Anyone else decides an item of a meeting they
-- were in when it was suggested to them — or, for the organiser, when nobody
-- was suggested. Reading a meeting because one of its tasks is yours is not
-- enough (20261005100000).
CREATE OR REPLACE FUNCTION public.can_decide_meeting_item(_item_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    public.can_review_meetings(_user_id)
    OR (public.is_active_user(_user_id) AND EXISTS (
      SELECT 1 FROM public.meeting_action_items i
       WHERE i.id = _item_id
         AND public.is_meeting_attendee(i.meeting_id, _user_id)
         AND (i.suggested_owner_id = _user_id
              OR (i.suggested_owner_id IS NULL AND public.is_meeting_organizer(i.meeting_id, _user_id)))))
  );
$$;

REVOKE ALL ON FUNCTION public.is_meeting_attendee(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_meeting_organizer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_meeting(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_decide_meeting_item(uuid, uuid) FROM PUBLIC, anon;
-- The browser asks about itself through meeting_review_rights(); these take
-- any user id, so only the policies and the functions below call them.
REVOKE ALL ON FUNCTION public.is_meeting_attendee(uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.is_meeting_organizer(uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.can_decide_meeting_item(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_meeting(uuid, uuid) TO authenticated;

-- What the meeting page needs to draw the right controls for the caller.
CREATE OR REPLACE FUNCTION public.meeting_review_rights(_meeting_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.can_read_meeting(_meeting_id, auth.uid()) THEN NULL ELSE jsonb_build_object(
    'manager', public.can_review_meetings(auth.uid()),
    'organizer', public.is_meeting_organizer(_meeting_id, auth.uid()),
    'attendee', public.is_meeting_attendee(_meeting_id, auth.uid()),
    'decidable', coalesce((SELECT jsonb_agg(i.id) FROM public.meeting_action_items i
                            WHERE i.meeting_id = _meeting_id AND i.status = 'pending'
                              AND public.can_decide_meeting_item(i.id, auth.uid())), '[]'::jsonb)) END;
$$;
REVOKE ALL ON FUNCTION public.meeting_review_rights(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_review_rights(uuid) TO authenticated;

-- ============ 4. The deal a meeting is about ============
-- A project name (5+ characters) or an RFQ number that appears in the title,
-- summary or keywords. The longest name wins; a tie between two deals is no
-- suggestion — a reviewer picks.
CREATE OR REPLACE FUNCTION public.suggest_meeting_opportunity(_meeting_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE blob text; hits record; best uuid; best_len int; second_len int;
BEGIN
  SELECT lower(concat_ws(' ', m.title, m.summary_short, m.summary_overview, array_to_string(m.keywords, ' ')))
    INTO blob FROM public.meetings m WHERE m.id = _meeting_id;
  IF blob IS NULL OR btrim(blob) = '' THEN RETURN NULL; END IF;

  FOR hits IN
    SELECT o.id, length(btrim(o.project_name)) AS len
      FROM public.opportunities o
     WHERE length(btrim(coalesce(o.project_name, ''))) >= 5
       AND position(lower(btrim(o.project_name)) IN blob) > 0
    UNION ALL
    SELECT r.opportunity_id, length(r.rfq_number)
      FROM public.rfqs r
     WHERE r.opportunity_id IS NOT NULL AND length(coalesce(r.rfq_number, '')) >= 6
       AND position(lower(r.rfq_number) IN blob) > 0
     ORDER BY 2 DESC
     LIMIT 20
  LOOP
    IF best IS NULL THEN best := hits.id; best_len := hits.len;
    ELSIF hits.id <> best THEN second_len := hits.len; EXIT; END IF;
  END LOOP;

  IF best IS NOT NULL AND second_len IS NOT NULL AND second_len = best_len THEN RETURN NULL; END IF;
  RETURN best;
END $$;
REVOKE ALL ON FUNCTION public.suggest_meeting_opportunity(uuid) FROM PUBLIC, anon, authenticated;

-- The meeting's summary, once per deal, in that deal's update log.
CREATE OR REPLACE FUNCTION public.log_meeting_to_deal(_meeting_id uuid, _opportunity_id uuid, _actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF _opportunity_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.opportunity_updates (opportunity_id, kind, note, created_by, meeting_id)
  SELECT _opportunity_id, 'meeting_summary',
         left('Meeting / اجتماع: ' || m.title
              || coalesce(' (' || to_char(m.occurred_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || ')', '')
              || coalesce(E'\n' || nullif(btrim(coalesce(m.summary_short, m.summary_overview, '')), ''), ''), 4000),
         _actor, m.id
    FROM public.meetings m WHERE m.id = _meeting_id
  ON CONFLICT (opportunity_id, meeting_id) WHERE meeting_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.log_meeting_to_deal(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A reviewer (or someone who was in the meeting and can see the deal)
-- confirms or changes the deal. Pending items without a deal take it as their
-- pre-filled choice; the summary goes to the deal's update log.
CREATE OR REPLACE FUNCTION public.confirm_meeting_opportunity(_meeting_id uuid, _opportunity_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); manager boolean := public.can_review_meetings(auth.uid());
BEGIN
  IF u IS NULL OR NOT (manager OR (public.is_active_user(u) AND public.is_meeting_attendee(_meeting_id, u))) THEN
    RAISE EXCEPTION 'Only a reviewer or someone in the meeting can link it / فقط المراجع أو من حضر الاجتماع' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meetings WHERE id = _meeting_id) THEN
    RAISE EXCEPTION 'Meeting unavailable' USING ERRCODE = '42501'; END IF;
  IF _opportunity_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id = _opportunity_id) THEN
      RAISE EXCEPTION 'Opportunity not found' USING ERRCODE = '23503'; END IF;
    IF NOT manager AND NOT public.can_read_boq(_opportunity_id, u) THEN
      RAISE EXCEPTION 'Opportunity unavailable' USING ERRCODE = '42501'; END IF;
  END IF;

  UPDATE public.meetings SET related_opportunity_id = _opportunity_id WHERE id = _meeting_id;
  IF _opportunity_id IS NOT NULL THEN
    UPDATE public.meeting_action_items SET related_opportunity_id = _opportunity_id
     WHERE meeting_id = _meeting_id AND status = 'pending' AND related_opportunity_id IS NULL;
    PERFORM public.log_meeting_to_deal(_meeting_id, _opportunity_id, u);
  END IF;

  INSERT INTO public.audit_log(actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'meeting.deal_confirmed', 'meeting', _meeting_id, jsonb_build_object('opportunity_id', _opportunity_id));
  RETURN jsonb_build_object('ok', true, 'opportunity_id', _opportunity_id);
END $$;
REVOKE ALL ON FUNCTION public.confirm_meeting_opportunity(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_meeting_opportunity(uuid, uuid) TO authenticated;

-- ============ 5. Telling the people who decide ============
-- Everyone in the meeting with at least one item to decide. A meeting nobody
-- on the team can be matched to goes to the pipeline managers.
CREATE OR REPLACE FUNCTION public.notify_meeting_reviewers(_meeting_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.meetings; r uuid; total int; n int := 0; found_one boolean := false;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _meeting_id;
  SELECT count(*) INTO total FROM public.meeting_action_items WHERE meeting_id = _meeting_id AND status = 'pending';
  IF m.id IS NULL OR total = 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT p.id FROM public.profiles p
     WHERE p.status = 'active' AND NOT p.is_display_account
       AND public.is_meeting_attendee(_meeting_id, p.id)
       AND EXISTS (SELECT 1 FROM public.meeting_action_items i
                    WHERE i.meeting_id = _meeting_id AND i.status = 'pending'
                      AND public.can_decide_meeting_item(i.id, p.id))
  LOOP
    found_one := true;
    IF public.emit_notification(r, 'meeting_review_requested', 'meeting', _meeting_id,
         left(m.title, 200), total || ' action items await your decision',
         'attention', 'meeting_ingested', 'meeting_review:' || _meeting_id,
         jsonb_build_object('meeting_id', _meeting_id)) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;

  IF NOT found_one THEN
    FOR r IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role = ANY (ARRAY['managing_director','general_manager','ceo','sales_manager','bd_manager','sales_ops']::public.app_role[])
         AND p.status = 'active' AND NOT p.is_display_account
    LOOP
      IF public.emit_notification(r, 'meeting_review_requested', 'meeting', _meeting_id,
           left(m.title, 200), total || ' action items await review',
           'attention', 'meeting_ingested', 'meeting_review:' || _meeting_id,
           jsonb_build_object('meeting_id', _meeting_id)) IS NOT NULL THEN n := n + 1; END IF;
    END LOOP;
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.notify_meeting_reviewers(uuid) FROM PUBLIC, anon, authenticated;

-- ============ 6. Ingest (service role only) ============
-- As 20261001100000, plus: whose Fireflies account it came from, the
-- suggested deal, and the reviewers told.
CREATE OR REPLACE FUNCTION public.ingest_meeting(_meeting jsonb, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m_id uuid; conn uuid;
BEGIN
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) > 200 THEN
    RAISE EXCEPTION 'Action items must be an array of at most 200'; END IF;

  SELECT p.id INTO conn FROM public.profiles p
   WHERE p.id = (_meeting->>'connected_user_id')::uuid AND p.status = 'active';

  INSERT INTO public.meetings(provider, provider_meeting_id, title, occurred_at, duration_minutes,
    organizer_email, participants, summary_short, summary_overview, keywords, action_items_raw,
    transcript_url, status, connected_user_id)
  VALUES ('fireflies', _meeting->>'provider_meeting_id',
    left(coalesce(nullif(btrim(_meeting->>'title'),''),'Untitled meeting'),500),
    (_meeting->>'occurred_at')::timestamptz, (_meeting->>'duration_minutes')::numeric,
    _meeting->>'organizer_email',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(_meeting->'participants','[]'))),
    _meeting->>'summary_short', _meeting->>'summary_overview',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(_meeting->'keywords','[]'))),
    _meeting->>'action_items_raw', _meeting->>'transcript_url',
    CASE WHEN jsonb_array_length(_items) = 0 THEN 'reviewed' ELSE 'pending_review' END, conn)
  ON CONFLICT (provider, provider_meeting_id) DO NOTHING
  RETURNING id INTO m_id;

  IF m_id IS NULL THEN
    -- Already stored (from the webhook or someone else's account). A person
    -- whose own account also holds it was in it; nothing else changes.
    IF conn IS NOT NULL THEN
      UPDATE public.meetings SET connected_user_id = conn
       WHERE provider = 'fireflies' AND provider_meeting_id = _meeting->>'provider_meeting_id'
         AND connected_user_id IS NULL;
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  -- A suggested owner must be an active person; anything else is dropped to
  -- "no suggestion" rather than trusted.
  INSERT INTO public.meeting_action_items(meeting_id, position, speaker_label, title, at_seconds, suggested_owner_id, owner_id)
  SELECT m_id, (i.ord - 1)::int, left(i.item->>'speaker_label', 200), left(i.item->>'title', 500),
         (i.item->>'at_seconds')::int, s.id, s.id
    FROM jsonb_array_elements(_items) WITH ORDINALITY AS i(item, ord)
    LEFT JOIN public.profiles s
      ON s.id = (i.item->>'suggested_owner_id')::uuid AND s.status = 'active'
   WHERE btrim(coalesce(i.item->>'title','')) <> '';

  UPDATE public.meetings SET suggested_opportunity_id = public.suggest_meeting_opportunity(m_id) WHERE id = m_id;
  PERFORM public.notify_meeting_reviewers(m_id);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'meeting_id', m_id);
END $$;
REVOKE ALL ON FUNCTION public.ingest_meeting(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_meeting(jsonb, jsonb) TO service_role;

-- ============ 7. The human decision ============
-- As 20261001100000, with: the person in the meeting decides their own items
-- (and only assigns to themselves unless they organised it), a default due
-- date three business days out, and the summary in the deal's update log.
CREATE OR REPLACE FUNCTION public.decide_meeting_action_item(
  _id uuid, _action text, _title text DEFAULT NULL, _owner_id uuid DEFAULT NULL,
  _due_date date DEFAULT NULL, _opportunity_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it public.meeting_action_items; u uuid := auth.uid(); t_id uuid; t_title text; m_title text;
        manager boolean := public.can_review_meetings(auth.uid()); due date;
BEGIN
  IF _action IS NULL OR _action NOT IN ('approve','dismiss') THEN RAISE EXCEPTION 'Invalid decision'; END IF;

  SELECT * INTO it FROM public.meeting_action_items WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_decide_meeting_item(_id, u) THEN
    RAISE EXCEPTION 'Meeting review authority required / صلاحية مراجعة الاجتماعات مطلوبة' USING ERRCODE='42501'; END IF;

  IF it.status <> 'pending' THEN
    -- A double click or a retried request returns the first answer.
    IF it.decided_by = u AND it.status = (CASE _action WHEN 'approve' THEN 'approved' ELSE 'dismissed' END) THEN
      RETURN jsonb_build_object('ok',true,'status',it.status,'task_id',it.task_id,'replayed',true);
    END IF;
    RAISE EXCEPTION 'Action item already decided / تم البت في هذا البند مسبقاً' USING ERRCODE='23514';
  END IF;

  IF length(coalesce(_note,'')) > 2000 THEN RAISE EXCEPTION 'Decision note too long'; END IF;

  IF _action = 'dismiss' THEN
    IF btrim(coalesce(_note,'')) = '' THEN
      RAISE EXCEPTION 'Dismissal reason required / سبب الاستبعاد مطلوب' USING ERRCODE='23514'; END IF;
    UPDATE public.meeting_action_items SET status='dismissed', decided_by=u, decided_at=now(), decision_note=_note
     WHERE id=_id;
  ELSE
    t_title := btrim(coalesce(_title, it.title));
    IF t_title = '' OR length(t_title) > 500 THEN RAISE EXCEPTION 'Task title required (max 500)' USING ERRCODE='23514'; END IF;
    -- Never assign work to a guess: the reviewer must name a real, active person.
    IF _owner_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id=_owner_id AND status='active' AND NOT is_display_account) THEN
      RAISE EXCEPTION 'An active owner is required / يجب تحديد مسؤول نشط' USING ERRCODE='23514'; END IF;
    IF NOT manager AND _owner_id <> u AND NOT public.is_meeting_organizer(it.meeting_id, u) THEN
      RAISE EXCEPTION 'You can take your own items only; a manager or the organiser reassigns / يمكنك اعتماد بنودك لنفسك فقط' USING ERRCODE='42501'; END IF;
    IF _opportunity_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id=_opportunity_id) THEN
        RAISE EXCEPTION 'Opportunity not found' USING ERRCODE='23503'; END IF;
      IF NOT manager AND NOT public.can_read_boq(_opportunity_id, u) THEN
        RAISE EXCEPTION 'Opportunity unavailable' USING ERRCODE='42501'; END IF;
    END IF;

    due := coalesce(_due_date, public.add_business_days((now() AT TIME ZONE 'Asia/Riyadh')::date, 3));

    INSERT INTO public.tasks(title, related_opportunity_id, owner_id, due_date, created_by, source)
    VALUES (t_title, _opportunity_id, _owner_id, due, u, 'meeting_action:'||it.id)
    RETURNING id INTO t_id;

    UPDATE public.meeting_action_items
       SET status='approved', title=t_title, owner_id=_owner_id, due_date=due,
           related_opportunity_id=_opportunity_id, task_id=t_id,
           decided_by=u, decided_at=now(), decision_note=_note
     WHERE id=_id;

    SELECT title INTO m_title FROM public.meetings WHERE id=it.meeting_id;
    PERFORM public.emit_notification(_owner_id, 'meeting_task_assigned', 'task', t_id,
      left(t_title, 200), 'From meeting: '||left(coalesce(m_title,''),200), 'info',
      'meeting_action_approved', 'meeting_action:'||it.id,
      jsonb_build_object('meeting_id', it.meeting_id, 'opportunity_id', _opportunity_id));
    PERFORM public.log_meeting_to_deal(it.meeting_id, _opportunity_id, u);
  END IF;

  UPDATE public.meetings SET status='reviewed'
   WHERE id=it.meeting_id AND status='pending_review'
     AND NOT EXISTS (SELECT 1 FROM public.meeting_action_items WHERE meeting_id=it.meeting_id AND status='pending');

  INSERT INTO public.audit_log(actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'meeting_action.'||_action, 'meeting_action_item', it.id,
    jsonb_build_object('task_id', t_id, 'owner_id', _owner_id, 'opportunity_id', _opportunity_id, 'due_date', due,
                       'as', CASE WHEN manager THEN 'manager' ELSE 'attendee' END));

  RETURN jsonb_build_object('ok',true,'status',CASE _action WHEN 'approve' THEN 'approved' ELSE 'dismissed' END,'task_id',t_id);
END $$;
REVOKE ALL ON FUNCTION public.decide_meeting_action_item(uuid,text,text,uuid,date,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_meeting_action_item(uuid,text,text,uuid,date,uuid,text) TO authenticated;

-- ============ 8. What is waiting for the caller ============
-- The Work Queue and My Day item: pending items the caller can decide, how
-- many have waited more than 7 days, and the oldest meeting to open first.
CREATE OR REPLACE FUNCTION public.meeting_review_queue_for(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    SELECT i.meeting_id, i.created_at
      FROM public.meeting_action_items i
     WHERE i.status = 'pending' AND public.can_decide_meeting_item(i.id, _user_id)
  )
  SELECT jsonb_build_object(
    'pending', (SELECT count(*) FROM mine),
    'over_7_days', (SELECT count(*) FROM mine WHERE created_at < now() - interval '7 days'),
    'meetings', (SELECT count(DISTINCT meeting_id) FROM mine),
    'oldest_meeting_id', (SELECT meeting_id FROM mine ORDER BY created_at, meeting_id LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.meeting_review_queue_for(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.meeting_review_queue()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.meeting_review_queue_for(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.meeting_review_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_review_queue() TO authenticated;

-- ============ 9. Daily: dismiss what waited too long, then the digest ============
CREATE OR REPLACE FUNCTION public.expire_meeting_action_items()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gone jsonb; r record; m_owner uuid; n int := 0; today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
  WITH g AS (
    UPDATE public.meeting_action_items
       SET status = 'dismissed', decided_at = now(),
           decision_note = 'Auto-dismissed: no decision within 14 days / رُفض تلقائياً: لم يُبتّ فيه خلال 14 يوماً'
     WHERE status = 'pending' AND expires_at <= now()
    RETURNING id, meeting_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'meeting_id', meeting_id)), '[]'::jsonb) INTO gone FROM g;

  FOR r IN
    SELECT (x->>'meeting_id')::uuid AS meeting_id, count(*)::int AS items, array_agg((x->>'id')::uuid) AS ids
      FROM jsonb_array_elements(gone) x GROUP BY 1
  LOOP
    n := n + r.items;
    UPDATE public.meetings SET status = 'reviewed'
     WHERE id = r.meeting_id AND status = 'pending_review'
       AND NOT EXISTS (SELECT 1 FROM public.meeting_action_items WHERE meeting_id = r.meeting_id AND status = 'pending');

    INSERT INTO public.audit_log(actor_id, actor_type, action, entity_type, entity_id, after_value)
    SELECT NULL, 'system', 'meeting_action.auto_dismissed', 'meeting_action_item', x, jsonb_build_object('meeting_id', r.meeting_id)
      FROM unnest(r.ids) x;

    -- The meeting's owner: the organiser's account, else whose Fireflies it came from.
    SELECT coalesce(
             (SELECT p.id FROM public.meetings m JOIN auth.users au ON lower(au.email) = lower(m.organizer_email)
                JOIN public.profiles p ON p.id = au.id
               WHERE m.id = r.meeting_id AND p.status = 'active' LIMIT 1),
             (SELECT connected_user_id FROM public.meetings WHERE id = r.meeting_id))
      INTO m_owner;
    PERFORM public.emit_notification(m_owner, 'meeting_items_auto_dismissed', 'meeting', r.meeting_id,
      left((SELECT title FROM public.meetings WHERE id = r.meeting_id), 200),
      r.items || ' action items were dismissed after 14 days without a decision',
      'attention', 'meeting_items_expired', 'meeting_expired:' || r.meeting_id || ':' || today,
      jsonb_build_object('meeting_id', r.meeting_id, 'items', r.items));
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.expire_meeting_action_items() FROM PUBLIC, anon, authenticated;

-- Notification text is English like every other notification; the bell
-- translates the type label (notif_type_*). A count inside a mixed
-- Arabic/English line was reordered by the bidi algorithm.
--
-- One notification a working day per person with items to decide. It opens
-- the meeting list (metadata.digest); entity_id is the oldest meeting, so the
-- dedupe key stays one per person per day.
CREATE OR REPLACE FUNCTION public.notify_meeting_review_digest()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; q jsonb; n int := 0; today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
  IF extract(isodow FROM today) IN (5, 6) THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meeting_action_items WHERE status = 'pending') THEN RETURN 0; END IF;
  FOR p IN SELECT id FROM public.profiles WHERE status = 'active' AND NOT is_display_account LOOP
    q := public.meeting_review_queue_for(p.id);
    IF (q->>'pending')::int > 0 AND public.emit_notification(p.id, 'meeting_review_digest', 'meeting',
         (q->>'oldest_meeting_id')::uuid,
         (q->>'pending') || ' meeting tasks to review',
         CASE WHEN (q->>'over_7_days')::int > 0
              THEN (q->>'over_7_days') || ' waiting more than 7 days'
              ELSE 'From ' || (q->>'meetings') || ' meetings' END,
         CASE WHEN (q->>'over_7_days')::int > 0 THEN 'attention' ELSE 'info' END,
         'meeting_review_digest', 'meeting_digest:' || today,
         jsonb_build_object('digest', true, 'pending', (q->>'pending')::int, 'over_7_days', (q->>'over_7_days')::int)) IS NOT NULL
    THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.notify_meeting_review_digest() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_meetings_daily()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE expired int; digests int;
BEGIN
  expired := public.expire_meeting_action_items();
  digests := public.notify_meeting_review_digest();
  RETURN jsonb_build_object('expired', expired, 'digests', digests);
END $$;
REVOKE ALL ON FUNCTION public.run_meetings_daily() FROM PUBLIC, anon, authenticated;

-- ============ 10. Each salesperson's own Fireflies key ============
CREATE TABLE IF NOT EXISTS public.fireflies_connections (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  fireflies_email     TEXT NOT NULL,
  api_key_secret_id   UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reconnect')),
  connected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at      TIMESTAMPTZ,
  last_error          TEXT CHECK (length(last_error) <= 500)
);
COMMENT ON TABLE public.fireflies_connections IS
  'A person''s own Fireflies account. The API key is in Vault (api_key_secret_id); service role only. The browser sees my_fireflies_connection().';

ALTER TABLE public.fireflies_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fireflies_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fireflies_connections TO service_role;
DROP POLICY IF EXISTS audit_session_boundary ON public.fireflies_connections;
CREATE POLICY audit_session_boundary ON public.fireflies_connections AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

CREATE OR REPLACE FUNCTION public.save_fireflies_connection(_user uuid, _email text, _api_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE sid uuid;
BEGIN
  IF _user IS NULL OR btrim(coalesce(_api_key,'')) = '' OR btrim(coalesce(_email,'')) = '' THEN
    RAISE EXCEPTION 'Connection incomplete'; END IF;
  SELECT api_key_secret_id INTO sid FROM public.fireflies_connections WHERE user_id = _user;
  IF sid IS NULL THEN
    sid := vault.create_secret(btrim(_api_key), 'fireflies_key_' || _user, 'Fireflies API key');
  ELSE
    PERFORM vault.update_secret(sid, btrim(_api_key));
  END IF;
  INSERT INTO public.fireflies_connections(user_id, fireflies_email, api_key_secret_id, status, connected_at, last_error)
  VALUES (_user, lower(btrim(_email)), sid, 'active', now(), NULL)
  ON CONFLICT (user_id) DO UPDATE SET fireflies_email = EXCLUDED.fireflies_email, api_key_secret_id = sid,
    status = 'active', connected_at = now(), last_error = NULL;
END $$;

CREATE OR REPLACE FUNCTION public.fireflies_api_key(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT d.decrypted_secret FROM public.fireflies_connections c
    JOIN vault.decrypted_secrets d ON d.id = c.api_key_secret_id
   WHERE c.user_id = _user;
$$;

CREATE OR REPLACE FUNCTION public.mark_fireflies_connection(_user uuid, _status text, _error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.fireflies_connections
     SET status = _status, last_error = left(_error, 500),
         last_synced_at = CASE WHEN _status = 'active' AND _error IS NULL THEN now() ELSE last_synced_at END
   WHERE user_id = _user;
$$;

-- Disconnecting removes the key, not a flag: nothing is left to misuse.
CREATE OR REPLACE FUNCTION public.delete_fireflies_connection(_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE sid uuid;
BEGIN
  DELETE FROM public.fireflies_connections WHERE user_id = _user RETURNING api_key_secret_id INTO sid;
  IF sid IS NULL THEN RETURN false; END IF;
  DELETE FROM vault.secrets WHERE id = sid;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.save_fireflies_connection(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fireflies_api_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_fireflies_connection(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_fireflies_connection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_fireflies_connection(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fireflies_api_key(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_fireflies_connection(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_fireflies_connection(uuid) TO service_role;

-- What Settings shows: never the key.
CREATE OR REPLACE FUNCTION public.my_fireflies_connection()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('email', fireflies_email, 'status', status, 'connected_at', connected_at,
                            'last_synced_at', last_synced_at, 'last_error', last_error)
    FROM public.fireflies_connections WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.my_fireflies_connection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_fireflies_connection() TO authenticated;

-- ============ 11. The key the scheduler uses — in Vault only ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'meetings_sync_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'meetings_sync_key',
      'Authenticates pg_cron''s calls to meetings-inbound for the periodic Fireflies pull');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.meetings_sync_key_matches(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT coalesce(length(_key) = 64 AND _key = (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                  WHERE name = 'meetings_sync_key'), false);
$$;
REVOKE ALL ON FUNCTION public.meetings_sync_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meetings_sync_key_matches(text) TO service_role;

-- ============ 12. Schedules ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — meetings jobs not scheduled.';
    RETURN;
  END IF;
  PERFORM cron.unschedule('meetings-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meetings-daily');
  -- 04:10 UTC = 07:10 Riyadh, just after run-automations-daily.
  PERFORM cron.schedule('meetings-daily', '10 4 * * *', $job$ SELECT public.run_meetings_daily(); $job$);

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — meetings-sync not scheduled.';
    RETURN;
  END IF;
  PERFORM cron.unschedule('meetings-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meetings-sync');
  -- The key is read from Vault when the job runs; it is never written into the job text.
  PERFORM cron.schedule('meetings-sync', '*/30 * * * *', $job$
    SELECT net.http_post(
      url := 'https://lrfdtoexyeghrzynapyn.supabase.co/functions/v1/meetings-inbound',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-phc-meetings-sync-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meetings_sync_key')),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000)
    WHERE EXISTS (SELECT 1 FROM public.fireflies_connections WHERE status = 'active');
  $job$);
END $$;
