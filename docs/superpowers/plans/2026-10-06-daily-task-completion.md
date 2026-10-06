# Daily Task Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reps add and close their own tasks, managers assign tasks, and the wall board shows each rep's daily completion rate (today and yesterday).

**Architecture:** One SQL function `day_items(user, day)` decides what is on a person's list for a Riyadh day (tasks, follow-ups, commitments). Two RPCs read it: `my_day` (the caller's own items, with titles) and `daily_completion` (per-rep counts only, for managers and the display account). Two RPCs write tasks: `create_task` and `set_task_status`. The UI has a "My tasks today" panel in My Workspace, a "Team today" table for managers, and a "Today" column on the board's Team performance panel.

**Tech Stack:** Postgres 17 (Supabase, RLS, SECURITY DEFINER RPCs, pgTAP in CI), TanStack Start + React Query, Bun tests.

Spec: `docs/superpowers/specs/2026-10-06-daily-task-completion-design.md`.

## Global Constraints

- Day boundaries are Asia/Riyadh: in SQL `(ts AT TIME ZONE 'Asia/Riyadh')::date`, in TS `riyadhDay()`.
- Task status is exactly `open | done | cancelled`.
- Source buckets: `mandatory` (follow-up, commitment), `manager` (`manager:<uid>`), `self` (`self`), `ai` (`ai_daily:` / `ai_recommendation:`), `meeting` (`meeting_action:`); anything else → `self`.
- Rate = done ÷ (done + open_due); no items → `null` shown as "—".
- The board never shows task titles; `daily_completion` returns counts only.
- AI never creates a task on its own; existing approve paths are unchanged.
- No deletes on tasks (`tasks_no_delete` stays).
- Deviation from the spec, decided while planning: no snapshot table or cron. "Yesterday" is computed live by `daily_completion(yesterday)` from `completed_at` timestamps. The per-source breakdown lives in the managers' "Team today" table, and the wall board gets a compact "Today" column, so the tuned board grid is unchanged.

---

## File Structure

- Create `supabase/migrations/20261006100000_daily_task_completion.sql`: status cleanup, `follow_ups.completed_at`, the view fix, `day_items`, `my_day`, `daily_completion`, `create_task`, `set_task_status`.
- Create `supabase/tests/daily_task_completion.test.sql`: pgTAP tests.
- Create `src/lib/daily-tasks.ts`: types, `riyadhDay`, `rate`, `formatRate`, RPC wrappers.
- Create `src/lib/daily-tasks.test.ts`: Bun tests for the pure helpers, plus a contract test that the board never selects task titles.
- Create `src/components/phc/MyDayPanel.tsx`: the rep's list, add form and ✓.
- Create `src/components/phc/TeamDayPanel.tsx`: the managers' per-rep table and assign form.
- Modify `src/routes/_authenticated/my-workspace.tsx`: mount both panels.
- Modify `src/routes/_authenticated/board.tsx`: fetch completion for today and yesterday, and add the "Today" column.
- Modify `src/lib/i18n.tsx`: add strings.
- Modify docs: USER_GUIDE, CHANGELOG, AI_HANDOFF, DECISIONS, `tasks/current.md`, and the spec (deviation note).

---

### Task 1: Database — status, timestamps, day_items and the RPCs

**Files:**
- Create: `supabase/migrations/20261006100000_daily_task_completion.sql`
- Test: `supabase/tests/daily_task_completion.test.sql`

**Interfaces:**
- Produces:
  - `my_day(_day date) → TABLE(kind text, id uuid, title text, due_date date, done boolean, overdue boolean, bucket text, opportunity_id uuid, opportunity_name text)`
  - `daily_completion(_day date) → TABLE(user_id uuid, full_name text, done int, open_due int, overdue int, buckets jsonb)`, where `buckets` = `{"<bucket>": {"done": n, "total": n}}`
  - `create_task(_title text, _due_date date DEFAULT NULL, _opportunity_id uuid DEFAULT NULL, _owner_id uuid DEFAULT NULL) → uuid`
  - `set_task_status(_id uuid, _status text, _reason text DEFAULT NULL) → text`

- [ ] **Step 1: Write the pgTAP test** (`supabase/tests/daily_task_completion.test.sql`)

```sql
-- Daily task completion: who writes tasks, and what a day's list counts.
-- Test user UUIDs use the 3d… prefix; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','3d000000-0000-0000-0000-000000000001','authenticated','authenticated','dt-mgr+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','3d000000-0000-0000-0000-000000000002','authenticated','authenticated','dt-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','3d000000-0000-0000-0000-000000000003','authenticated','authenticated','dt-rep2+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','3d000000-0000-0000-0000-000000000004','authenticated','authenticated','dt-wall+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active', full_name = 'Rep One' where id = '3d000000-0000-0000-0000-000000000002';
update public.profiles set status = 'active' where id in ('3d000000-0000-0000-0000-000000000001','3d000000-0000-0000-0000-000000000003','3d000000-0000-0000-0000-000000000004');
update public.profiles set is_display_account = true where id = '3d000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values
  ('3d000000-0000-0000-0000-000000000001','sales_manager'),
  ('3d000000-0000-0000-0000-000000000002','salesperson'),
  ('3d000000-0000-0000-0000-000000000003','salesperson');

-- Fixed "today" for the maths: D = 2026-10-06 (Riyadh).
-- Rep One: one overdue open task (due 10-04), one done today (due 10-07, worked ahead),
-- one cancelled (excluded), one done yesterday (counts for 10-05 only).
insert into public.tasks (id, title, owner_id, due_date, status, source, completed_at, created_at) values
  ('3d100000-0000-0000-0000-000000000001','Overdue','3d000000-0000-0000-0000-000000000002','2026-10-04','open','self',null,'2026-10-01'),
  ('3d100000-0000-0000-0000-000000000002','Ahead','3d000000-0000-0000-0000-000000000002','2026-10-07','done','manager:3d000000-0000-0000-0000-000000000001','2026-10-06 09:00+03','2026-10-02'),
  ('3d100000-0000-0000-0000-000000000003','Dropped','3d000000-0000-0000-0000-000000000002','2026-10-06','cancelled','self',null,'2026-10-02'),
  ('3d100000-0000-0000-0000-000000000004','Yesterday','3d000000-0000-0000-0000-000000000002','2026-10-05','done','ai_daily:x:1','2026-10-05 15:00+03','2026-10-02');

select throws_ok($$update public.tasks set status = 'finished' where id = '3d100000-0000-0000-0000-000000000001'$$,
  '23514', null, 'Status outside open/done/cancelled is refused');

-- ── Writing tasks ────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"3d000000-0000-0000-0000-000000000002","role":"authenticated"}',true);

select isnt(public.create_task('Call the PM'), null, 'A rep adds a task for themself');
select is((select source from public.tasks where title = 'Call the PM'), 'self', '... with source self');
select throws_ok($$select public.create_task('For someone else', null, null, '3d000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'A rep cannot assign a task to someone else');
select throws_ok($$select public.set_task_status('3d100000-0000-0000-0000-000000000001','cancelled')$$,
  '23514', null, 'Cancelling needs a reason');
select throws_ok($$select public.set_task_status('3d100000-0000-0000-0000-000000000002','cancelled','not mine')$$,
  '42501', null, 'A rep cannot cancel a manager task');
select throws_ok($$select public.daily_completion('2026-10-06')$$,
  '42501', null, 'A rep cannot read the team''s completion');

select set_config('request.jwt.claims','{"sub":"3d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select isnt(public.create_task('Send revised price', '2026-10-06', null, '3d000000-0000-0000-0000-000000000003'), null,
  'A manager assigns a task');
reset role;
select ok(exists(select 1 from public.notifications where recipient_user_id = '3d000000-0000-0000-0000-000000000003'
  and notification_type = 'task_assigned'), 'The owner is notified');
select is((select source from public.tasks where title = 'Send revised price'), 'manager:3d000000-0000-0000-0000-000000000001',
  'A manager task records who assigned it');

-- ── The day's maths ──────────────────────────────────────────────────────
-- 'Call the PM' was created now (after D) with due = today's real date; keep the fixed D clean.
update public.tasks set due_date = '2026-12-31', created_at = '2026-12-31' where title = 'Call the PM';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"3d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select results_eq(
  $$select done, open_due, overdue from public.daily_completion('2026-10-06') where user_id = '3d000000-0000-0000-0000-000000000002'$$,
  $$values (1, 1, 1)$$,
  'Today: overdue carried, early completion counted, cancelled excluded');
select results_eq(
  $$select done, open_due from public.daily_completion('2026-10-05') where user_id = '3d000000-0000-0000-0000-000000000002'$$,
  $$values (1, 1)$$,
  'Yesterday is recomputed from completion times');
select is((select buckets->'manager'->>'done' from public.daily_completion('2026-10-06') where user_id = '3d000000-0000-0000-0000-000000000002'),
  '1', 'Counts are split by source');
select ok(not exists(select 1 from public.daily_completion('2026-10-06') where user_id = '3d000000-0000-0000-0000-000000000004'),
  'The display account is not a rep');

select set_config('request.jwt.claims','{"sub":"3d000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select lives_ok($$select * from public.daily_completion('2026-10-06')$$, 'The wall display reads the counts');

select set_config('request.jwt.claims','{"sub":"3d000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.my_day('2026-10-06')), 2, 'A rep''s own list for the day');
reset role;

select * from finish();
rollback;
```

Note: `create_task` stamps the real current date, so the test moves that task out of the fixed window before checking the maths.

- [ ] **Step 2: Write the migration** (`supabase/migrations/20261006100000_daily_task_completion.sql`)

```sql
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
    SELECT uid, bucket, count(*) FILTER (WHERE done)::int AS d, count(*)::int AS n FROM items GROUP BY uid, bucket
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
```

- [ ] **Step 3: Check the signatures used exist as called**

Run:
```bash
cd ~/dev/phc-command-center && grep -n "FUNCTION public.emit_notification(" supabase/migrations/20260819100000_phase_4_notifications.sql && grep -rn "FUNCTION public.has_any_role\|FUNCTION public.can_read_boq" supabase/migrations/*.sql | tail -2
```
Expected: `emit_notification` takes 10 args in the order used by `20261001100000_fireflies_meetings.sql:210` (recipient, type, entity_type, entity_id, title, body, severity, event, dedupe key, metadata). If the order differs, match it.

- [ ] **Step 4: Run what can run locally**

pgTAP for this repo runs only in CI (the local Supabase on :54322 belongs to another project). Locally, run `bun run verify` to confirm nothing else broke. pgTAP runs on the PR.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261006100000_daily_task_completion.sql supabase/tests/daily_task_completion.test.sql
git commit -m "feat(tasks): day list, completion counts, create and close tasks"
```

### Task 2: Client library and pure helpers

**Files:**
- Create: `src/lib/daily-tasks.ts`
- Test: `src/lib/daily-tasks.test.ts`

**Interfaces:**
- Consumes: the RPCs from Task 1.
- Produces:
  - `riyadhDay(d?: Date): string`
  - `addDays(day: string, n: number): string`
  - `rate(done: number, openDue: number): number | null`
  - `formatRate(r: number | null, lang): string`
  - `type DayItem`
  - `type RepDay`
  - `myDay(day)`
  - `teamDay(day)`
  - `createTask(input)`
  - `setTaskStatus(id, status, reason?)`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, formatRate, rate, riyadhDay } from "./daily-tasks";

describe("daily tasks helpers", () => {
  it("uses the Riyadh calendar day", () => {
    expect(riyadhDay(new Date("2026-10-05T21:30:00Z"))).toBe("2026-10-06"); // 00:30 in Riyadh
    expect(riyadhDay(new Date("2026-10-06T20:59:00Z"))).toBe("2026-10-06");
  });
  it("steps days across month ends", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });
  it("no items is no rate, not zero", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(6, 2)).toBe(75);
    expect(rate(1, 2)).toBe(33);
    expect(formatRate(null, "en")).toBe("—");
    expect(formatRate(75, "en")).toBe("75%");
  });
});

describe("the wall never shows task titles", () => {
  it("board reads counts only", () => {
    const board = readFileSync(join(import.meta.dir, "..", "routes", "_authenticated", "board.tsx"), "utf8");
    expect(board).not.toMatch(/from\("tasks"\)/);
    expect(board).not.toContain("myDay(");
    expect(board).toContain("teamDay(");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd ~/dev/phc-command-center && bun test src/lib/daily-tasks.test.ts`
Expected: FAIL, because the module `./daily-tasks` is not found.

- [ ] **Step 3: Implement**

```ts
// =============================================================================
// A person's day: tasks, follow-ups and commitments due by today plus what was
// finished today (day_items in 20261006100000_daily_task_completion.sql). The
// rate is done ÷ (done + still due); a day with nothing on it has no rate.
// Days are Riyadh calendar days, in SQL and here.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";

export type Bucket = "mandatory" | "manager" | "self" | "ai" | "meeting";
export type DayItem = {
  kind: "task" | "follow_up" | "commitment";
  id: string;
  title: string;
  due_date: string;
  done: boolean;
  overdue: boolean;
  bucket: Bucket;
  opportunity_id: string | null;
  opportunity_name: string | null;
};
export type RepDay = {
  user_id: string;
  full_name: string | null;
  done: number;
  open_due: number;
  overdue: number;
  buckets: Partial<Record<Bucket, { done: number; total: number }>>;
};

export function riyadhDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function rate(done: number, openDue: number): number | null {
  const total = done + openDue;
  return total === 0 ? null : Math.floor((done / total) * 100);
}

export function formatRate(r: number | null, lang: "ar" | "en"): string {
  if (r == null) return "—";
  return lang === "ar" ? `${r.toLocaleString("ar-SA")}٪` : `${r}%`;
}

export async function myDay(day: string): Promise<DayItem[]> {
  const { data, error } = await supabase.rpc("my_day" as never, { _day: day } as never);
  if (error) throw error;
  return (data ?? []) as DayItem[];
}

export async function teamDay(day: string): Promise<RepDay[]> {
  const { data, error } = await supabase.rpc("daily_completion" as never, { _day: day } as never);
  if (error) throw error;
  return (data ?? []) as RepDay[];
}

export async function createTask(input: { title: string; dueDate?: string | null; opportunityId?: string | null; ownerId?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("create_task" as never, {
    _title: input.title, _due_date: input.dueDate ?? null, _opportunity_id: input.opportunityId ?? null, _owner_id: input.ownerId ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export async function setTaskStatus(id: string, status: "open" | "done" | "cancelled", reason?: string): Promise<void> {
  const { error } = await supabase.rpc("set_task_status" as never, { _id: id, _status: status, _reason: reason ?? null } as never);
  if (error) throw error;
}
```

Note: if the generated Supabase types are regenerated in this repo (`src/integrations/supabase/types.ts`), add the four functions there instead of the `as never` casts. Check with `grep -n "decide_meeting_action_item" src/integrations/supabase/types.ts`. If it is listed, follow that pattern.

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/daily-tasks.test.ts`
Expected: the helper tests PASS. The board contract test still FAILS until Task 4. Mark it `it.skip` now, and remove the skip in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/daily-tasks.ts src/lib/daily-tasks.test.ts
git commit -m "feat(tasks): daily-tasks client helpers"
```

### Task 3: My Workspace — "My tasks today" and "Team today"

**Files:**
- Create: `src/components/phc/MyDayPanel.tsx`
- Create: `src/components/phc/TeamDayPanel.tsx`
- Modify: `src/routes/_authenticated/my-workspace.tsx` (the return block around line 167: mount the panels before `<DailyAssistantPanel />`)
- Modify: `src/lib/i18n.tsx` (add the `day_*` keys)

**Interfaces:**
- Consumes: `myDay`, `teamDay`, `createTask`, `setTaskStatus`, `riyadhDay`, `addDays`, `rate`, `formatRate` from Task 2; `canCreateSalesRecords`, `canManageSalesPipeline` from `@/lib/roles`; `listTeamMembers` from `@/lib/opportunity-actions`; `isAssignableTeamMember` from `@/lib/team-members`.

- [ ] **Step 1: i18n keys** (insert before `meetings_desc_attendee` in `src/lib/i18n.tsx`)

```ts
  // My day (2026-10-06)
  day_title: { en: "My tasks today", ar: "مهامي اليوم" },
  day_rate: { en: "Done today", ar: "إنجاز اليوم" },
  day_add: { en: "Add task", ar: "إضافة مهمة" },
  day_add_placeholder: { en: "What needs doing?", ar: "ما المطلوب؟" },
  day_due: { en: "Due", ar: "الموعد" },
  day_empty: { en: "Nothing due today.", ar: "لا شيء مستحق اليوم." },
  day_overdue: { en: "Overdue", ar: "متأخر" },
  day_done: { en: "Done", ar: "منجز" },
  day_undo: { en: "Undo", ar: "تراجع" },
  day_cancel: { en: "Cancel task", ar: "إلغاء المهمة" },
  day_cancel_reason: { en: "Why cancel it?", ar: "سبب الإلغاء؟" },
  day_open_deal: { en: "Open", ar: "فتح" },
  day_bucket_mandatory: { en: "Required", ar: "إلزامي" },
  day_bucket_manager: { en: "From manager", ar: "من المدير" },
  day_bucket_self: { en: "Mine", ar: "ذاتي" },
  day_bucket_ai: { en: "AI", ar: "ذكاء اصطناعي" },
  day_bucket_meeting: { en: "Meeting", ar: "اجتماع" },
  day_team_title: { en: "Team today", ar: "الفريق اليوم" },
  day_team_yesterday: { en: "Yesterday", ar: "أمس" },
  day_assign: { en: "Assign task", ar: "إسناد مهمة" },
  day_assign_to: { en: "To", ar: "إلى" },
```

- [ ] **Step 2: `MyDayPanel.tsx`**

```tsx
// =============================================================================
// My tasks today: everything on the person's list for the Riyadh day (tasks,
// follow-ups, commitments — my_day), the day's rate, a ✓ for tasks and an
// "Add task" form. Follow-ups and commitments close on their deal, where the
// outcome is recorded, so here they link there.
// =============================================================================

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ListChecks, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canCreateSalesRecords } from "@/lib/roles";
import { createTask, formatRate, myDay, rate, riyadhDay, setTaskStatus, type Bucket, type DayItem } from "@/lib/daily-tasks";

const BUCKET: Record<Bucket, StringKey> = {
  mandatory: "day_bucket_mandatory", manager: "day_bucket_manager", self: "day_bucket_self",
  ai: "day_bucket_ai", meeting: "day_bucket_meeting",
};

export function MyDayPanel() {
  const { t, lang } = useI18n();
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const day = riyadhDay();
  const allowed = Boolean(user) && canCreateSalesRecords(roles);
  const key = ["my-day", user?.id, day];
  const q = useQuery({ queryKey: key, queryFn: () => myDay(day), enabled: allowed, refetchInterval: 60_000 });
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(day);
  const [busy, setBusy] = useState(false);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (!allowed) return null;
  const items = q.data ?? [];
  const done = items.filter((i) => i.done).length;
  const r = rate(done, items.length - done);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["my-day"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="my-day-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-day-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("day_title")}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t("day_rate")}: <span className="font-semibold text-foreground tabular-nums">{formatRate(r, lang)}</span>
          {items.length > 0 ? <span className="tabular-nums"> · {done}/{items.length}</span> : null}
        </span>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void run(async () => { await createTask({ title, dueDate: due }); setTitle(""); setDue(day); });
        }}
      >
        <Input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("day_add_placeholder")}
               maxLength={500} className="min-w-0 flex-1" aria-label={t("day_add")} disabled={busy} />
        <Input type="date" value={due} min={day} onChange={(e) => setDue(e.target.value)} className="w-40" aria-label={t("day_due")} disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t("day_add")}
        </Button>
      </form>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground" role="status">
          {q.isLoading ? "…" : t("day_empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((it: DayItem) => (
            <li key={`${it.kind}:${it.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {it.kind === "task" ? (
                <Button type="button" size="sm" variant={it.done ? "outline" : "default"} disabled={busy}
                        aria-label={it.done ? t("day_undo") : t("day_done")}
                        onClick={() => void run(() => setTaskStatus(it.id, it.done ? "open" : "done"))}>
                  {it.done ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </Button>
              ) : null}
              <span dir="auto" className={`min-w-0 flex-1 text-sm ${it.done ? "text-muted-foreground line-through" : "text-foreground"}`}>{it.title}</span>
              <StatusPill tone="muted">{t(BUCKET[it.bucket])}</StatusPill>
              {it.overdue ? <StatusPill tone="danger">{t("day_overdue")}</StatusPill> : null}
              {it.opportunity_id ? (
                <Button asChild size="sm" variant="ghost">
                  <Link to="/opportunities/$id" params={{ id: it.opportunity_id }}>
                    <span dir="auto" className="max-w-40 truncate">{it.opportunity_name ?? t("day_open_deal")}</span>
                  </Link>
                </Button>
              ) : null}
              {it.kind === "task" && !it.done && it.bucket !== "manager" ? (
                cancelFor === it.id ? (
                  <span className="flex items-center gap-1.5">
                    <Input dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("day_cancel_reason")} className="h-8 w-48" />
                    <Button type="button" size="sm" variant="destructive" disabled={busy || !reason.trim()}
                            onClick={() => void run(async () => { await setTaskStatus(it.id, "cancelled", reason); setCancelFor(null); setReason(""); })}>
                      {t("day_cancel")}
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" aria-label={t("day_cancel")} onClick={() => { setCancelFor(it.id); setReason(""); }}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: `TeamDayPanel.tsx`**

```tsx
// =============================================================================
// Team today (managers): each rep's list for the Riyadh day — rate, done/total,
// overdue, the split by source, and yesterday's rate — plus "Assign task".
// Counts only (daily_completion); titles stay with their owners.
// =============================================================================

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canManageSalesPipeline } from "@/lib/roles";
import { listTeamMembers } from "@/lib/opportunity-actions";
import { isAssignableTeamMember } from "@/lib/team-members";
import { addDays, createTask, formatRate, rate, riyadhDay, teamDay, type Bucket } from "@/lib/daily-tasks";

const ORDER: Bucket[] = ["mandatory", "manager", "self", "ai", "meeting"];
const LABEL: Record<Bucket, StringKey> = {
  mandatory: "day_bucket_mandatory", manager: "day_bucket_manager", self: "day_bucket_self",
  ai: "day_bucket_ai", meeting: "day_bucket_meeting",
};
type Member = { id: string; full_name: string | null; email: string | null; status?: string | null; is_display_account?: boolean | null };

export function TeamDayPanel() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const allowed = canManageSalesPipeline(roles);
  const day = riyadhDay();
  const todayQ = useQuery({ queryKey: ["team-day", day], queryFn: () => teamDay(day), enabled: allowed, refetchInterval: 60_000 });
  const yQ = useQuery({ queryKey: ["team-day", addDays(day, -1)], queryFn: () => teamDay(addDays(day, -1)), enabled: allowed });
  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers, enabled: allowed });
  const members = ((teamQ.data ?? []) as Member[]).filter(isAssignableTeamMember);
  const [owner, setOwner] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(day);
  const [busy, setBusy] = useState(false);

  if (!allowed) return null;
  const rows = todayQ.data ?? [];
  const yesterday = new Map((yQ.data ?? []).map((r) => [r.user_id, rate(r.done, r.open_due)]));
  const teamDone = rows.reduce((a, r) => a + r.done, 0);
  const teamOpen = rows.reduce((a, r) => a + r.open_due, 0);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!owner || !title.trim()) return;
    setBusy(true);
    try {
      await createTask({ title, dueDate: due, ownerId: owner });
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["team-day"] });
      toast.success(t("day_assign"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="team-day-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="team-day-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("day_team_title")}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t("day_rate")}: <span className="font-semibold text-foreground tabular-nums">{formatRate(rate(teamDone, teamOpen), lang)}</span>
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-start font-medium">{t("day_assign_to")}</th>
              <th className="py-1 text-end font-medium">{t("day_rate")}</th>
              <th className="py-1 text-end font-medium">{t("day_overdue")}</th>
              {ORDER.map((b) => <th key={b} className="py-1 text-end font-medium">{t(LABEL[b])}</th>)}
              <th className="py-1 text-end font-medium">{t("day_team_yesterday")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td dir="auto" className="py-1.5 text-foreground">{r.full_name ?? "—"}</td>
                <td className="py-1.5 text-end tabular-nums">
                  <span className="font-semibold">{formatRate(rate(r.done, r.open_due), lang)}</span>
                  <span className="text-muted-foreground"> · {r.done}/{r.done + r.open_due}</span>
                </td>
                <td className={`py-1.5 text-end tabular-nums ${r.overdue > 0 ? "font-semibold text-destructive-on-tint" : "text-muted-foreground"}`}>{r.overdue}</td>
                {ORDER.map((b) => (
                  <td key={b} className="py-1.5 text-end tabular-nums text-muted-foreground">
                    {r.buckets[b] ? `${r.buckets[b]!.done}/${r.buckets[b]!.total}` : "—"}
                  </td>
                ))}
                <td className="py-1.5 text-end tabular-nums text-muted-foreground">{formatRate(yesterday.get(r.user_id) ?? null, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={assign} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <select className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={owner}
                onChange={(e) => setOwner(e.target.value)} aria-label={t("day_assign_to")} disabled={busy}>
          <option value="">{t("day_assign_to")}…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
        </select>
        <Input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("day_add_placeholder")}
               maxLength={500} className="min-w-0 flex-1" aria-label={t("day_assign")} disabled={busy} />
        <Input type="date" value={due} min={day} onChange={(e) => setDue(e.target.value)} className="w-40" aria-label={t("day_due")} disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || !owner || !title.trim()}>{t("day_assign")}</Button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Mount them** in `src/routes/_authenticated/my-workspace.tsx`

```tsx
// imports
import { MyDayPanel } from "@/components/phc/MyDayPanel";
import { TeamDayPanel } from "@/components/phc/TeamDayPanel";
// in the return block, before <DailyAssistantPanel />:
      <MyDayPanel />
      <TeamDayPanel />
```

- [ ] **Step 5: Verify**

Run: `bun run verify`
Expected: typecheck, lint with 0 errors, tests and build all pass. If the UI baseline tests flag the hand-written `<table>` ("no hand-written table" rule), switch to the repo's table component. Find it with `grep -rln "export function DataTable\|export const Table" src/components`.

- [ ] **Step 6: Commit**

```bash
git add src/components/phc/MyDayPanel.tsx src/components/phc/TeamDayPanel.tsx src/routes/_authenticated/my-workspace.tsx src/lib/i18n.tsx
git commit -m "feat(tasks): my tasks today and team today in My Workspace"
```

### Task 4: Board — "Today" column

**Files:**
- Modify: `src/routes/_authenticated/board.tsx`:
  - `useBoardData` around line 220: add two fetches.
  - Team performance header around line 1185: add a "Today" header.
  - Team rows around line 1197: add a "Today" cell.
  - Total line around line 1225: add the team rate.
- Modify: `src/lib/daily-tasks.test.ts` (remove the `it.skip`).

**Interfaces:**
- Consumes: `teamDay`, `riyadhDay`, `addDays`, `rate`, `formatRate` from Task 2.

- [ ] **Step 1: Fetch the counts.** In `useBoardData().queryFn`, after the `Promise.all`:

```ts
      // Daily completion: counts only, never titles (wall display).
      const day = riyadhDay();
      const [doneToday, doneYesterday] = await Promise.all([teamDay(day), teamDay(addDays(day, -1))]);
      return { opps, approvals, followUps, quotations, tenders, inbox, targets, profiles, moves, doneToday, doneYesterday };
```

Import: `import { addDays, formatRate, rate, riyadhDay, teamDay } from "@/lib/daily-tasks";`

- [ ] **Step 2: Add the header cell** after the Overdue header span:

```tsx
                  <span className="shrink-0 text-end" style={{ width: "5.2vw" }}>{lang === "ar" ? "إنجاز اليوم" : "Today"}</span>
```

- [ ] **Step 3: Add the row cell.** Inside `model.team.map((p, idx) => …)`, before `return (`:

```tsx
                    const day = data?.doneToday.find((r) => r.user_id === p.ownerId);
                    const yday = data?.doneYesterday.find((r) => r.user_id === p.ownerId);
                    const dayRate = day ? rate(day.done, day.open_due) : null;
```

Then, after the overdue span:

```tsx
                        <span className="num shrink-0 text-end" style={{ width: "5.2vw" }} data-tabular="true">
                          <span className="font-semibold text-foreground">{formatRate(dayRate, lang)}</span>
                          {day && day.done + day.open_due > 0 ? (
                            <span className="text-muted-foreground"> {formatNumber(day.done, lang)}/{formatNumber(day.done + day.open_due, lang)}</span>
                          ) : null}
                          <span className="block text-muted-foreground" style={{ fontSize: "clamp(12px, 0.6vw, 15px)" }}>
                            {lang === "ar" ? "أمس" : "Yday"} {formatRate(yday ? rate(yday.done, yday.open_due) : null, lang)}
                          </span>
                        </span>
```

Use whatever name the page uses for the query result. Check with `grep -n "useBoardData()" src/routes/_authenticated/board.tsx`, and use that identifier in place of `data`.

- [ ] **Step 4: Team rate in the total line.** Append to the total span:

```tsx
                    {" · "}{formatRate(rate(
                      (data?.doneToday ?? []).reduce((a, r) => a + r.done, 0),
                      (data?.doneToday ?? []).reduce((a, r) => a + r.open_due, 0)), lang)}
```

- [ ] **Step 5: Un-skip the board contract test, then verify**

Run: `bun test src/lib/daily-tasks.test.ts && bun run verify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authenticated/board.tsx src/lib/daily-tasks.test.ts
git commit -m "feat(board): today's completion per rep"
```

### Task 5: Docs, PR

**Files:**
- Modify:
  - `docs/USER_GUIDE.md` (new section before `### Meetings from Fireflies`)
  - `docs/CHANGELOG.md` (top)
  - `docs/AI_HANDOFF.md` (top)
  - `docs/DECISIONS.md` (top)
  - `tasks/current.md` (top)
  - the spec (deviation note)

- [ ] **Step 1:** Write the doc entries. Use a Python script that asserts each anchor occurs exactly once before inserting; a silent no-op edit was a past failure.
- [ ] **Step 2:** Run `bun run verify && bun run test:deno`. Commit. Push with the `mophc-sa` account. Open a draft PR with this plan's summary. Wait for CI; pgTAP must pass.
- [ ] **Step 3:** Before asking for `db push`, ask Mo to run `supabase login` (the CLI returned 403 on 2026-10-06). Then report the count of currently open tasks so he can decide keep-open or close-as-baseline (spec decision 5). Get them read-only with:
  `select count(*), count(*) filter (where due_date < current_date) from public.tasks where status = 'open'`
