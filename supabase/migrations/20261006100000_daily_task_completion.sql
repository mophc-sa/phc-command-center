-- =============================================================================
-- Daily task completion (2026-10-06, spec docs/superpowers/specs/2026-10-06-daily-task-completion-design.md)
--
-- A rep's day = tasks + follow-ups + commitments they own that are due by the
-- day (overdue carried) plus whatever they finished that day. Reps add their
-- own tasks; pipeline operators assign them; AI still only proposes. The wall
-- board reads counts, never titles. Day boundaries are Asia/Riyadh.
-- =============================================================================

-- ============ 1. Task status: one vocabulary ============
UPDATE public.tasks SET status = 'done'
 WHERE status IN ('completed', 'complete') ;
UPDATE public.tasks SET status = 'open'
 WHERE status NOT IN ('open', 'done', 'cancelled');
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('open', 'done', 'cancelled'));
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cancel_reason TEXT CHECK (length(cancel_reason) <= 1000);

-- ============ 2. Follow-ups learn when they were completed ============
ALTER TABLE public.follow_ups ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE public.follow_ups SET completed_at = coalesce(last_contact_at, updated_at)
 WHERE status = 'completed' AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_follow_up_completed()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_follow_up_completed_at ON public.follow_ups;
CREATE TRIGGER trg_follow_up_completed_at BEFORE UPDATE OF status ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.stamp_follow_up_completed();

-- ============ 3. The next-action view used 'completed'; tasks say 'done' ============
CREATE OR REPLACE VIEW public.opportunity_next_action AS
WITH due AS (
  SELECT f.opportunity_id, 'follow_up'::text AS source, f.id AS source_id,
         f.due_date::date AS due_date, f.owner_id,
         coalesce(nullif(btrim(f.notes), ''), 'Follow up') AS description
    FROM public.follow_ups f
   WHERE f.status IN ('scheduled', 'due', 'overdue')
  UNION ALL
  SELECT t.related_opportunity_id, 'task', t.id, t.due_date::date, t.owner_id, t.title
    FROM public.tasks t
   WHERE t.related_opportunity_id IS NOT NULL
     AND t.status = 'open'
     AND t.due_date IS NOT NULL
  UNION ALL
  SELECT c.opportunity_id, 'commitment', c.id, c.due_date, c.owner_id, c.description
    FROM public.commitments c
   WHERE c.status = 'open'
)
SELECT DISTINCT ON (d.opportunity_id)
       d.opportunity_id, d.source, d.source_id, d.due_date, d.owner_id, d.description,
       (d.due_date < current_date) AS is_overdue,
       (d.due_date - current_date) AS days_until_due
  FROM due d
 WHERE public.can_read_boq(d.opportunity_id, (SELECT auth.uid()))
 ORDER BY d.opportunity_id, d.due_date ASC, d.source;

-- ============ 4. What is on a person's list for a day ============
CREATE OR REPLACE FUNCTION public.riyadh_date(_ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (_ts AT TIME ZONE 'Asia/Riyadh')::date $$;

-- Internal: no grant to authenticated. Read through my_day / daily_completion.
CREATE OR REPLACE FUNCTION public.day_items(_user_id uuid, _day date)
RETURNS TABLE (kind text, id uuid, title text, due_date date, done boolean, overdue boolean,
               bucket text, opportunity_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Tasks: done that day, or due by the day and still open at its end.
  SELECT 'task', t.id, t.title, coalesce(t.due_date, public.riyadh_date(t.created_at)),
         t.status = 'done' AND public.riyadh_date(t.completed_at) = _day,
         coalesce(t.due_date, public.riyadh_date(t.created_at)) < _day,
         CASE WHEN t.source LIKE 'manager:%' THEN 'manager'
              WHEN t.source LIKE 'ai_daily:%' OR t.source LIKE 'ai_recommendation:%' THEN 'ai'
              WHEN t.source LIKE 'meeting_action:%' THEN 'meeting'
              ELSE 'self' END,
         t.related_opportunity_id
    FROM public.tasks t
   WHERE t.owner_id = _user_id AND t.status <> 'cancelled'
     AND ( (t.status = 'done' AND public.riyadh_date(t.completed_at) = _day)
        OR (coalesce(t.due_date, public.riyadh_date(t.created_at)) <= _day
            AND public.riyadh_date(t.created_at) <= _day
            AND (t.status = 'open' OR public.riyadh_date(t.completed_at) > _day)) )
  UNION ALL
  SELECT 'follow_up', f.id, coalesce(nullif(btrim(f.notes), ''), 'Follow up'), f.due_date,
         f.status = 'completed' AND public.riyadh_date(f.completed_at) = _day,
         f.due_date < _day, 'mandatory', f.opportunity_id
    FROM public.follow_ups f
   WHERE f.owner_id = _user_id AND f.status <> 'cancelled'
     AND ( (f.status = 'completed' AND public.riyadh_date(f.completed_at) = _day)
        OR (f.due_date <= _day AND public.riyadh_date(f.created_at) <= _day
            AND (f.status IN ('scheduled','due','overdue') OR public.riyadh_date(f.completed_at) > _day)) )
  UNION ALL
  -- Commitments: met that day counts done; missed that day counts against.
  SELECT 'commitment', c.id, c.description, c.due_date,
         c.status = 'met' AND public.riyadh_date(c.closed_at) = _day,
         c.due_date < _day, 'mandatory', c.opportunity_id
    FROM public.commitments c
   WHERE c.owner_id = _user_id AND c.status NOT IN ('waived', 'cancelled')
     AND ( (c.status IN ('met','missed') AND public.riyadh_date(c.closed_at) = _day)
        OR (c.due_date <= _day AND public.riyadh_date(c.created_at) <= _day
            AND (c.status = 'open' OR public.riyadh_date(c.closed_at) > _day)) );
$$;
REVOKE ALL ON FUNCTION public.day_items(uuid, date) FROM PUBLIC, anon, authenticated;

-- The caller's own list, with titles and deal names.
CREATE OR REPLACE FUNCTION public.my_day(_day date)
RETURNS TABLE (kind text, id uuid, title text, due_date date, done boolean, overdue boolean,
               bucket text, opportunity_id uuid, opportunity_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.kind, i.id, i.title, i.due_date, i.done, i.overdue AND NOT i.done, i.bucket,
         i.opportunity_id, o.project_name
    FROM public.day_items((SELECT auth.uid()), _day) i
    LEFT JOIN public.opportunities o ON o.id = i.opportunity_id
   ORDER BY i.done, i.overdue DESC, i.due_date, i.title;
$$;
REVOKE ALL ON FUNCTION public.my_day(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_day(date) TO authenticated;

-- Per-rep counts for managers and the wall. Never titles.
CREATE OR REPLACE FUNCTION public.daily_completion(_day date)
RETURNS TABLE (user_id uuid, full_name text, done int, open_due int, overdue int, buckets jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE u uuid := (SELECT auth.uid());
BEGIN
  IF NOT (public.is_pipeline_operator(u)
          OR public.has_any_role(u, ARRAY['system_admin']::public.app_role[])
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u AND p.is_display_account)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH reps AS (
    SELECT p.id, p.full_name FROM public.profiles p
     WHERE p.status = 'active' AND NOT p.is_display_account
       AND (public.is_sales_contributor(p.id) OR EXISTS (SELECT 1 FROM public.sales_targets s WHERE s.user_id = p.id))
  ), items AS (
    SELECT r.id AS uid, r.full_name, i.* FROM reps r CROSS JOIN LATERAL public.day_items(r.id, _day) i
  ), per_bucket AS (
    SELECT items.uid, items.bucket, count(*) FILTER (WHERE items.done)::int AS d, count(*)::int AS n FROM items GROUP BY items.uid, items.bucket
  )
  SELECT r.id, r.full_name,
         coalesce((SELECT count(*) FROM items i WHERE i.uid = r.id AND i.done), 0)::int,
         coalesce((SELECT count(*) FROM items i WHERE i.uid = r.id AND NOT i.done), 0)::int,
         coalesce((SELECT count(*) FROM items i WHERE i.uid = r.id AND NOT i.done AND i.overdue), 0)::int,
         coalesce((SELECT jsonb_object_agg(b.bucket, jsonb_build_object('done', b.d, 'total', b.n))
                     FROM per_bucket b WHERE b.uid = r.id), '{}'::jsonb)
    FROM reps r
   WHERE EXISTS (SELECT 1 FROM items i WHERE i.uid = r.id)
      OR EXISTS (SELECT 1 FROM public.sales_targets s WHERE s.user_id = r.id)
   ORDER BY r.full_name;
END $$;
REVOKE ALL ON FUNCTION public.daily_completion(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_completion(date) TO authenticated;

-- ============ 5. Writing tasks ============
CREATE OR REPLACE FUNCTION public.create_task(_title text, _due_date date DEFAULT NULL,
  _opportunity_id uuid DEFAULT NULL, _owner_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid := (SELECT auth.uid());
  owner uuid := coalesce(_owner_id, u);
  t_title text := btrim(coalesce(_title, ''));
  t_id uuid;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF t_title = '' OR length(t_title) > 500 THEN
    RAISE EXCEPTION 'title must be 1-500 characters' USING ERRCODE = '23514';
  END IF;
  IF owner = u THEN
    IF NOT (public.is_sales_contributor(u) OR public.is_pipeline_operator(u)) THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT public.is_pipeline_operator(u) THEN
      RAISE EXCEPTION 'only managers assign tasks' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = owner AND p.status = 'active' AND NOT p.is_display_account) THEN
      RAISE EXCEPTION 'owner must be an active person' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF _opportunity_id IS NOT NULL AND NOT public.can_read_boq(_opportunity_id, u) THEN
    RAISE EXCEPTION 'deal not readable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tasks (title, owner_id, due_date, related_opportunity_id, status, source, created_by)
  VALUES (t_title, owner, coalesce(_due_date, public.riyadh_date(now())), _opportunity_id, 'open',
          CASE WHEN owner = u THEN 'self' ELSE 'manager:' || u END, u)
  RETURNING id INTO t_id;

  IF owner <> u THEN
    PERFORM public.emit_notification(owner, 'task_assigned', 'task', t_id,
      left(t_title, 200), 'Assigned by your manager', 'info',
      'task_assigned', 'task_assigned:' || t_id,
      jsonb_build_object('opportunity_id', _opportunity_id));
  END IF;
  RETURN t_id;
END $$;
REVOKE ALL ON FUNCTION public.create_task(text, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_task(text, date, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_task_status(_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid := (SELECT auth.uid());
  t public.tasks%ROWTYPE;
  operator boolean := public.is_pipeline_operator(u);
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT (t.owner_id = u OR operator) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('open', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'bad status' USING ERRCODE = '23514';
  END IF;
  IF _status = 'cancelled' THEN
    IF btrim(coalesce(_reason, '')) = '' THEN
      RAISE EXCEPTION 'cancelling needs a reason' USING ERRCODE = '23514';
    END IF;
    IF coalesce(t.source, '') LIKE 'manager:%' AND NOT operator THEN
      RAISE EXCEPTION 'only a manager cancels a manager task' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.tasks
     SET status = _status,
         completed_at = CASE WHEN _status = 'done' THEN now() ELSE NULL END,
         cancel_reason = CASE WHEN _status = 'cancelled' THEN left(btrim(_reason), 1000) ELSE NULL END,
         updated_at = now()
   WHERE id = _id;
  RETURN _status;
END $$;
REVOKE ALL ON FUNCTION public.set_task_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_status(uuid, text, text) TO authenticated;
