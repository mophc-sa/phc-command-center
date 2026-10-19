-- Project tracking (group 4): the update log, closed-deal probability, who may
-- change a project number, and the number the Production project keeps.
-- Test user UUIDs use the 4a… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','4a000000-0000-0000-0000-000000000001','authenticated','authenticated','pt-owner+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4a000000-0000-0000-0000-000000000002','authenticated','authenticated','pt-other+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4a000000-0000-0000-0000-000000000003','authenticated','authenticated','pt-viewer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4a000000-0000-0000-0000-000000000004','authenticated','authenticated','pt-bd+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4a000000-0000-0000-0000-000000000005','authenticated','authenticated','pt-sm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '4a000000-%';
insert into public.user_roles (user_id, role) values
  ('4a000000-0000-0000-0000-000000000001','salesperson'),
  ('4a000000-0000-0000-0000-000000000002','salesperson'),
  ('4a000000-0000-0000-0000-000000000003','viewer'),
  ('4a000000-0000-0000-0000-000000000004','bd_manager'),
  ('4a000000-0000-0000-0000-000000000005','sales_manager');

insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage) values
  ('4a200000-0000-0000-0000-000000000001', 'tracking-deal', '4a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001', 'rfq_received'),
  ('4a200000-0000-0000-0000-000000000002', 'losing-deal',   '4a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001', 'jih');
insert into public.rfqs (id, opportunity_id, created_by, sales_owner_id, rfq_number) values
  ('4a300000-0000-0000-0000-000000000001', '4a200000-0000-0000-0000-000000000001',
   '4a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001', 'PT-26-9001');

-- ---- The update log ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.opportunity_updates (opportunity_id, kind, note, completion_pct)
values ('4a200000-0000-0000-0000-000000000001', 'offer_sent', 'Rev 0 sent to procurement', 60);
select is((select completion_pct::int from public.opportunities where id = '4a200000-0000-0000-0000-000000000001'), 60,
  'An update with a % sets the construction progress');
insert into public.opportunity_updates (opportunity_id, kind) values ('4a200000-0000-0000-0000-000000000001', 'awaiting_client');
select is((select completion_pct::int from public.opportunities where id = '4a200000-0000-0000-0000-000000000001'), 60,
  '... and one without a % leaves it alone');
select throws_ok($$insert into public.opportunity_updates (opportunity_id, kind) values ('4a200000-0000-0000-0000-000000000001', 'progress_update')$$,
  '23514', null, 'A progress update needs a %');
select throws_ok($$insert into public.opportunity_updates (opportunity_id, kind, note) values ('4a200000-0000-0000-0000-000000000001', 'other', '  ')$$,
  '23514', null, '"Other" needs a note');
select throws_ok($$insert into public.opportunity_updates (opportunity_id, kind, created_by) values ('4a200000-0000-0000-0000-000000000001', 'po_received', '4a000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'Nobody posts in someone else''s name');

select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$insert into public.opportunity_updates (opportunity_id, kind) values ('4a200000-0000-0000-0000-000000000001', 'po_received')$$,
  '42501', null, 'A rep who cannot see the deal cannot post to it');
select is((select count(*)::int from public.opportunity_updates where opportunity_id = '4a200000-0000-0000-0000-000000000001'), 0,
  '... nor read its log');

select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$insert into public.opportunity_updates (opportunity_id, kind) values ('4a200000-0000-0000-0000-000000000001', 'po_received')$$,
  '42501', null, 'A viewer cannot post');

-- ---- Only the sales manager changes the number --------------------------------
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
update public.rfqs set rfq_number = 'BD-26-0001' where id = '4a300000-0000-0000-0000-000000000001';
select is((select rfq_number from public.rfqs where id = '4a300000-0000-0000-0000-000000000001'), 'PT-26-9001',
  'A BD manager''s change to the number is discarded');
select set_config('request.jwt.claims','{"sub":"4a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
update public.rfqs set rfq_number = 'PT-26-9002' where id = '4a300000-0000-0000-0000-000000000001';
select is((select rfq_number from public.rfqs where id = '4a300000-0000-0000-0000-000000000001'), 'PT-26-9002',
  'The sales manager''s change is kept');
reset role;

-- ---- Closing a deal ------------------------------------------------------------
update public.opportunities set stage = 'won', sales_stage = 'won' where id = '4a200000-0000-0000-0000-000000000001';
select is((select human_win_probability::int from public.opportunities where id = '4a200000-0000-0000-0000-000000000001'), 100,
  'A won deal is 100%');
select is((select p.project_number from public.projects p join public.opportunities o on o.project_id = p.id
            where o.id = '4a200000-0000-0000-0000-000000000001'), null,
  'Winning still issues no project number before a BOQ (Phase 5 rule)');
insert into public.boqs (related_opportunity_id, title, status)
values ('4a200000-0000-0000-0000-000000000001', 'Signage BOQ', 'verified');
select is(public.issue_project_number((select project_id from public.opportunities where id = '4a200000-0000-0000-0000-000000000001')),
  'PT-26-9002', 'Once a BOQ is verified, the project is issued the deal''s number');
update public.opportunities set stage = 'lost', sales_stage = 'lost' where id = '4a200000-0000-0000-0000-000000000002';
select is((select human_win_probability::int from public.opportunities where id = '4a200000-0000-0000-0000-000000000002'), 0,
  'A lost deal is 0%');

select * from finish();
rollback;
