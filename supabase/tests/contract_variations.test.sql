-- Phase B, B4: variation orders through the pricing loop, and executed quantities. Test user UUIDs use the 9c… prefix.
-- Users: 1 rep (deal owner), 2 finance, 3 another rep, 4 sales manager. Fixture as contract_approvals.test.sql.
-- Users: 1 rep (deal owner), 2 finance, 3 another rep, 4 sales manager.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9c000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','cv-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '9c000000-%';
insert into public.user_roles (user_id, role) values
  ('9c000000-0000-0000-0000-000000000001','salesperson'),
  ('9c000000-0000-0000-0000-000000000002','finance_manager'),
  ('9c000000-0000-0000-0000-000000000003','salesperson'),
  ('9c000000-0000-0000-0000-000000000004','sales_manager');

-- Deal 1 has a quotation sent to the client (Rev 0, 53200.00 in two lines). Deal 2 has none.
insert into public.opportunities (id, project_name, project_code, client, owner_id, created_by, sales_stage)
select ('9c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'cv-deal-' || n, 'CV-26-000' || n, 'cv-client',
       '9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001','contract_received'
  from generate_series(1,2) n;
set local session_replication_role = replica;
insert into public.quotations (id, quote_number, related_opportunity_id, owner_id, value, status)
values ('9c300001-0000-0000-0000-000000000001','CV-26-0001','9c200001-0000-0000-0000-000000000001',
        '9c000000-0000-0000-0000-000000000001',53200,'submitted');
insert into public.quotation_revisions (id, quotation_id, revision_number, is_current, status, subtotal_excl_vat,
       approved_by, approved_at, submitted_by, submitted_at, issued_at)
values ('9c310001-0000-0000-0000-000000000001','9c300001-0000-0000-0000-000000000001',1,true,'submitted',53200,
        '9c000000-0000-0000-0000-000000000004',now(),'9c000000-0000-0000-0000-000000000004',now(),now());
insert into public.quotation_revision_lines (revision_id, line_number, description, quantity, unit, line_total) values
  ('9c310001-0000-0000-0000-000000000001',1,'Pylon P1',2,'no',34322.58),
  ('9c310001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'no',18877.42);
set local session_replication_role = origin;

-- The terms the rep enters: 30/20/30/20, signed 2026-11-01, the meeting's periods.
create temp table t (k text primary key, v jsonb);
grant all on t to authenticated;
insert into t values ('terms', '{"reference":"PO-778","signed_on":"2026-10-01","value":53200,
  "drawings_days":5,"supply_install_days":45,"handover_days":10,"credit_days":30,
  "payments":[{"kind":"advance","pct":30},{"kind":"drawings_approval","pct":20},{"kind":"mir","pct":30},{"kind":"wir","pct":20}]}');

-- The rep records 30/20/30/20 on 53200, signed 2026-10-01, drawings 5 days, credit 30; finance approves.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select set_config('cv.id', public.contract_terms_save('9c200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'))::text, false);
select set_config('cv.adv', (select id::text from public.contract_payments where contract_id = current_setting('cv.id')::uuid and kind = 'advance'), false);
select set_config('cv.drw', (select id::text from public.contract_payments where contract_id = current_setting('cv.id')::uuid and kind = 'drawings_approval'), false);
select set_config('cv.mir', (select id::text from public.contract_payments where contract_id = current_setting('cv.id')::uuid and kind = 'mir'), false);
select set_config('cv.wir', (select id::text from public.contract_payments where contract_id = current_setting('cv.id')::uuid and kind = 'wir'), false);

select public.contract_terms_submit(current_setting('cv.id')::uuid);
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.contract_terms_review(current_setting('cv.id')::uuid, 'approve');
reset role;
-- The deal's main pricing file is open (quoted), as after PR 4.
insert into public.pricing_files (id, opportunity_id, state) values ('9c600001-0000-0000-0000-000000000001','9c200001-0000-0000-0000-000000000001','quoted');
insert into public.user_roles (user_id, role) values ('9c000000-0000-0000-0000-000000000002','estimation_manager');
set local role authenticated;

-- ===== Open a variation =====
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.contract_variation_open('%s', 'Two more signs')$$, current_setting('cv.id')),
  '42501', null, 'Another rep cannot open a variation');
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.contract_variation_open('%s', '  ')$$, current_setting('cv.id')),
  '23514', null, 'A variation needs a reason');
select lives_ok(format($$select set_config('cv.vo', (public.contract_variation_open('%s', 'Two more signs')->>'id'), false)$$, current_setting('cv.id')),
  'The rep opens a variation');
reset role;
select is((select state::text || '/' || variation_number::text from public.pricing_files where id = current_setting('cv.vo')::uuid),
  'received/1', 'VO-1 is a pricing file at received');
select is((select count(*)::int from public.pricing_files where opportunity_id = '9c200001-0000-0000-0000-000000000001' and state <> 'closed'),
  2, 'Open beside the main file');
select is((select b.title from public.pricing_files f join public.boq_revisions r on r.id = f.boq_revision_id join public.boqs b on b.id = r.boq_id
            where f.id = current_setting('cv.vo')::uuid), 'VO-1', 'With a BOQ of its own');
select ok(exists (select 1 from public.notifications where notification_type = 'pricing_variation_opened'
                   and recipient_user_id = '9c000000-0000-0000-0000-000000000002'), 'Estimation and finance are told');
select throws_ok($$insert into public.pricing_files (opportunity_id, state) values ('9c200001-0000-0000-0000-000000000001','received')$$,
  '23505', null, 'Still one open main file per deal');

-- The variation runs the pricing loop (covered by the pricing tests); here it is quoted at 4000.00 with one line.
set local session_replication_role = replica;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity)
select '9c510009-0000-0000-0000-000000000001', boq_revision_id, 1, 'Extra wall sign', 2 from public.pricing_files where id = current_setting('cv.vo')::uuid;
update public.pricing_files set state = 'quoted' where id = current_setting('cv.vo')::uuid;
insert into public.quotations (id, quote_number, related_opportunity_id, value, status)
values ('9c300009-0000-0000-0000-000000000001','CV-26-0001-VO1','9c200001-0000-0000-0000-000000000001',4000,'submitted');
insert into public.quotation_revisions (id, quotation_id, revision_number, is_current, status, subtotal_excl_vat, pricing_file_id,
       approved_by, approved_at, submitted_by, submitted_at, issued_at)
values ('9c310009-0000-0000-0000-000000000001','9c300009-0000-0000-0000-000000000001',1,true,'submitted',4000,current_setting('cv.vo')::uuid,
        '9c000000-0000-0000-0000-000000000004',now(),'9c000000-0000-0000-0000-000000000004',now(),now());
insert into public.quotation_revision_lines (revision_id, line_number, description, quantity, unit, line_total)
values ('9c310009-0000-0000-0000-000000000001',1,'Extra wall sign',2,'no',4000);
set local session_replication_role = origin;

-- ===== The client accepts it =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.contract_variation_accept('%s', '2026-11-05', 'VO-PO-9', null)$$, current_setting('cv.vo')),
  'The rep records the client''s acceptance');
select is((select contract_value::text from public.contracts where id = current_setting('cv.id')::uuid), '57200.00',
  'The contract value grows by the variation');
select is((select kind || ':' || amount::text || ':' || label from public.contract_payments where contract_id = current_setting('cv.id')::uuid and kind = 'variation'),
  'variation:4000.00:VO-1', 'Its own payment');
select is((select string_agg(description, ',' order by line_number) from public.contract_lines where contract_id = current_setting('cv.id')::uuid),
  'Pylon P1,Ceiling C1,Extra wall sign', 'Its lines join the contract quantities');
select throws_ok(format($$select public.contract_variation_accept('%s', '2026-11-05', 'again', null)$$, current_setting('cv.vo')),
  'P0001', null, 'Accepted once');

-- ===== Executed quantities: one ceiling sign cancelled =====
select throws_ok(format($$select public.contract_executed_record('%s', jsonb_build_array(jsonb_build_object('line_id',
  (select id from public.contract_lines where contract_id = '%s' and description = 'Ceiling C1'), 'executed', 5)))$$,
  current_setting('cv.id'), current_setting('cv.id')), '23514', null, 'More than the contract needs a variation');
select lives_ok(format($$select public.contract_executed_record('%s', jsonb_build_array(jsonb_build_object('line_id',
  (select id from public.contract_lines where contract_id = '%s' and description = 'Ceiling C1'), 'executed', 3)))$$,
  current_setting('cv.id'), current_setting('cv.id')), 'The rep records 3 of 4 ceiling signs');
select is((select executed_value::text || '/' || shortfall::text || '/' || variations_value::text from public.contract_execution_summary
            where contract_id = current_setting('cv.id')::uuid), '52480.65/4719.35/4000.00',
  'Executed value, the shortfall, the variations');
select is((select amount::text || '/' || amount_before_executed::text from public.contract_payments where id = current_setting('cv.wir')::uuid),
  '5920.65/10640.00', 'The final payment is reduced by the shortfall');
select is((select left_to_invoice::text from public.contract_billing_summary where contract_id = current_setting('cv.id')::uuid),
  (select (sum(amount) - 0)::text from public.contract_payments where contract_id = current_setting('cv.id')::uuid),
  'Left to invoice follows the payments');
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.contract_execution_summary), 0, 'Another rep reads nothing');
reset role;

select * from finish();
rollback;
