-- =============================================================================
-- Meetings recorded by Fireflies.ai, and the human gate between what the
-- recorder heard and a task someone owns.
--
-- Fireflies records, transcribes, separates speakers and lists action items
-- per speaker. The meetings-inbound Edge Function stores each processed
-- meeting here through ingest_meeting (service role only). Nothing it produces
-- becomes work on its own: a pipeline operator reviews every action item,
-- corrects the owner (the recorder often only knows "Speaker 3"), and approves
-- it into a task or dismisses it with a reason — decide_meeting_action_item.
--
-- Design: docs/superpowers/specs/2026-09-28-fireflies-meetings-design.md
-- =============================================================================

-- ============ 1. Tables ============
CREATE TABLE IF NOT EXISTS public.meetings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT NOT NULL DEFAULT 'fireflies' CHECK (provider IN ('fireflies')),
  provider_meeting_id     TEXT NOT NULL CHECK (length(provider_meeting_id) BETWEEN 1 AND 200),
  title                   TEXT NOT NULL CHECK (length(title) <= 500),
  occurred_at             TIMESTAMPTZ,
  duration_minutes        NUMERIC(7,2),
  organizer_email         TEXT,
  participants            TEXT[] NOT NULL DEFAULT '{}',
  summary_short           TEXT,
  summary_overview        TEXT,
  keywords                TEXT[] NOT NULL DEFAULT '{}',
  action_items_raw        TEXT,
  transcript_url          TEXT,
  related_opportunity_id  UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'pending_review'
                            CHECK (status IN ('pending_review','reviewed')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A webhook retry for a meeting already stored is a no-op, not a copy.
  CONSTRAINT meetings_provider_meeting_key UNIQUE (provider, provider_meeting_id)
);

CREATE TABLE IF NOT EXISTS public.meeting_action_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id              UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  position                INTEGER NOT NULL CHECK (position >= 0),
  speaker_label           TEXT,
  title                   TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  at_seconds              INTEGER CHECK (at_seconds >= 0),
  suggested_owner_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_id                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  related_opportunity_id  UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  due_date                DATE,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','dismissed')),
  task_id                 UUID REFERENCES public.tasks(id),
  decided_by              UUID REFERENCES auth.users(id),
  decided_at              TIMESTAMPTZ,
  decision_note           TEXT CHECK (length(decision_note) <= 2000),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meeting_action_items_position_key UNIQUE (meeting_id, position)
);

CREATE INDEX IF NOT EXISTS meetings_occurred_at_idx ON public.meetings (occurred_at DESC);
CREATE INDEX IF NOT EXISTS meeting_action_items_pending_idx
  ON public.meeting_action_items (meeting_id) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON public.meetings;
CREATE TRIGGER trg_meetings_updated_at BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.meetings IS
  'Meetings processed by Fireflies.ai. Written only by ingest_meeting (service role, from meetings-inbound); read by pipeline operators and system admins.';
COMMENT ON TABLE public.meeting_action_items IS
  'Action items Fireflies listed for a meeting. Pending until a reviewer approves one into a task or dismisses it with a reason (decide_meeting_action_item).';

-- ============ 2. Access ============
-- Who reviews meetings: the same people who may write any task (pipeline
-- operators) plus system administrators. Meetings are internal and name
-- people and prices; nobody else reads them in v1.
CREATE OR REPLACE FUNCTION public.can_review_meetings(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['managing_director','general_manager','ceo','sales_manager','bd_manager','sales_ops','system_admin']::public.app_role[]
  );
$$;
REVOKE ALL ON FUNCTION public.can_review_meetings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_meetings(uuid) TO authenticated;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_action_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Meetings readable by reviewers" ON public.meetings;
CREATE POLICY "Meetings readable by reviewers" ON public.meetings
  FOR SELECT TO authenticated USING (public.can_review_meetings(auth.uid()));

DROP POLICY IF EXISTS "Meeting action items readable by reviewers" ON public.meeting_action_items;
CREATE POLICY "Meeting action items readable by reviewers" ON public.meeting_action_items
  FOR SELECT TO authenticated USING (public.can_review_meetings(auth.uid()));

-- The same session boundary 20260928100000 put on every public table: an
-- inactive account, or a manager role without MFA, reads nothing.
DROP POLICY IF EXISTS audit_session_boundary ON public.meetings;
CREATE POLICY audit_session_boundary ON public.meetings AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
DROP POLICY IF EXISTS audit_session_boundary ON public.meeting_action_items;
CREATE POLICY audit_session_boundary ON public.meeting_action_items AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- Reads only. Every write goes through the two functions below, so a decision
-- cannot be forged by updating status or task_id directly.
REVOKE ALL ON public.meetings, public.meeting_action_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meetings, public.meeting_action_items TO authenticated;
GRANT ALL ON public.meetings, public.meeting_action_items TO service_role;

-- Notifications may now point at a task.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('opportunity','rfq','tender','approval','quotation','inbox_item','system','task'));

-- ============ 3. Ingest (service role only) ============
CREATE OR REPLACE FUNCTION public.ingest_meeting(_meeting jsonb, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m_id uuid;
BEGIN
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) > 200 THEN
    RAISE EXCEPTION 'Action items must be an array of at most 200'; END IF;

  INSERT INTO public.meetings(provider, provider_meeting_id, title, occurred_at, duration_minutes,
    organizer_email, participants, summary_short, summary_overview, keywords, action_items_raw,
    transcript_url, status)
  VALUES ('fireflies', _meeting->>'provider_meeting_id',
    left(coalesce(nullif(btrim(_meeting->>'title'),''),'Untitled meeting'),500),
    (_meeting->>'occurred_at')::timestamptz, (_meeting->>'duration_minutes')::numeric,
    _meeting->>'organizer_email',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(_meeting->'participants','[]'))),
    _meeting->>'summary_short', _meeting->>'summary_overview',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(_meeting->'keywords','[]'))),
    _meeting->>'action_items_raw', _meeting->>'transcript_url',
    CASE WHEN jsonb_array_length(_items) = 0 THEN 'reviewed' ELSE 'pending_review' END)
  ON CONFLICT (provider, provider_meeting_id) DO NOTHING
  RETURNING id INTO m_id;

  IF m_id IS NULL THEN
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

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'meeting_id', m_id);
END $$;
REVOKE ALL ON FUNCTION public.ingest_meeting(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_meeting(jsonb, jsonb) TO service_role;

-- ============ 4. The human decision ============
CREATE OR REPLACE FUNCTION public.decide_meeting_action_item(
  _id uuid, _action text, _title text DEFAULT NULL, _owner_id uuid DEFAULT NULL,
  _due_date date DEFAULT NULL, _opportunity_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it public.meeting_action_items; u uuid := auth.uid(); t_id uuid; t_title text; m_title text;
BEGIN
  IF NOT public.can_review_meetings(u) THEN
    RAISE EXCEPTION 'Meeting review authority required / صلاحية مراجعة الاجتماعات مطلوبة' USING ERRCODE='42501'; END IF;
  IF _action IS NULL OR _action NOT IN ('approve','dismiss') THEN RAISE EXCEPTION 'Invalid decision'; END IF;

  SELECT * INTO it FROM public.meeting_action_items WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action item unavailable' USING ERRCODE='42501'; END IF;

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
    IF _opportunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id=_opportunity_id) THEN
      RAISE EXCEPTION 'Opportunity not found' USING ERRCODE='23503'; END IF;

    INSERT INTO public.tasks(title, related_opportunity_id, owner_id, due_date, created_by, source)
    VALUES (t_title, _opportunity_id, _owner_id, _due_date, u, 'meeting_action:'||it.id)
    RETURNING id INTO t_id;

    UPDATE public.meeting_action_items
       SET status='approved', title=t_title, owner_id=_owner_id, due_date=_due_date,
           related_opportunity_id=_opportunity_id, task_id=t_id,
           decided_by=u, decided_at=now(), decision_note=_note
     WHERE id=_id;

    SELECT title INTO m_title FROM public.meetings WHERE id=it.meeting_id;
    PERFORM public.emit_notification(_owner_id, 'meeting_task_assigned', 'task', t_id,
      left(t_title, 200), 'From meeting: '||left(coalesce(m_title,''),200), 'info',
      'meeting_action_approved', 'meeting_action:'||it.id,
      jsonb_build_object('meeting_id', it.meeting_id, 'opportunity_id', _opportunity_id));
  END IF;

  UPDATE public.meetings SET status='reviewed'
   WHERE id=it.meeting_id AND status='pending_review'
     AND NOT EXISTS (SELECT 1 FROM public.meeting_action_items WHERE meeting_id=it.meeting_id AND status='pending');

  INSERT INTO public.audit_log(actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'meeting_action.'||_action, 'meeting_action_item', it.id,
    jsonb_build_object('task_id', t_id, 'owner_id', _owner_id, 'opportunity_id', _opportunity_id));

  RETURN jsonb_build_object('ok',true,'status',CASE _action WHEN 'approve' THEN 'approved' ELSE 'dismissed' END,'task_id',t_id);
END $$;
REVOKE ALL ON FUNCTION public.decide_meeting_action_item(uuid,text,text,uuid,date,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_meeting_action_item(uuid,text,text,uuid,date,uuid,text) TO authenticated;
