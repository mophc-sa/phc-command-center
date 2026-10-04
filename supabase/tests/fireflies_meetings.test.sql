-- Fireflies meetings — who reads them, and the gate between an action item
-- and a task.
--
-- Test user UUIDs use the 2a… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '2a000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'meet-bd+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2a000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'meet-rep+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2a000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'meet-guest+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set status = 'active'
 where id in ('2a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000002',
              '2a000000-0000-0000-0000-000000000003');
insert into public.user_roles (user_id, role) values
  ('2a000000-0000-0000-0000-000000000001', 'bd_manager'),
  ('2a000000-0000-0000-0000-000000000002', 'salesperson'),
  ('2a000000-0000-0000-0000-000000000003', 'salesperson');

insert into public.opportunities (id, project_name, owner_id, created_by)
values ('f2a00000-0000-0000-0000-000000000001', 'meeting-fixture-opp',
        '2a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000002');

-- ── Ingest, as the webhook does it ─────────────────────────────────────────
select is(
  public.ingest_meeting(
    '{"provider_meeting_id":"FF-TEST-1","title":"Weekly review","occurred_at":"2026-09-28T10:07:28Z","keywords":["Sidra"]}',
    '[{"speaker_label":"Faisal","title":"Follow up PQ","at_seconds":288,"suggested_owner_id":"2a000000-0000-0000-0000-000000000002"},
      {"speaker_label":"Speaker 3","title":"Push vendor","at_seconds":107,"suggested_owner_id":null},
      {"speaker_label":"Mary","title":"   ","at_seconds":1}]')->>'duplicate',
  'false', 'A new meeting is stored');

select is(
  public.ingest_meeting('{"provider_meeting_id":"FF-TEST-1","title":"Weekly review"}', '[]')->>'duplicate',
  'true', 'A retried webhook for the same meeting stores nothing new');

select is((select count(*)::int from public.meeting_action_items i join public.meetings m on m.id = i.meeting_id
            where m.provider_meeting_id = 'FF-TEST-1'),
  2, 'Blank items are dropped');

select is((select owner_id from public.meeting_action_items where title = 'Follow up PQ'),
  '2a000000-0000-0000-0000-000000000002'::uuid, 'A matched speaker is pre-filled as owner');

-- ── A salesperson sees nothing and cannot decide ───────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"2a000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is((select count(*)::int from public.meetings), 0,
  'A salesperson who was not in the meeting cannot read it (a pre-filled owner guess does not count)');

select throws_ok(
  $$select public.decide_meeting_action_item((select id from public.meeting_action_items limit 1), 'approve')$$,
  '42501', null, 'A salesperson cannot decide an action item');

select throws_ok(
  $$select public.ingest_meeting('{"provider_meeting_id":"FF-FORGED","title":"x"}', '[]')$$,
  '42501', null, 'A browser session cannot ingest meetings');

-- ── The BD manager reviews ─────────────────────────────────────────────────
select set_config('request.jwt.claims',
  '{"sub":"2a000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.meetings where provider_meeting_id = 'FF-TEST-1'), 1,
  'A BD manager reads meetings');

select throws_ok(
  $$update public.meeting_action_items set status = 'approved'$$,
  '42501', null, 'Status cannot be forged by a direct update');

select throws_ok(
  format($$select public.decide_meeting_action_item(%L, 'approve')$$,
    (select id from public.meeting_action_items where title = 'Push vendor')),
  '23514', null, 'Approving without an owner is refused');

select throws_ok(
  format($$select public.decide_meeting_action_item(%L, 'dismiss')$$,
    (select id from public.meeting_action_items where title = 'Push vendor')),
  '23514', null, 'Dismissing without a reason is refused');

select is(
  public.decide_meeting_action_item(
    (select id from public.meeting_action_items where title = 'Follow up PQ'), 'approve',
    'Follow up Sidra 345 PQ', '2a000000-0000-0000-0000-000000000002', '2026-10-05',
    'f2a00000-0000-0000-0000-000000000001')->>'status',
  'approved', 'Approving with an owner succeeds');

reset role;

select ok(exists(
  select 1 from public.tasks t join public.meeting_action_items i on i.task_id = t.id
   where i.title = 'Follow up Sidra 345 PQ'
     and t.owner_id = '2a000000-0000-0000-0000-000000000002'
     and t.related_opportunity_id = 'f2a00000-0000-0000-0000-000000000001'
     and t.due_date = '2026-10-05'
     and t.source = 'meeting_action:' || i.id),
  'The task carries owner, deal, due date and provenance');

select ok(exists(
  select 1 from public.notifications
   where recipient_user_id = '2a000000-0000-0000-0000-000000000002'
     and notification_type = 'meeting_task_assigned' and entity_type = 'task'),
  'The owner is notified');

-- ── Attendees read the meetings they were in (2026-10-04, option A) ─────────
select set_config('request.jwt.claims',
  '{"sub":"2a000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.meetings where provider_meeting_id = 'FF-TEST-1'), 1,
  'The owner of an approved action item reads that meeting');

select is((select count(*)::int from public.meeting_action_items i join public.meetings m on m.id = i.meeting_id
            where m.provider_meeting_id = 'FF-TEST-1'), 2,
  '... and all of its action items');

select throws_ok(
  format($$select public.decide_meeting_action_item(%L, 'dismiss', null, null, null, null, 'x')$$,
    (select id from public.meeting_action_items where title = 'Push vendor')),
  '42501', null, 'Reading a meeting does not let an attendee decide its items');

reset role;
select public.ingest_meeting(
  '{"provider_meeting_id":"FF-TEST-2","title":"Site visit","organizer_email":"someone@client.com","participants":["x@client.com, MEET-GUEST+test@phc-sa.com"]}', '[]');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"2a000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is((select array_agg(provider_meeting_id)::text from public.meetings), '{FF-TEST-2}',
  'A participant (by sign-in email, any case, even inside a joined entry) reads only that meeting');

select set_config('request.jwt.claims',
  '{"sub":"2a000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.meetings where provider_meeting_id = 'FF-TEST-2'), 0,
  'Someone not invited does not read it');

reset role;

select * from finish();
rollback;
