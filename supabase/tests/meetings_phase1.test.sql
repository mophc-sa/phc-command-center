-- Meetings phase 1 — the person in the meeting decides their own items,
-- reviewers are told, a default due date, the deal suggested and logged,
-- undecided items expire, and each salesperson's Fireflies key stays server-side.
--
-- Test user UUIDs use the 2b… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '2b000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'p1-manager+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2b000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'p1-rep-a+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2b000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'p1-rep-b+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2b000000-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'p1-rep-c+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set status = 'active' where id::text like '2b000000-%';
insert into public.user_roles (user_id, role) values
  ('2b000000-0000-0000-0000-000000000001', 'bd_manager'),
  ('2b000000-0000-0000-0000-000000000002', 'salesperson'),
  ('2b000000-0000-0000-0000-000000000003', 'salesperson'),
  ('2b000000-0000-0000-0000-000000000004', 'salesperson');

insert into public.opportunities (id, project_name, owner_id, created_by) values
  ('f2b00000-0000-0000-0000-000000000001', 'Sidra Tower 345',
   '2b000000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-000000000002'),
  ('f2b00000-0000-0000-0000-000000000002', 'Rival Mall', '2b000000-0000-0000-0000-000000000004',
   '2b000000-0000-0000-0000-000000000004');

-- ── Saudi business days (Sun–Thu) ──────────────────────────────────────────
select is(public.add_business_days('2026-10-22', 3), '2026-10-27'::date,
  'Three business days after a Thursday skip Friday and Saturday');
select is(public.add_business_days('2026-10-23', 1), '2026-10-25'::date,
  'One business day after a Friday is Sunday');

-- ── Ingest: deal suggested, the people in it told ──────────────────────────
select public.ingest_meeting(
  '{"provider_meeting_id":"FF-P1-1","title":"Weekly","summary_short":"Discussed the SIDRA TOWER 345 signage package",
    "organizer_email":"P1-Rep-A+test@phc-sa.com","participants":["p1-rep-b+test@phc-sa.com"]}',
  '[{"speaker_label":"B","title":"Send drawings","suggested_owner_id":"2b000000-0000-0000-0000-000000000003"},
    {"speaker_label":"A","title":"Call client","suggested_owner_id":"2b000000-0000-0000-0000-000000000002"},
    {"speaker_label":"Speaker 3","title":"Push vendor","suggested_owner_id":null},
    {"speaker_label":"B","title":"Old thing","suggested_owner_id":"2b000000-0000-0000-0000-000000000003"}]');

select set_config('test.m1', (select id::text from public.meetings where provider_meeting_id = 'FF-P1-1'), true);

select is((select suggested_opportunity_id from public.meetings where provider_meeting_id = 'FF-P1-1'),
  'f2b00000-0000-0000-0000-000000000001'::uuid, 'The deal named in the summary is suggested (any case)');
select is((select related_opportunity_id from public.meetings where provider_meeting_id = 'FF-P1-1'),
  null, '... but not linked until someone confirms it');

select is((select count(*)::int from public.notifications
            where notification_type = 'meeting_review_requested' and entity_type = 'meeting'
              and recipient_user_id in ('2b000000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-000000000003')),
  2, 'The organiser and the attendee with items are told a meeting is waiting');
select is((select count(*)::int from public.notifications
            where notification_type = 'meeting_review_requested'
              and recipient_user_id in ('2b000000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-000000000004')),
  0, 'Managers and people not in the meeting are not');

select ok((select expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour'
             from public.meeting_action_items where title = 'Send drawings'),
  'A new item expires 14 days after it arrived');

-- ── The attendee decides only their own items ──────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is(jsonb_array_length(public.meeting_review_rights(
            (select id from public.meetings where provider_meeting_id = 'FF-P1-1'))->'decidable'),
  2, 'An attendee may decide the two items suggested to them');
select is((public.meeting_review_queue()->>'pending')::int, 2, 'Their review queue counts those two');

select throws_ok(
  format($$select public.decide_meeting_action_item(%L, 'dismiss', null, null, null, null, 'no')$$,
    (select id from public.meeting_action_items where title = 'Call client')),
  '42501', null, 'An attendee cannot decide an item suggested to someone else');
select throws_ok(
  format($$select public.decide_meeting_action_item(%L, 'dismiss', null, null, null, null, 'no')$$,
    (select id from public.meeting_action_items where title = 'Push vendor')),
  '42501', null, 'An attendee who did not organise cannot decide an unassigned item');
select throws_ok(
  format($$select public.decide_meeting_action_item(%L, 'approve', null, %L)$$,
    (select id from public.meeting_action_items where title = 'Send drawings'), '2b000000-0000-0000-0000-000000000002'),
  '42501', null, 'An attendee cannot hand their item to someone else');
select throws_ok(
  format($$select public.decide_meeting_action_item(%L, 'approve', null, %L, null, %L)$$,
    (select id from public.meeting_action_items where title = 'Send drawings'),
    '2b000000-0000-0000-0000-000000000003', 'f2b00000-0000-0000-0000-000000000002'),
  '42501', null, 'An attendee cannot attach a deal they cannot see');

select is(public.decide_meeting_action_item(
    (select id from public.meeting_action_items where title = 'Send drawings'), 'approve',
    null, '2b000000-0000-0000-0000-000000000003')->>'status',
  'approved', 'An attendee approves their own item');

reset role;
select set_config('request.jwt.claims', '', true);
select is((select t.due_date from public.tasks t join public.meeting_action_items i on i.task_id = t.id
            where i.title = 'Send drawings'),
  public.add_business_days((now() at time zone 'Asia/Riyadh')::date, 3),
  'With no due date, the task is due three business days out');
select is((select due_date from public.meeting_action_items where title = 'Send drawings'),
  public.add_business_days((now() at time zone 'Asia/Riyadh')::date, 3), '... and the item records it');
select is((select after_value->>'as' from public.audit_log
            where action = 'meeting_action.approve'
              and entity_id = (select id from public.meeting_action_items where title = 'Send drawings')),
  'attendee', 'The audit says the attendee decided, not a manager');

-- ── Someone not in the meeting ─────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.meetings where provider_meeting_id = 'FF-P1-1'), 0,
  'A salesperson not in the meeting cannot read it');
select is(public.meeting_review_rights(current_setting('test.m1')::uuid), null,
  'Nor see review rights on it');
select throws_ok(
  format($$select public.confirm_meeting_opportunity(%L, %L)$$,
    current_setting('test.m1'), 'f2b00000-0000-0000-0000-000000000002'),
  '42501', null, 'Nor link it to a deal');
select is((public.meeting_review_queue()->>'pending')::int, 0, 'Nothing waits in their queue');

-- ── The organiser ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(public.decide_meeting_action_item(
    (select id from public.meeting_action_items where title = 'Push vendor'), 'approve',
    null, '2b000000-0000-0000-0000-000000000003', '2026-11-01')->>'status',
  'approved', 'The organiser decides an unassigned item and may assign it to a colleague');

select is(public.confirm_meeting_opportunity(
    (select id from public.meetings where provider_meeting_id = 'FF-P1-1'),
    'f2b00000-0000-0000-0000-000000000001')->>'ok',
  'true', 'The organiser confirms the suggested deal');

select is((select related_opportunity_id from public.meeting_action_items where title = 'Call client'),
  'f2b00000-0000-0000-0000-000000000001'::uuid, 'Pending items take the confirmed deal as their pre-filled choice');

select is(public.decide_meeting_action_item(
    (select id from public.meeting_action_items where title = 'Call client'), 'approve',
    null, '2b000000-0000-0000-0000-000000000002', null, 'f2b00000-0000-0000-0000-000000000001')->>'status',
  'approved', 'The organiser approves their own item on the deal');

select is((select count(*)::int from public.opportunity_updates
            where opportunity_id = 'f2b00000-0000-0000-0000-000000000001' and kind = 'meeting_summary'),
  1, 'The summary is in the deal''s update log once, however many times it is linked');
select ok((select note like '%Weekly%SIDRA TOWER 345%' from public.opportunity_updates
            where opportunity_id = 'f2b00000-0000-0000-0000-000000000001' and kind = 'meeting_summary'),
  'The update names the meeting and carries its summary');

reset role;
select set_config('request.jwt.claims', '', true);

-- ── Undecided for 14 days: dismissed, the owner told ────────────────────────
update public.meeting_action_items set expires_at = now() - interval '1 minute' where title = 'Old thing';
select is((public.run_meetings_daily()->>'expired')::int, 1, 'The daily run dismisses the expired item');
select ok((select status = 'dismissed' and decided_by is null and decision_note like 'Auto-dismissed%'
             from public.meeting_action_items where title = 'Old thing'),
  'It is dismissed with a reason and no human decider');
select is((select status from public.meetings where provider_meeting_id = 'FF-P1-1'), 'reviewed',
  'With nothing left pending, the meeting is reviewed');
select ok(exists(select 1 from public.notifications
                  where recipient_user_id = '2b000000-0000-0000-0000-000000000002'
                    and notification_type = 'meeting_items_auto_dismissed'),
  'The meeting owner (the organiser) is told');
select is((public.run_meetings_daily()->>'expired')::int, 0, 'Running again dismisses nothing more');

-- ── Nobody on the team was in it: the managers are told ─────────────────────
select public.ingest_meeting(
  '{"provider_meeting_id":"FF-P1-2","title":"Supplier call","organizer_email":"x@vendor.com"}',
  '[{"speaker_label":"Speaker 1","title":"Chase quote","suggested_owner_id":null}]');
select ok(exists(select 1 from public.notifications
                  where recipient_user_id = '2b000000-0000-0000-0000-000000000001'
                    and notification_type = 'meeting_review_requested'),
  'A meeting matched to nobody goes to the managers');

select is((public.notify_meeting_review_digest() > 0),
  extract(isodow from (now() at time zone 'Asia/Riyadh')::date) not in (5, 6),
  'The daily digest goes out on working days only');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.decide_meeting_action_item(
    (select i.id from public.meeting_action_items i join public.meetings m on m.id = i.meeting_id
      where m.provider_meeting_id = 'FF-P1-2'), 'approve', null, '2b000000-0000-0000-0000-000000000004')->>'status',
  'approved', 'A manager still decides any item and assigns anyone');

-- ── Each salesperson's Fireflies key ───────────────────────────────────────
select throws_ok($$select * from public.fireflies_connections$$, '42501', null,
  'A browser session cannot read Fireflies connections');
select throws_ok(
  $$select public.fireflies_api_key('2b000000-0000-0000-0000-000000000002')$$, '42501', null,
  'A browser session cannot read anyone''s key');
select throws_ok(
  $$select public.save_fireflies_connection('2b000000-0000-0000-0000-000000000002', 'a@b.c', 'k')$$, '42501', null,
  'A browser session cannot save a key directly');
select throws_ok($$select public.meetings_sync_key_matches('x')$$, '42501', null,
  'A browser session cannot test the scheduler key');

reset role;
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$select public.save_fireflies_connection('2b000000-0000-0000-0000-000000000004', 'P1-Rep-C+test@phc-sa.com', 'ff-secret-key-123')$$,
  'The server saves a key');
select is(public.fireflies_api_key('2b000000-0000-0000-0000-000000000004'), 'ff-secret-key-123',
  'The key is read back from Vault on the server');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok((select public.my_fireflies_connection()->>'email' = 'p1-rep-c+test@phc-sa.com'
             and not (public.my_fireflies_connection()::text like '%ff-secret-key%')),
  'Settings sees the connected account, never the key');

reset role;
select set_config('request.jwt.claims', '', true);
-- The same meeting pulled from rep C's own account: rep C was in it.
select public.ingest_meeting(
  '{"provider_meeting_id":"FF-P1-2","title":"Supplier call","connected_user_id":"2b000000-0000-0000-0000-000000000004"}', '[]');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2b000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.meetings where provider_meeting_id = 'FF-P1-2'), 1,
  'A meeting also in your own Fireflies account becomes readable to you');

reset role;
select set_config('request.jwt.claims', '', true);
select ok(public.delete_fireflies_connection('2b000000-0000-0000-0000-000000000004'), 'Disconnecting succeeds');
select is(public.fireflies_api_key('2b000000-0000-0000-0000-000000000004'), null, '... and removes the key');

select * from finish();
rollback;
