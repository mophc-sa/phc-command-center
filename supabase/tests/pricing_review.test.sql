-- PR 4, part 1: finance (Zayed) reviews the price the GM (Kalas) proposed; the loop's notifications.
-- Fixture: PR 2's worked example (pricing_build_price.test.sql): cost 39900.00, selling 53200.00 at 25%.
-- Users: 1 rep, 2 estimation + finance (Zayed), 3 GM (Kalas), 4 BD manager (Marie).
-- Test user UUIDs use the 8a… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','pr-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '8a000000-%';
insert into public.user_roles (user_id, role) values
  ('8a000000-0000-0000-0000-000000000001','salesperson'),
  ('8a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8a000000-0000-0000-0000-000000000002','finance_manager'),
  ('8a000000-0000-0000-0000-000000000003','general_manager'),
  ('8a000000-0000-0000-0000-000000000004','bd_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('8a100000-0000-0000-0000-000000000001','pr-vendor');

-- Deal 1: the worked example, in the selling build. Deal 2: in package review (for needs_info).
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pr-deal-' || n,
       '8a000000-0000-0000-0000-000000000001','8a000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8a40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pr-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8a50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8a40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen) values
  ('8a510001-0000-0000-0000-000000000001','8a500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false),
  ('8a510002-0000-0000-0000-000000000001','8a500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status) values
  ('8a520001-0000-0000-0000-000000000001','8a500001-0000-0000-0000-000000000001','8a100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen) values
  ('8a520001-0000-0000-0000-000000000001','8a510001-0000-0000-0000-000000000001',5000,2,10000,null),
  ('8a520001-0000-0000-0000-000000000001','8a510002-0000-0000-0000-000000000001',1000,4,4000,1500);
update public.boq_revisions set frozen_at = now(), frozen_by = '8a000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '8a500001-0000-0000-0000-000000000001';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8a600001-0000-0000-0000-000000000001','8a200001-0000-0000-0000-000000000001','selling_build','8a500001-0000-0000-0000-000000000001'),
  ('8a600002-0000-0000-0000-000000000001','8a200002-0000-0000-0000-000000000001','package_review','8a500002-0000-0000-0000-000000000001');
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('8a600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate) values
  ('8a900001-0000-0000-0000-000000000001','pr_crane','Crane','رافعة','lump',3000);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('8a600001-0000-0000-0000-000000000001','8a900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- Kalas builds and proposes.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_file_build_price('8a600001-0000-0000-0000-000000000001'))->>'total_selling', '53200.00',
  'fixture: Kalas builds the worked example');
select lives_ok($$select public.pricing_file_propose('8a600001-0000-0000-0000-000000000001', 53200, 39900)$$,
  'fixture: Kalas proposes');
reset role;
select is((select state::text from public.pricing_files where id = '8a600001-0000-0000-0000-000000000001'), 'price_review',
  'fixture: the file is in price review');

-- ===== Notice on propose =====
select ok(exists (select 1 from public.notifications where notification_type = 'pricing_price_review'
                   and recipient_user_id = '8a000000-0000-0000-0000-000000000002'),
  'Finance is told a price waits for review');

-- ===== Who may review =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$,
  '42501', null, 'A rep cannot review');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$,
  '42501', null, 'The GM cannot review the price he set');

-- ===== Bad input =====
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','maybe')$$,
  '23514', null, 'An unknown decision is refused');
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','return','   ')$$,
  '23514', null, 'A return needs a reason');

-- ===== Return to Kalas =====
select lives_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','return','Check the crane line')$$,
  'Finance returns the price with a reason');
reset role;
select is((select state::text from public.pricing_files where id = '8a600001-0000-0000-0000-000000000001'), 'selling_build',
  'The file follows the price back to the selling build');
select is((select p.return_reason from public.internal_prices p join public.pricing_files f on f.internal_price_id = p.id
            where f.id = '8a600001-0000-0000-0000-000000000001'), 'Check the crane line',
  'The reason stays on the price');
select ok(exists (select 1 from public.notifications where notification_type = 'pricing_price_returned'
                   and recipient_user_id = '8a000000-0000-0000-0000-000000000003'),
  'The GM is told the price came back');
select ok(not exists (select 1 from public.notifications where notification_type like 'pricing_%' and body like '%crane%'),
  'No notice carries the reason');

-- ===== Review only in price review =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$,
  'P0001', null, 'Nothing to review outside price review');

-- Kalas rebuilds and proposes again (build in its own statement).
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_build_price('8a600001-0000-0000-0000-000000000001')$$, 'Kalas rebuilds');
select lives_ok($$select public.pricing_file_propose('8a600001-0000-0000-0000-000000000001', 53200, 39900)$$, 'Kalas proposes again');

-- ===== Approve =====
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_review('8a600001-0000-0000-0000-000000000001','approve')$$, 'Finance approves');
reset role;
select is((select state::text from public.pricing_files where id = '8a600001-0000-0000-0000-000000000001'), 'approved',
  'The file follows the price to approved');
select ok(exists (select 1 from public.notifications where notification_type = 'pricing_price_approved'
                   and recipient_user_id = '8a000000-0000-0000-0000-000000000001'), 'The rep is told');
select ok(exists (select 1 from public.notifications where notification_type = 'pricing_price_approved'
                   and recipient_user_id = '8a000000-0000-0000-0000-000000000004'), 'The BD manager is told');
select is((select count(*)::int from public.audit_log where action = 'pricing_file.reviewed'
             and entity_id = '8a200001-0000-0000-0000-000000000001'), 2, 'Both reviews are audited');

-- ===== Rights =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_my_rights()->>'is_finance')::boolean, true, 'Finance sees is_finance');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_my_rights()->>'can_issue_quotation')::boolean, true, 'The BD manager may issue');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_my_rights()->>'can_issue_quotation')::boolean, false, 'A rep may not issue');

-- ===== needs_info tells the rep =====
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_set_needs_info('8a600002-0000-0000-0000-000000000001', array['Location plan'], current_date + 3);
reset role;
select ok(exists (select 1 from public.notifications where notification_type = 'pricing_needs_info'
                   and recipient_user_id = '8a000000-0000-0000-0000-000000000001'), 'The rep is told what is missing');

select * from finish();
rollback;
