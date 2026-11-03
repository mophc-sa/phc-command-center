-- The pricing file moves only along its path, and only by the right person.
-- Test user UUIDs use the 5b… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-0000-0000-000000000001','authenticated','authenticated','sm-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-0000-0000-000000000003','authenticated','authenticated','sm-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5b000000-%';
insert into public.user_roles (user_id, role) values
  ('5b000000-0000-0000-0000-000000000001','salesperson'),
  ('5b000000-0000-0000-0000-000000000003','estimation_manager');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5b200000-0000-0000-0000-000000000001','sm-deal','5b000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','rfq_received');
insert into public.rfqs (id, opportunity_id, sales_owner_id, status)
values ('5b300000-0000-0000-0000-000000000001','5b200000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001','open');
insert into public.boqs (id, related_opportunity_id, title) values ('5b400000-0000-0000-0000-000000000001','5b200000-0000-0000-0000-000000000001','sm-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('5b500000-0000-0000-0000-000000000001','5b400000-0000-0000-0000-000000000001',1);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'package_review')$$,
  '42501', null, 'A rep cannot start the review');

select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((public.pricing_file_move((select id from public.pricing_files limit 1),'package_review'))->>'state',
  'package_review', 'The pricer starts the review');
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'at_supplier')$$,
  'P0001', null, 'A state cannot be skipped');
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'needs_info')$$,
  'P0001', null, 'Needs-info goes through its own RPC with a list');
select is((public.pricing_file_set_needs_info((select id from public.pricing_files limit 1), array['Location plan'], current_date + 2))->>'state',
  'needs_info', 'The pricer asks sales for missing items');

select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((public.pricing_file_answer_needs_info((select id from public.pricing_files limit 1), 'Uploaded'))->>'state',
  'package_review', 'The deal owner answers and the file returns to review');

select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'boq_frozen')$$,
  'P0001', null, 'BOQ frozen needs a frozen revision on the file');
reset role;
update public.boq_revisions set frozen_at = now(), frozen_by = '5b000000-0000-0000-0000-000000000003', status = 'verified'
 where id = '5b500000-0000-0000-0000-000000000001';
update public.pricing_files set boq_revision_id = '5b500000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5b000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((public.pricing_file_move((select id from public.pricing_files limit 1),'boq_frozen'))->>'state',
  'boq_frozen', 'With a frozen revision the BOQ freezes');
select throws_ok($$select public.pricing_file_move((select id from public.pricing_files limit 1),'closed')$$,
  'P0001', null, 'Closing needs a reason');
select is((select count(*)::int from public.pricing_file_events), 5, 'Every move is logged (open + 4 moves)');
select throws_ok($$update public.pricing_files set state = 'approved'$$, '42501', null, 'Direct state writes are refused');
reset role;
select * from finish();
rollback;
