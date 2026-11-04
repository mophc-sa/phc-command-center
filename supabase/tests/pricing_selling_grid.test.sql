-- PR 2, part 5: per-line choices and the cost-gated selling grid.
-- Worked example: 2 lines, 1 container to Riyadh with clearing, one accepted extra.
--   L1 pylon x2 at 5000, pylon rate 1000      -> materials 10000, installation 2000
--   L2 ceiling x4 with screen at 1500 (1000)  -> materials 6000, installation 10% = 600
--   extras 3000; logistics 12000 + 5% x 16000 + 500 + 5000 = 18300; overhead 0
--   L1 cost 25741.94 -> at 25%: 34322.58; L2 cost 14158.06 -> 18877.42
--   total cost 39900.00, total selling 53200.00, margin 25.00
-- Test user UUIDs use the 6e… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6e000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','sg-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,5) n;
update public.profiles set status = 'active' where id::text like '6e000000-%';
insert into public.user_roles (user_id, role) values
  ('6e000000-0000-0000-0000-000000000001','salesperson'),
  ('6e000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6e000000-0000-0000-0000-000000000002','finance_manager'),
  ('6e000000-0000-0000-0000-000000000003','general_manager'),
  ('6e000000-0000-0000-0000-000000000004','bd_manager'),
  ('6e000000-0000-0000-0000-000000000005','sales_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 2000  where key = 'delivery_jeddah';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('6e100000-0000-0000-0000-000000000001','sg-vendor');

insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'sg-deal-' || n,
       '6e000000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title) values
  ('6e400001-0000-0000-0000-000000000001','6e200001-0000-0000-0000-000000000001','sg-boq-1'),
  ('6e400002-0000-0000-0000-000000000001','6e200002-0000-0000-0000-000000000001','sg-boq-2');
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6e500001-0000-0000-0000-000000000001','6e400001-0000-0000-0000-000000000001',1),
  ('6e500002-0000-0000-0000-000000000001','6e400002-0000-0000-0000-000000000001',1);
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen, mount_height_m) values
  ('6e510001-0000-0000-0000-000000000001','6e500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false,null),
  ('6e510002-0000-0000-0000-000000000001','6e500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true,3),
  ('6e510003-0000-0000-0000-000000000001','6e500002-0000-0000-0000-000000000001',1,'Wall W1',1,null,false,null);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status)
values ('6e520001-0000-0000-0000-000000000001','6e500001-0000-0000-0000-000000000001','6e100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen) values
  ('6e520001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001',5000,2,10000,null),
  ('6e520001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001',1000,4,4000,1500);
update public.boq_revisions set frozen_at = now(), frozen_by = '6e000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('6e500001-0000-0000-0000-000000000001','6e500002-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('6e600001-0000-0000-0000-000000000001','6e200001-0000-0000-0000-000000000001','supplier_priced','6e500001-0000-0000-0000-000000000001'),
  ('6e600002-0000-0000-0000-000000000001','6e200002-0000-0000-0000-000000000001','supplier_priced','6e500002-0000-0000-0000-000000000001');
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('6e600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate)
values ('6e900001-0000-0000-0000-000000000001','sg_crane','Crane','رافعة','lump',3000);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('6e600001-0000-0000-0000-000000000001','6e900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- ===== Cost isolation =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_selling_grid), 0, 'The deal''s own rep reads no grid');
select is((select count(*)::int from public.pricing_selling_totals), 0, 'The rep reads no totals');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_selling_grid), 0, 'The BD manager reads no grid');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_selling_grid where file_id = '6e600001-0000-0000-0000-000000000001'), 2,
  'The sales manager reads the grid');

-- ===== The worked example, as Zayed =====
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 10000.00::numeric, 'L1 materials');
select is((select installation from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 2000.00::numeric, 'L1 installation from the pylon rate');
select is((select install_basis from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 'rate', 'L1 basis is the rate card');
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 6000.00::numeric, 'L2 takes the screen price, as its drawing has a screen');
select is((select installation from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 600.00::numeric, 'L2 installation falls back to 10% (no ceiling rate)');
select is((select install_basis from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 'fallback', 'L2 basis is the fallback');
select is((select extras_alloc from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 1935.48::numeric, 'L1 carries its share of the extras');
select is((select logistics_alloc from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 11806.45::numeric, 'L1 carries its share of logistics');
select is((select line_cost from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 25741.94::numeric, 'L1 cost');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 34322.58::numeric, 'L1 sells at the default 25% margin on price');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 18877.42::numeric, 'L2 selling');
select is((select total_cost from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 39900.00::numeric, 'Total cost');
select is((select total_selling from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 53200.00::numeric, 'Total selling');
select is((select margin_pct from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 25.00::numeric, 'Margin on price');
select is((select logistics_total from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 18300.00::numeric, 'Logistics total');
select is((select unpriced_lines from public.pricing_selling_totals where file_id = '6e600002-0000-0000-0000-000000000001'), 1, 'A line with no supplier price is counted unpriced');

-- ===== An MFA role on a password-only session reads nothing and writes nothing =====
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::int from public.pricing_selling_grid), 0, 'A GM session at aal1 reads no grid rows');
select is((select count(*)::int from public.pricing_selling_totals), 0, 'A GM session at aal1 reads no totals');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"use_screen_price":true}')$$,
  '42501', null, 'A GM session at aal1 cannot set a line choice');

-- ===== Overhead is pinned: the file carries 10% =====
reset role;
update public.pricing_file_inputs set overhead_pct = 10 where file_id = '6e600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
-- L1: (10000 + 2000 + 1935.48 + 11806.45) x 1.10 = 25741.94 x 1.10 = 28316.13
select is((select line_cost from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 28316.13::numeric, 'L1 cost carries 10% overhead');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 37754.84::numeric, 'L1 sells at 25% on the loaded cost');
-- 39900 x 1.10 = 43890
select is((select total_cost from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 43890.00::numeric, 'Total cost carries 10% overhead');
select is((select total_selling from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 58520.00::numeric, 'Total selling with overhead');
select is((select margin_pct from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 25.00::numeric, 'Margin on price is unchanged by overhead');
reset role;
update public.pricing_file_inputs set overhead_pct = 0 where file_id = '6e600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);

-- ===== Line choices =====
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"use_screen_price":true}')$$,
  '42501', null, 'A rep cannot set line choices');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  '42501', null, 'Zayed cannot set a margin: the GM sets the selling price');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"use_screen_price":false}')$$,
  'Zayed picks the normal price for L2');
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 4000.00::numeric, 'L2 now uses the normal price');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"use_screen_price":null}')$$,
  'Zayed goes back to the default');
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 6000.00::numeric, 'L2 follows its drawing again');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"install_type":"pylon"}')$$,
  'Zayed overrides L2''s install type');
select is((select installation from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'), 4000.00::numeric, 'The override uses the pylon rate');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"install_type":null}')$$,
  'Zayed clears the override');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  'P0001', null, 'Margins are set in the selling build');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6e600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  'Kalas sets 30% on L1');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510001-0000-0000-0000-000000000001'), 36774.19::numeric, 'L1 at 30%');
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"selling_price":20000}')$$,
  'Kalas types a selling price for L2');
select is((select total_selling from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 56774.19::numeric, 'Totals follow');
select is((select margin_pct from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 29.72::numeric, 'The margin is computed, never typed');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"margin_pct":30,"selling_price":1}')$$,
  '23514', null, 'A margin and a selling price on one line are refused');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510003-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  '23514', null, 'A line of another BOQ is refused');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"install_type":"roof"}')$$,
  '23514', null, 'An unknown install type is refused');
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"discount":5}')$$,
  '23514', null, 'An unknown key is refused');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_lines), 0, 'The rep reads no line choices');
select is((select count(*)::int from public.pricing_file_inputs), 0, 'The rep reads no inputs');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_lines), 0, 'The BD manager reads no line choices');
select is((select count(*)::int from public.pricing_file_inputs), 0, 'The BD manager reads no inputs');
select is((select count(*)::int from public.pricing_selling_totals), 0, 'The BD manager reads no totals');
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select ok((select count(*)::int from public.pricing_file_lines where file_id = '6e600001-0000-0000-0000-000000000001') > 0,
  'The sales manager (management) reads the line choices');

-- ===== The floor =====
reset role;
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (30, now() - interval '1 day', 'sg-floor');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select floor_pct from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), 30.00::numeric, 'The floor in force');
select ok((select below_floor from public.pricing_selling_totals where file_id = '6e600001-0000-0000-0000-000000000001'), '29.72% is below a 30% floor');
reset role;

-- ===== More fixtures: a USD BOQ (deal 3) and a messy SAR one (deal 4) =====
reset role;
insert into public.vendors (id, name) values
  ('6e100000-0000-0000-0000-000000000002','sg-vendor-2'),
  ('6e100000-0000-0000-0000-000000000003','sg-vendor-3');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'sg-deal-' || n,
       '6e000000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(3,4) n;
insert into public.boqs (id, related_opportunity_id, title, currency) values
  ('6e400003-0000-0000-0000-000000000001','6e200003-0000-0000-0000-000000000001','sg-boq-3','USD'),
  ('6e400004-0000-0000-0000-000000000001','6e200004-0000-0000-0000-000000000001','sg-boq-4','SAR');
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6e500003-0000-0000-0000-000000000001','6e400003-0000-0000-0000-000000000001',1),
  ('6e500004-0000-0000-0000-000000000001','6e400004-0000-0000-0000-000000000001',1);
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, has_screen) values
  ('6e510031-0000-0000-0000-000000000001','6e500003-0000-0000-0000-000000000001',1,'Wall USD',1,false),
  ('6e510041-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001',1,'M1',1,false),
  ('6e510042-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001',2,'M2 screen',1,true),
  ('6e510043-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001',3,'M3 unquoted',1,false);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status, is_current, cancel_reason, created_at) values
  ('6e520003-0000-0000-0000-000000000001','6e500003-0000-0000-0000-000000000001','6e100000-0000-0000-0000-000000000001','USD','responses_received',true,null, now()),
  ('6e520004-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001','6e100000-0000-0000-0000-000000000001','SAR','responses_received',true,null, now()),
  ('6e520005-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001','6e100000-0000-0000-0000-000000000002','SAR','cancelled',true,'sg test', now() + interval '1 hour'),
  ('6e520006-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001','6e100000-0000-0000-0000-000000000003','SAR','superseded',false,null, now() + interval '2 hours');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen) values
  ('6e520003-0000-0000-0000-000000000001','6e510031-0000-0000-0000-000000000001',1000,1,1000,null),
  ('6e520004-0000-0000-0000-000000000001','6e510041-0000-0000-0000-000000000001',1000,1,1000,null),
  ('6e520004-0000-0000-0000-000000000001','6e510042-0000-0000-0000-000000000001',500,1,500,null),
  ('6e520005-0000-0000-0000-000000000001','6e510041-0000-0000-0000-000000000001',50,1,50,null),
  ('6e520006-0000-0000-0000-000000000001','6e510041-0000-0000-0000-000000000001',60,1,60,null);
update public.boq_revisions set frozen_at = now(), frozen_by = '6e000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('6e500003-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('6e600003-0000-0000-0000-000000000001','6e200003-0000-0000-0000-000000000001','supplier_priced','6e500003-0000-0000-0000-000000000001'),
  ('6e600004-0000-0000-0000-000000000001','6e200004-0000-0000-0000-000000000001','selling_build','6e500004-0000-0000-0000-000000000001');
-- Deal 4: Jeddah delivery, no clearing, no containers.
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('6e600004-0000-0000-0000-000000000001', 0, 'jeddah', false, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate, active) values
  ('6e900002-0000-0000-0000-000000000001','sg_xtwo','X2','س٢','lump',1000, true),
  ('6e900003-0000-0000-0000-000000000001','sg_xthree','X3','س٣','lump',700, true),
  ('6e900004-0000-0000-0000-000000000001','sg_xfour','X4','س٤','lump',800, true),
  ('6e900005-0000-0000-0000-000000000001','sg_xfive','X5','س٥','lump',900, true);
-- Only the accepted extra of the current round counts: 1000.
insert into public.pricing_file_extras (file_id, boq_revision_id, catalog_id, quantity, rate, status, dismiss_reason, decided_at) values
  ('6e600004-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001','6e900002-0000-0000-0000-000000000001',1,1000,'accepted',null,now()),
  ('6e600004-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001','6e900003-0000-0000-0000-000000000001',1,700,'suggested',null,null),
  ('6e600004-0000-0000-0000-000000000001','6e500004-0000-0000-0000-000000000001','6e900004-0000-0000-0000-000000000001',1,800,'dismissed','sg',now()),
  ('6e600004-0000-0000-0000-000000000001','6e500002-0000-0000-0000-000000000001','6e900005-0000-0000-0000-000000000001',1,900,'accepted',null,now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);

-- ===== A quote in another currency is not priced =====
select ok((select currency_mismatch and unpriced and materials is null and selling_price is null
             from public.pricing_selling_grid where boq_line_id = '6e510031-0000-0000-0000-000000000001'),
  'A USD quote line is flagged, unpriced, with no materials and no selling price');
select is((select non_sar_lines from public.pricing_selling_totals where file_id = '6e600003-0000-0000-0000-000000000001'), 1, 'The totals count the non-SAR line');
select ok((select not currency_mismatch from public.pricing_selling_grid where boq_line_id = '6e510041-0000-0000-0000-000000000001'), 'A SAR quote line is not flagged');

-- ===== Delivery, clearing, extras, quotes, screen price (deal 4) =====
select is((select logistics_total from public.pricing_selling_totals where file_id = '6e600004-0000-0000-0000-000000000001'), 2075.00::numeric,
  'Jeddah delivery 2000 + customs 5% of 1500; no clearing fee');
select is((select extras_total from public.pricing_selling_totals where file_id = '6e600004-0000-0000-0000-000000000001'), 1000.00::numeric,
  'Suggested, dismissed and old-round extras are left out');
select is((select materials from public.pricing_selling_grid where boq_line_id = '6e510041-0000-0000-0000-000000000001'), 1000.00::numeric,
  'A cancelled and a superseded quote are skipped');
select ok((select screen_price_missing from public.pricing_selling_grid where boq_line_id = '6e510042-0000-0000-0000-000000000001'),
  'A screen line with no with-screen price is flagged');
select is((select screen_price_missing_lines from public.pricing_selling_totals where file_id = '6e600004-0000-0000-0000-000000000001'), 1, 'The totals count it');
select is((select selling_price from public.pricing_selling_grid where boq_line_id = '6e510041-0000-0000-0000-000000000001'), 4200.00::numeric, 'M1 sells at 25% on price');

-- ===== No final margin while a line is unpriced =====
select is((select unpriced_lines from public.pricing_selling_totals where file_id = '6e600004-0000-0000-0000-000000000001'), 1, 'M3 has no quote');
select is((select total_selling from public.pricing_selling_totals where file_id = '6e600004-0000-0000-0000-000000000001'), 6300.00::numeric, 'The sums stay');
select ok((select margin_pct is null and below_floor is null from public.pricing_selling_totals where file_id = '6e600004-0000-0000-0000-000000000001'),
  'margin_pct and below_floor are NULL while a line is unpriced');
select ok((select margin_pct is null and below_floor is null from public.pricing_selling_totals where file_id = '6e600003-0000-0000-0000-000000000001'),
  'Same for a file with only a non-SAR line');

-- ===== A margin clears a typed price; a typed price must be positive =====
select lives_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510002-0000-0000-0000-000000000001','{"margin_pct":20}')$$,
  'Kalas sets a margin on the line that had a typed price');
select ok((select typed_selling_price is null and line_margin_pct = 20 from public.pricing_selling_grid where boq_line_id = '6e510002-0000-0000-0000-000000000001'),
  'The margin cleared the typed price');
reset role;
select ok((select (before_value->>'selling_price')::numeric = 20000 from public.audit_log
            where action = 'pricing_file.line_set' and (after_value->'choice') = '{"margin_pct":20}'::jsonb),
  'The audit row keeps the previous typed price');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_line('6e600001-0000-0000-0000-000000000001','6e510001-0000-0000-0000-000000000001','{"selling_price":0}')$$,
  '23514', null, 'A typed selling price of 0 is refused');

-- ===== No default margin anywhere: no price, never 0% =====
reset role;
delete from public.logistics_rates where key = 'default_margin_pct';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select ok((select selling_price is null and margin_pct is null and unpriced
             from public.pricing_selling_grid where boq_line_id = '6e510041-0000-0000-0000-000000000001'),
  'With no default margin a line without its own margin has no price');
reset role;

-- ===== Edges: no price yet, anon, audit =====
select ok(has_table_privilege('authenticated','public.pricing_selling_grid','select')
          and not has_table_privilege('anon','public.pricing_selling_grid','select')
          and not has_table_privilege('anon','public.pricing_selling_totals','select'), 'Views are for authenticated, not anon');
select ok((select count(*) from public.audit_log where action = 'pricing_file.line_set') >= 1, 'A line choice is audited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select ok((select materials is null and selling_price is null and unpriced and line_cost is not null
             from public.pricing_selling_grid where boq_line_id = '6e510003-0000-0000-0000-000000000001'),
  'A line with no supplier price has no materials and no selling price, and no error');
reset role;
select * from finish();
rollback;
