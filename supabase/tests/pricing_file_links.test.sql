-- PR 2, part 1: what a pricing file points at (AI_HANDOFF "PR 2 contract"),
-- the caller's rights, the queue, RFQ moves, and the cost basis under review.
-- Test user UUIDs use the 6a… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','fl-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,7) n;
update public.profiles set status = 'active' where id::text like '6a000000-%';
insert into public.user_roles (user_id, role) values
  ('6a000000-0000-0000-0000-000000000001','salesperson'),
  ('6a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6a000000-0000-0000-0000-000000000002','finance_manager'),
  ('6a000000-0000-0000-0000-000000000003','general_manager'),
  ('6a000000-0000-0000-0000-000000000004','bd_manager'),
  ('6a000000-0000-0000-0000-000000000005','sales_manager'),
  ('6a000000-0000-0000-0000-000000000006','salesperson'),
  ('6a000000-0000-0000-0000-000000000007','estimation_manager');
-- User 6 is a salesperson holding the GM's delegated price authority: he reads
-- only the deals he can read. User 7 is estimation only (no finance role).
insert into public.price_authority_delegations (grantor_id, grantee_id, reason, starts_at, expires_at)
values ('6a000000-0000-0000-0000-000000000003','6a000000-0000-0000-0000-000000000006','fl test cover',
        now() - interval '1 hour', now() + interval '1 day');

-- Deals 1..4, all owned by the rep. 1 = A (file in package review), 2 = B, 3 = C, 4 = D.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage,
                                  quotation_value, estimated_value_max, contract_value)
select ('6a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'fl-deal-' || n,
       '6a000000-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','rfq_received',
       250000, 300000, 400000
  from generate_series(1,4) n;
-- Deal E is the delegate's own (6a21…01); deal F is the rep's (6a21…02).
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage, quotation_value) values
  ('6a210001-0000-0000-0000-000000000001','fl-deal-e','6a000000-0000-0000-0000-000000000006','6a000000-0000-0000-0000-000000000006','rfq_received',150000),
  ('6a210002-0000-0000-0000-000000000001','fl-deal-f','6a000000-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','rfq_received',150000);
insert into public.boqs (id, related_opportunity_id, title) values
  ('6a400001-0000-0000-0000-000000000001','6a200001-0000-0000-0000-000000000001','fl-boq-a'),
  ('6a400002-0000-0000-0000-000000000001','6a200002-0000-0000-0000-000000000001','fl-boq-b');
-- A: revision 2 is current and replaced revision 1. B: revision 1.
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6a500002-0000-0000-0000-000000000001','6a400001-0000-0000-0000-000000000001',2),
  ('6a500003-0000-0000-0000-000000000001','6a400002-0000-0000-0000-000000000001',1);
insert into public.boq_revisions (id, boq_id, revision_number, is_current, superseded_by, superseded_at) values
  ('6a500001-0000-0000-0000-000000000001','6a400001-0000-0000-0000-000000000001',1,false,'6a500002-0000-0000-0000-000000000001',now());
-- Revision 3 of A's BOQ is not current but was never replaced.
insert into public.boq_revisions (id, boq_id, revision_number, is_current) values
  ('6a500004-0000-0000-0000-000000000001','6a400001-0000-0000-0000-000000000001',3,false);
insert into public.pricing_files (id, opportunity_id, state) values
  ('6a600001-0000-0000-0000-000000000001','6a200001-0000-0000-0000-000000000001','package_review');
-- E points at a revision of another deal (A's); F points at no revision. Both in selling_build.
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('6a600005-0000-0000-0000-000000000001','6a210001-0000-0000-0000-000000000001','selling_build','6a500002-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state) values
  ('6a600006-0000-0000-0000-000000000001','6a210002-0000-0000-0000-000000000001','selling_build');
-- An RFQ on B (opens B's file by itself).
insert into public.rfqs (id, opportunity_id, sales_owner_id, status)
values ('6a300009-0000-0000-0000-000000000001','6a200002-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001','open');
-- Estimations and prices for the link checks: eA on A's revision 2, eB on B's revision.
insert into public.estimations (id, boq_revision_id, cost_total) values
  ('6a700001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001', 90000),
  ('6a700002-0000-0000-0000-000000000001','6a500003-0000-0000-0000-000000000001', 90000),
  ('6a700003-0000-0000-0000-000000000001','6a500001-0000-0000-0000-000000000001', 90000);
insert into public.internal_prices (id, estimation_id, proposed_price, status) values
  ('6a800001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001',100000,'internal_price_proposed'),
  ('6a800002-0000-0000-0000-000000000001','6a700002-0000-0000-0000-000000000001',100000,'internal_price_proposed'),
  ('6a800003-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001',100000,'gm_pending'),
  -- Under review but in no pricing file: its estimation stays editable.
  ('6a800004-0000-0000-0000-000000000001','6a700003-0000-0000-0000-000000000001',100000,'gm_pending');

-- ===== Rights =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":true,"is_gm":false,"can_read_cost":true,"can_set_margins":true,"is_finance":true,"can_issue_quotation":false}'::jsonb,
  'Zayed is a pricer and a cost reader, not the GM');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":false,"is_gm":true,"can_read_cost":true,"can_set_margins":true,"is_finance":false,"can_issue_quotation":false}'::jsonb,
  'Kalas is the GM and a cost reader');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights(), '{"is_pricer":false,"is_gm":false,"can_read_cost":false,"can_set_margins":false,"is_finance":false,"can_issue_quotation":false}'::jsonb,
  'A rep has none of the four');

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
select throws_ok($$select public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500004-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A revision that is not current is refused');
select throws_ok($$select public.pricing_file_attach_revision((select id from public.pricing_files where opportunity_id = '6a200002-0000-0000-0000-000000000001' and state <> 'closed'),'6a500003-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A revision is attached only in package review');
select is((public.pricing_file_attach_revision('6a600001-0000-0000-0000-000000000001','6a500002-0000-0000-0000-000000000001'))->>'boq_revision_id',
  '6a500002-0000-0000-0000-000000000001', 'The deal''s current revision is attached');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  '42501', null, 'The link helper is not callable by users');

-- ===== Link checks (internal helper, run as the owner like its caller) =====
reset role;
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A file still in package review links no price');
update public.pricing_files set state = 'selling_build' where id = '6a600001-0000-0000-0000-000000000001';
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700002-0000-0000-0000-000000000001','6a800002-0000-0000-0000-000000000001')$$,
  '23514', null, 'An estimation of another revision is refused');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800002-0000-0000-0000-000000000001')$$,
  '23514', null, 'A price of another estimation is refused');
select throws_ok($$select public._pricing_file_link_price('6a600001-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800003-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A price already under review is refused');
select throws_ok($$select public._pricing_file_link_price('6a600005-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  '23514', null, 'A file whose revision belongs to another deal links no price');
select throws_ok($$select public._pricing_file_link_price('6a600006-0000-0000-0000-000000000001','6a700001-0000-0000-0000-000000000001','6a800001-0000-0000-0000-000000000001')$$,
  '23514', null, 'A file with no BOQ revision links no price');
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
select lives_ok($$update public.estimations set cost_total = 91000 where id = '6a700003-0000-0000-0000-000000000001'$$,
  'A price under review that is in no pricing file freezes nothing');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
update public.internal_prices set status = 'gm_pending' where id = '6a800001-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.estimations set cost_total = 50000 where id = '6a700001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Under review, the cost behind the price cannot change');
select lives_ok($$update public.estimations set notes = 'checked' where id = '6a700001-0000-0000-0000-000000000001'$$,
  'A note on the estimation is not cost and still saves');
-- Zayed (finance) approves the price Kalas proposed: the cost stays frozen.
update public.internal_prices set status = 'gm_approved' where id = '6a800001-0000-0000-0000-000000000001';

select is((select status::text from public.internal_prices where id = '6a800001-0000-0000-0000-000000000001'), 'gm_approved',
  'The price in the file is approved');
select throws_ok($$update public.estimations set cost_total = 50000 where id = '6a700001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Once approved, the cost behind the price cannot change either');

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
select is((select quotation_value from public.pricing_queue where opportunity_id = '6a200001-0000-0000-0000-000000000001'), 250000::numeric,
  'Finance reads the deal values in the queue');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue where opportunity_id::text like '6a20000%'
            and quotation_value is null and estimated_value_max is null and contract_value is null), 4,
  'Estimation only sees every file but no deal value');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue where opportunity_id::text like '6a20000%'
            and quotation_value = 250000 and estimated_value_max = 300000 and contract_value = 400000), 4,
  'The GM sees every file with its deal values');
select set_config('request.jwt.claims','{"sub":"6a000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_queue where opportunity_id::text like '6a20000%'), 0,
  'A salesperson holding delegated GM authority sees no file on another rep''s deal');
select is((select quotation_value from public.pricing_queue where opportunity_id = '6a210001-0000-0000-0000-000000000001'), 150000::numeric,
  'He sees the file on his own deal, with its value');
select is(public.pricing_my_rights()->'can_set_margins', 'false'::jsonb,
  'A delegate with no cost access cannot change the margin settings');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.revision_attached'
                   and entity_id = '6a200001-0000-0000-0000-000000000001'),
  'Attaching a revision is audited');
select * from finish();
rollback;
