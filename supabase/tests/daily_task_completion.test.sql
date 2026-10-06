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
