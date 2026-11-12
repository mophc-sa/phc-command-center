-- Phase B, B5: project costs from pricing, money out, and profit after late collection. Test user UUIDs use the 9d… prefix.
-- Fixture: the PR 2 worked example (cost 39900.00 = materials 16000 + installation 2600 + logistics 18300 + extras 3000; selling 53200.00).
-- Users: 1 rep, 2 estimation + finance (Zayed), 3 GM (Kalas), 4 BD manager (Marie).
-- Test user UUIDs use the 9d… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9d000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','pf-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '9d000000-%';
insert into public.user_roles (user_id, role) values
  ('9d000000-0000-0000-0000-000000000001','salesperson'),
  ('9d000000-0000-0000-0000-000000000002','estimation_manager'),
  ('9d000000-0000-0000-0000-000000000002','finance_manager'),
  ('9d000000-0000-0000-0000-000000000003','general_manager'),
  ('9d000000-0000-0000-0000-000000000004','bd_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('9d100000-0000-0000-0000-000000000001','pf-vendor');

-- Deal 1: the worked example, in the selling build. Deal 2: in package review (for needs_info).
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('9d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pf-deal-' || n,
       '9d000000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('9d40000' || n || '-0000-0000-0000-000000000001')::uuid, ('9d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pf-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('9d50000' || n || '-0000-0000-0000-000000000001')::uuid, ('9d40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen) values
  ('9d510001-0000-0000-0000-000000000001','9d500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false),
  ('9d510002-0000-0000-0000-000000000001','9d500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status) values
  ('9d520001-0000-0000-0000-000000000001','9d500001-0000-0000-0000-000000000001','9d100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen) values
  ('9d520001-0000-0000-0000-000000000001','9d510001-0000-0000-0000-000000000001',5000,2,10000,null),
  ('9d520001-0000-0000-0000-000000000001','9d510002-0000-0000-0000-000000000001',1000,4,4000,1500);
update public.boq_revisions set frozen_at = now(), frozen_by = '9d000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '9d500001-0000-0000-0000-000000000001';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('9d600001-0000-0000-0000-000000000001','9d200001-0000-0000-0000-000000000001','selling_build','9d500001-0000-0000-0000-000000000001'),
  ('9d600002-0000-0000-0000-000000000001','9d200002-0000-0000-0000-000000000001','package_review','9d500002-0000-0000-0000-000000000001');
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('9d600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate) values
  ('9d900001-0000-0000-0000-000000000001','pf_crane','Crane','رافعة','lump',3000);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('9d600001-0000-0000-0000-000000000001','9d900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- Kalas builds and proposes.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_build_price('9d600001-0000-0000-0000-000000000001');
select public.pricing_file_propose('9d600001-0000-0000-0000-000000000001', 53200, 39900);
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_review('9d600001-0000-0000-0000-000000000001','approve');
reset role;
select is((select state::text from public.pricing_files where id = '9d600001-0000-0000-0000-000000000001'), 'approved',
  'fixture: the price is approved');

-- The BD manager issues the quotation; the rep (deal owner) records the contract; finance approves it.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select public.pricing_issue_quotation('9d600001-0000-0000-0000-000000000001', current_date + 30, null, null, null);
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select set_config('pf.c', public.contract_terms_save('9d200001-0000-0000-0000-000000000001', '{"signed_on":"2026-08-01","credit_days":30,
  "payments":[{"kind":"advance","pct":30},{"kind":"drawings_approval","pct":20},{"kind":"mir","pct":30},{"kind":"wir","pct":20}]}'::jsonb)::text, false);
select public.contract_terms_submit(current_setting('pf.c')::uuid);
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.contract_terms_review(current_setting('pf.c')::uuid, 'approve');

-- ===== The budget loads from pricing when finance approves =====
select is((select array_agg(category || ':' || planned_amount::text order by category) from public.contract_cost_items
            where contract_id = current_setting('pf.c')::uuid),
  array['extras:3000.00','installation:2600.00','logistics:18300.00','manufacturing:16000.00'],
  'Manufacturing, installation, logistics and extras from the approved price');
select lives_ok(format($$select public.contract_costs_load('%s')$$, current_setting('pf.c')), 'Reloading is safe');
select is((select count(*)::int from public.contract_cost_items where contract_id = current_setting('pf.c')::uuid), 4, 'No duplicates');

-- ===== Finance records money out =====
select set_config('pf.mfg', (select id::text from public.contract_cost_items where contract_id = current_setting('pf.c')::uuid and category = 'manufacturing'), false);
select lives_ok(format($$select public.contract_cost_entry_record('%s', 'actual_cost', '2026-08-20', 17000, 'FAC-77', null)$$, current_setting('pf.mfg')),
  'The factory''s invoice');
select lives_ok(format($$select public.contract_cost_entry_record('%s', 'planned_payment', '2026-09-15', 6800, null, '40%% before shipping')$$, current_setting('pf.mfg')),
  'A planned payment');
select lives_ok(format($$select public.contract_cost_entry_record('%s', 'payment', '2026-08-21', 5100, 'TRX-9', '30%% advance')$$, current_setting('pf.mfg')),
  'A payment made');
select throws_ok(format($$select public.contract_cost_entry_record('%s', 'payment', '2026-08-21', 0, null, null)$$, current_setting('pf.mfg')),
  '23514', null, 'An amount above zero');

-- A late collection: the advance invoiced 2026-08-02 (due 2026-09-01), paid in full 2026-10-01, 30 days late.
select public.contract_invoice_record(current_setting('pf.c')::uuid, 'INV-A', '2026-08-02',
  array[(select d.id from public.contract_dues d join public.contract_payments p on p.id = d.payment_id
          where p.contract_id = current_setting('pf.c')::uuid and p.kind = 'advance')], null);
select public.contract_receipt_record((select id from public.contract_invoices where invoice_number = 'INV-A'), '2026-10-01', 18354, null, null);

-- ===== The profit board =====
select is((select sold::text || '/' || planned_cost::text || '/' || expected_cost::text from public.contract_profit
            where contract_id = current_setting('pf.c')::uuid), '53200.00/39900.00/40900.00',
  'Sold, planned cost, expected cost (the factory''s actual invoice replaces its planned figure)');
select is((select financing_cost::text from public.contract_profit where contract_id = current_setting('pf.c')::uuid), '183.54',
  '1% a month on 18354.00 for 30 days late');
select is((select gross_profit_expected::text || '/' || net_profit::text from public.contract_profit
            where contract_id = current_setting('pf.c')::uuid), '12300.00/12116.46', 'Gross and net profit');
select is((select cash_out_paid::text || '/' || cash_out_planned::text from public.contract_profit
            where contract_id = current_setting('pf.c')::uuid), '5100.00/6800.00', 'Money out, paid and planned');

-- ===== Cost stays with cost readers =====
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.contract_cost_items), 0, 'The rep reads no cost item');
select is((select count(*)::int from public.contract_profit), 0, 'Nor the profit board');
select throws_ok(format($$select public.contract_cost_entry_record('%s', 'payment', '2026-08-21', 10, null, null)$$, current_setting('pf.mfg')),
  '42501', null, 'Nor records money out');
reset role;

select * from finish();
rollback;
