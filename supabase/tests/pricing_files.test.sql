-- Pricing files: who reads them, who opens them, and the auto-open on a new RFQ.
-- Test user UUIDs use the 5a… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000001','authenticated','authenticated','pf-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000002','authenticated','authenticated','pf-other+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-0000-0000-000000000003','authenticated','authenticated','pf-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5a000000-%';
insert into public.user_roles (user_id, role) values
  ('5a000000-0000-0000-0000-000000000001','salesperson'),
  ('5a000000-0000-0000-0000-000000000002','salesperson'),
  ('5a000000-0000-0000-0000-000000000003','estimation_manager');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5a200000-0000-0000-0000-000000000001','pf-deal','5a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','rfq_received');

-- An RFQ on a deal opens a pricing file by itself.
insert into public.rfqs (id, opportunity_id, sales_owner_id, status)
values ('5a300000-0000-0000-0000-000000000001','5a200000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','open');
select is((select count(*)::int from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000001'), 1,
  'A new RFQ on a deal opens one pricing file');
select is((select state::text from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000001'), 'received',
  '... in state received');
select is((select count(*)::int from public.pricing_file_events e join public.pricing_files f on f.id = e.file_id
  where f.opportunity_id = '5a200000-0000-0000-0000-000000000001' and e.to_state = 'received'), 1,
  '... and logs the opening');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.pricing_files), 1, 'The deal owner reads the file state');
select throws_ok($$insert into public.pricing_files (opportunity_id) values ('5a200000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Direct inserts are refused');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.pricing_files), 0, 'Someone outside the deal reads nothing');
select throws_ok($$select public.open_pricing_file('5a200000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Only a pricer may open a file by hand');

select set_config('request.jwt.claims','{"sub":"5a000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((public.open_pricing_file('5a200000-0000-0000-0000-000000000001'))->>'state', 'received',
  'Opening again returns the open file instead of a second one');
select is((public.open_pricing_file('5a200000-0000-0000-0000-000000000001'))->>'id',
  (select id::text from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000001'),
  'The second call returns the existing file itself');
reset role;
select is((select count(*)::int from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000001'), 1,
  'Still one file for the deal');
-- Final review M1: two openers racing on one deal must not abort the RFQ
-- insert. The loser's insert skips the conflict and returns the winner's file.
-- A race cannot be staged inside one pgTAP transaction, so the insert is pinned
-- to the exact partial unique index predicate.
select ok(pg_get_functiondef('public._pricing_file_open(uuid,uuid,uuid)'::regprocedure)
            ~ 'ON CONFLICT \(opportunity_id\) WHERE state <> ''closed''\s+DO NOTHING',
  'A racing open skips the conflicting insert instead of raising');

-- Final review I3: an RFQ linked to a deal after it was saved opens the file then.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5a200000-0000-0000-0000-000000000002','pf-deal-2','5a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','rfq_received');
insert into public.rfqs (id, sales_owner_id, status)
values ('5a300000-0000-0000-0000-000000000002','5a000000-0000-0000-0000-000000000001','open');
select is((select count(*)::int from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000002'), 0,
  'An RFQ without a deal opens nothing');
update public.rfqs set opportunity_id = '5a200000-0000-0000-0000-000000000002' where id = '5a300000-0000-0000-0000-000000000002';
select is((select rfq_id::text from public.pricing_files where opportunity_id = '5a200000-0000-0000-0000-000000000002' and state = 'received'),
  '5a300000-0000-0000-0000-000000000002', 'Linking the RFQ to a deal opens the deal''s file, carrying the RFQ');
update public.rfqs set notes = 'edited' where id = '5a300000-0000-0000-0000-000000000002';
update public.rfqs set opportunity_id = '5a200000-0000-0000-0000-000000000002' where id = '5a300000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.pricing_file_events e join public.pricing_files f on f.id = e.file_id
            where f.opportunity_id = '5a200000-0000-0000-0000-000000000002'), 1,
  'Editing the RFQ again neither opens nor logs a second time');
select * from finish();
rollback;
