-- PR 2, part 1: what a pricing file points at (AI_HANDOFF "PR 2 contract"),
-- the caller's rights, the queue, RFQ moves, and the cost basis under review.
-- Test user UUIDs use the 6a… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','fl-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,6) n;
update public.profiles set status = 'active' where id::text like '6a000000-%';
insert into public.user_roles (user_id, role) values
  ('6a000000-0000-0000-0000-000000000001','salesperson'),
  ('6a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6a000000-0000-0000-0000-000000000002','finance_manager'),
  ('6a000000-0000-0000-0000-000000000003','general_manager'),
  ('6a000000-0000-0000-0000-000000000004','bd_manager'),
  ('6a000000-0000-0000-0000-000000000005','sales_manager'),
  ('6a000000-0000-0000-0000-000000000006','salesperson');

-- Deals 1..4, all owned by the rep. 1 = A (file in package review), 2 = B, 3 = C, 4 = D.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'fl-deal-' || n,
       '6a000000-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,4) n;
insert into public.boqs (id, related_opportunity_id, title) values
  ('6a400001-0000-0000-0000-000000000001','6a200001-0000-0000-0000-000000000001','fl-boq-a'),
  ('6a400002-0000-0000-0000-000000000001','6a200002-0000-0000-0000-000000000001','fl-boq-b');
-- A: revision 2 is current and replaced revision 1. B: revision 1.
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6a500002-0000-0000-0000-000000000001','6a400001-0000-0000-0000-000000000001',2),
  ('6a500003-0000-0000-0000-000000000001','6a400002-0000-0000-0000-000000000001',1);
insert into public.boq_revisions (id, boq_id, revision_number, is_current, superseded_by, superseded_at) values
  ('6a500001-0000-0000-0000-000000000001','6a400001-0000-0000-0000-000000000001',1,false,'6a500002-0000-0000-0000-000000000001',now());
insert into public.pricing_files (id, opportunity_id, state) values
  ('6a600001-0000-0000-0000-000000000001','6a200001-0000-0000-0000-000000000001','package_review');
-- An RFQ on B (opens B's file by itself).
insert into public.rfqs (id, opportunity_id, sales_owner_id, status)
values ('6a300009-0000-0000-0000-000000000001','6a200002-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','open');
-- Estimations and prices for the link checks: eA on A's revision 2, eB on B's revision.
insert into public.estimations (id, boq_revision_id, cost_total) values
  ('6a700001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001', 90000),
  ('6a700002-0000-0000-0000-000000000001','6a500003-0000-0000-0000-000000000001', 90000);
insert into public.internal_prices (id, estimation_id, proposed_price, status) values
  ('6a800001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001',100000,'internal_price_proposed'),
  ('6a800002-0000-0000-0000-000000000001','6a700002-0000-0000-0000-000000000001',100000,'internal_price_proposed'),
  ('6a800003-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001',100000,'gm_pending');

-- ===== Rights =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":true,"is_gm":false,"can_read_cost":true}'::jsonb,
  'Zayed is a pricer and a cost reader, not the GM');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":false,"is_gm":true,"can_read_cost":true}'::jsonb,
  'Kalas is the GM and a cost reader');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":false,"is_gm":false,"can_read_cost":false}'::jsonb,
  'A rep has none of the three');

-- ===== open_pricing_file checks the RFQ is the deal's =====
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.open_pricing_file('6a200001-0000-0000-0000-000000000001','6a300009-0000-0000-0000-000000000001')$$,
  '23514', null, 'An RFQ of another deal is refused');

-- ===== Attach a BOQ revision =====
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001')$$,
  '42501', null, 'A rep cannot attach a revision');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500003-0000-0000-0000-000000000001')$$,
  '23514', null, 'A revision of another deal is refused');
select throws_ok($$select public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A replaced revision is refused');
select is((public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001'))->>'boq_revision_id',
  '6a500002-0000-0000-0000-000000000001', 'The deal''s current revision is attached');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  '42501', null, 'The link helper is not callable by users');

-- ===== Link checks (internal helper, run as the owner like its caller) =====
reset role;
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700002-0000-0000-0000-000000000001','6a800002-0000-0000-0000-000000000001')$$,
  '23514', null, 'An estimation of another revision is refused');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800002-0000-0000-0000-000000000001')$$,
  '23514', null, 'A price of another estimation is refused');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800003-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A price already under review is refused');
select lives_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  'A proposed price of the file''s estimation is linked');
select ok(exists (select 1 from public.pricing_files where id = '6a600001-0000-0000-0000-000000000001'
                   and estimation_id = '6a700001-0000-0000-0000-000000000001'
                   and internal_price_id = '6a800001-0000-0000-0000-000000000001'),
  'The file now points at the estimation and the price');

-- ===== The cost basis is frozen while the price is under review =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.estimations set cost_total = 91000 where id = '6a700001-0000-0000-0000-000000000001'$$,
  'Before review, estimation may still change the cost');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6a600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
update public.internal_prices set status = 'gm_pending' where id = '6a800001-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.estimations set cost_total = 50000 where id = '6a700001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Under review, the cost behind the price cannot change');
select lives_ok($$update public.estimations set notes = 'checked' where id = '6a700001-0000-0000-0000-000000000001'$$,
  'A note on the estimation is not cost and still saves');

-- ===== An RFQ moved to another deal =====
reset role;
insert into public.rfqs (id, opportunity_id, sales_owner_id, status) values
  ('6a300001-0000-0000-0000-000000000001','6a200003-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','open');
insert into public.rfqs (id, opportunity_id, sales_owner_id, status) values
  ('6a300002-0000-0000-0000-000000000001','6a200003-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','open');
update public.rfqs set opportunity_id = '6a200004-0000-0000-0000-000000000001' where id = '6a300001-0000-0000-0000-000000000001';
select is((select rfq_id::text from public.pricing_files where opportunity_id = '6a200003-0000-0000-0000-000000000001' and state <> 'closed'),
  '6a300002-0000-0000-0000-000000000001', 'The old deal''s file points at its remaining RFQ');
select is((select rfq_id::text from public.pricing_files where opportunity_id = '6a200004-0000-0000-0000-000000000001' and state <> 'closed'),
  '6a300001-0000-0000-0000-000000000001', 'The new deal opens its own file with the moved RFQ');
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.rfq_repointed'
                   and entity_id = '6a200003-0000-0000-0000-000000000001'),
  'The re-point is audited');

-- ===== The queue =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue), 0, 'A rep reads no queue');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue), 0, 'The BD manager reads no queue');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue where opportunity_id::text like '6a20000%'), 4,
  'The sales manager (management, cost reader) reads the queue');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue where opportunity_id::text like '6a20000%'), 4,
  'Zayed reads the queue: files A, B, C and D');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.revision_attached'
                   and entity_id = '6a200001-0000-0000-0000-000000000001'),
  'Attaching a revision is audited');
select * from finish();
rollback;
