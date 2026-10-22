-- Samples, drawings and client reminders (group 5): who sees and records each
-- step, the order of steps, the manager's approval, revisions, notifications,
-- repeating reminders and reminders on a client company.
-- Test user UUIDs use the 5a… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000001','authenticated','authenticated','sd-owner+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000002','authenticated','authenticated','sd-other+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000003','authenticated','authenticated','sd-sm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000004','authenticated','authenticated','sd-gm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000005','authenticated','authenticated','sd-viewer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5a000000-%';
insert into public.user_roles (user_id, role) values
  ('5a000000-0000-0000-0000-000000000001','salesperson'),
  ('5a000000-0000-0000-0000-000000000002','salesperson'),
  ('5a000000-0000-0000-0000-000000000003','sales_manager'),
  ('5a000000-0000-0000-0000-000000000004','general_manager'),
  ('5a000000-0000-0000-0000-000000000005','viewer');

insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage) values
  ('5a200000-0000-0000-0000-000000000001', 'sample-deal', '5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'jih');
insert into public.companies (id, name) values ('5a400000-0000-0000-0000-000000000001', 'Reminder Client Co');

-- ---- A sample, step by step --------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into public.deal_submittals (id, opportunity_id, kind, title)
  values ('5a500000-0000-0000-0000-000000000001', '5a200000-0000-0000-0000-000000000001', 'sample', 'Pylon face sample')$$,
  'The deal owner adds a sample');
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step)
  values ('5a500000-0000-0000-0000-000000000001', 'in_production')$$,
  '23514', null, 'A sample starts with a request, not production');
insert into public.deal_submittal_steps (submittal_id, step, notes)
values ('5a500000-0000-0000-0000-000000000001', 'requested', 'Client asked for an acrylic face sample');
select is((select current_step || ':' || revision from public.deal_submittals where id = '5a500000-0000-0000-0000-000000000001'),
  'requested:0', 'The item follows its latest step');
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step)
  values ('5a500000-0000-0000-0000-000000000001', 'approved')$$,
  '42501', null, 'A salesperson cannot approve the sample');
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step)
  values ('5a500000-0000-0000-0000-000000000001', 'in_production')$$,
  '23514', null, 'Production cannot start before the approval');
select throws_ok($$update public.deal_submittals set current_step = 'approved' where id = '5a500000-0000-0000-0000-000000000001'$$,
  '42501', null, 'Nobody writes the state directly');
select throws_ok($$update public.deal_submittal_steps set notes = 'changed' where submittal_id = '5a500000-0000-0000-0000-000000000001'$$,
  '42501', null, 'The step log cannot be edited');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.deal_submittals where opportunity_id = '5a200000-0000-0000-0000-000000000001'), 0,
  'Another rep does not see the deal''s samples');
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step)
  values ('5a500000-0000-0000-0000-000000000001', 'cancelled')$$,
  '42501', null, '... nor record a step on them');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step)
  values ('5a500000-0000-0000-0000-000000000001', 'cancelled')$$,
  '42501', null, 'A viewer records nothing');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$insert into public.deal_submittal_steps (submittal_id, step, notes)
  values ('5a500000-0000-0000-0000-000000000001', 'approved', 'OK, keep it under 2k')$$,
  'The sales manager approves');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.deal_submittal_steps (submittal_id, step, actor_name, occurred_at)
values ('5a500000-0000-0000-0000-000000000001', 'in_production', 'Ammar', now() - interval '3 days');
select is((select actor_name from public.deal_submittal_steps
            where submittal_id = '5a500000-0000-0000-0000-000000000001' and step = 'in_production'),
  'Ammar', 'A step names who did it, login or not');
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step, occurred_at)
  values ('5a500000-0000-0000-0000-000000000001', 'received', now() + interval '5 days')$$,
  '23514', null, 'A step cannot be dated in the future');
insert into public.deal_submittal_steps (submittal_id, step) values ('5a500000-0000-0000-0000-000000000001', 'received');
insert into public.deal_submittal_steps (submittal_id, step) values ('5a500000-0000-0000-0000-000000000001', 'sent_to_client');
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step)
  values ('5a500000-0000-0000-0000-000000000001', 'client_response')$$,
  '23514', null, 'A client response needs its code');
insert into public.deal_submittal_steps (submittal_id, step, response, notes)
values ('5a500000-0000-0000-0000-000000000001', 'client_response', 'revise_resubmit', 'Colour too dark');
select is((select client_response from public.deal_submittals where id = '5a500000-0000-0000-0000-000000000001'),
  'revise_resubmit', 'The client''s code shows on the item');
insert into public.deal_submittal_steps (submittal_id, step) values ('5a500000-0000-0000-0000-000000000001', 'requested');
select is((select revision::text || ':' || coalesce(client_response, '-') from public.deal_submittals where id = '5a500000-0000-0000-0000-000000000001'),
  '1:-', 'A new request starts the next revision and clears the old answer');
select is((select count(*)::int from public.deal_submittal_steps where submittal_id = '5a500000-0000-0000-0000-000000000001' and revision = 0),
  6, '... and the first revision''s history stays');

-- ---- A drawing -------------------------------------------------------------------
insert into public.deal_submittals (id, opportunity_id, kind, title)
values ('5a500000-0000-0000-0000-000000000002', '5a200000-0000-0000-0000-000000000001', 'drawing', 'Facade signage layout');
select throws_ok($$insert into public.deal_submittal_steps (submittal_id, step)
  values ('5a500000-0000-0000-0000-000000000002', 'requested')$$,
  '23514', null, 'A drawing starts when the designer sends it');
insert into public.deal_submittal_steps (submittal_id, step, actor_name) values ('5a500000-0000-0000-0000-000000000002', 'designer_sent', 'Design team');
insert into public.deal_submittal_steps (submittal_id, step) values ('5a500000-0000-0000-0000-000000000002', 'sent_to_client');
insert into public.deal_submittal_steps (submittal_id, step, response) values ('5a500000-0000-0000-0000-000000000002', 'client_response', 'approved_with_comments');
insert into public.deal_submittal_steps (submittal_id, step) values ('5a500000-0000-0000-0000-000000000002', 'designer_sent');
select is((select revision::int from public.deal_submittals where id = '5a500000-0000-0000-0000-000000000002'),
  1, 'Comments returned, the designer sends revision 1');
reset role;

-- ---- Who was told -------------------------------------------------------------------
select is((select count(*)::int from public.notifications
            where notification_type = 'sample_approval_needed'
              and recipient_user_id in ('5a000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000004')),
  4, 'Each request reaches the sales manager and the GM');
select is((select count(*)::int from public.notifications
            where notification_type = 'sample_decided' and recipient_user_id = '5a000000-0000-0000-0000-000000000001'
              and metadata->>'opportunity_id' = '5a200000-0000-0000-0000-000000000001'),
  1, 'The requester hears the decision, with the deal to open');
select is((select count(*)::int from public.notifications
            where notification_type = 'submittal_client_response' and recipient_user_id = '5a000000-0000-0000-0000-000000000001'),
  0, 'Nobody is told what they recorded themselves');

-- ---- Repeating reminders ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.follow_ups (id, opportunity_id, owner_id, due_date, recurrence, notes)
values ('5a600000-0000-0000-0000-000000000001', '5a200000-0000-0000-0000-000000000001',
        '5a000000-0000-0000-0000-000000000001', current_date, 'monthly', 'Monthly call with procurement');
update public.follow_ups set status = 'completed', notes = 'Spoke to Khalid, no change'
 where id = '5a600000-0000-0000-0000-000000000001';
select is((select due_date from public.follow_ups where recurs_from = '5a600000-0000-0000-0000-000000000001'),
  (current_date + interval '1 month')::date, 'Completing a monthly reminder schedules next month''s');
select is((select notes || '|' || status::text || '|' || recurrence from public.follow_ups where recurs_from = '5a600000-0000-0000-0000-000000000001'),
  'Monthly call with procurement|scheduled|monthly', '... with the original purpose, not the outcome');

insert into public.follow_ups (id, opportunity_id, owner_id, due_date, recurrence)
values ('5a600000-0000-0000-0000-000000000002', '5a200000-0000-0000-0000-000000000001',
        '5a000000-0000-0000-0000-000000000001', current_date, 'yearly');
update public.follow_ups set status = 'cancelled' where id = '5a600000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.follow_ups where recurs_from = '5a600000-0000-0000-0000-000000000002'),
  0, 'Cancelling ends the series');

select lives_ok($$insert into public.follow_ups (id, company_id, owner_id, due_date, recurrence, notes)
  values ('5a600000-0000-0000-0000-000000000003', '5a400000-0000-0000-0000-000000000001',
          '5a000000-0000-0000-0000-000000000001', current_date, 'yearly', 'Annual relationship visit')$$,
  'A reminder can belong to a client company');
select throws_ok($$insert into public.follow_ups (owner_id, due_date) values ('5a000000-0000-0000-0000-000000000001', current_date)$$,
  '23514', null, 'A reminder belongs to a deal or a client');
insert into public.follow_ups (id, company_id, owner_id, due_date)
values ('5a600000-0000-0000-0000-000000000004', '5a400000-0000-0000-0000-000000000001',
        '5a000000-0000-0000-0000-000000000001', current_date - 3);
reset role;
select set_config('request.jwt.claims', '', true);

-- The nightly run, as the scheduler: no caller, so the owner is not "themselves".
select lives_ok($$select public.run_sales_automations('manual')$$, 'The nightly rules run with client reminders present');
select is((select count(*)::int from public.opportunity_flags
            where condition_key like 'followup:5a600000-0000-0000-0000-00000000000_:%'
              and condition_key in ('followup:5a600000-0000-0000-0000-000000000003:' || current_date::text,
                                    'followup:5a600000-0000-0000-0000-000000000004:' || (current_date - 3)::text)),
  0, 'Client reminders raise no deal flag');
select is((select entity_type || ':' || entity_id::text from public.notifications
            where notification_type = 'follow_up_due' and recipient_user_id = '5a000000-0000-0000-0000-000000000001'
              and dedupe_key = 'followup_due:5a600000-0000-0000-0000-000000000003:' || current_date::text),
  'company:5a400000-0000-0000-0000-000000000001', 'A client reminder due today notifies its owner and opens the client');

select * from finish();
rollback;
