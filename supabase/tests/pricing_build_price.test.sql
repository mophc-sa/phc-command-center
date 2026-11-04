-- PR 2, part 6: Kalas builds the price from the grid and proposes it; Phase 8's
-- margin and floor rules apply unchanged; Zayed can return and approve it.
-- Same worked example as pricing_selling_grid: cost 39900.00, selling 53200.00 at 25%.
-- Test user UUIDs use the 6f… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6f000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','bp-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,3) n;
update public.profiles set status = 'active' where id::text like '6f000000-%';
insert into public.user_roles (user_id, role) values
  ('6f000000-0000-0000-0000-000000000001','salesperson'),
  ('6f000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6f000000-0000-0000-0000-000000000002','finance_manager'),
  ('6f000000-0000-0000-0000-000000000003','general_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('6f100000-0000-0000-0000-000000000001','bp-vendor');

-- Deal 1: the worked example. Deal 2: a supplier line already selected. Deal 3: an unpriced line.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'bp-deal-' || n,
       '6f000000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,3) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('6f40000' || n || '-0000-0000-0000-000000000001')::uuid, ('6f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'bp-boq-' || n
  from generate_series(1,3) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('6f50000' || n || '-0000-0000-0000-000000000001')::uuid, ('6f40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,3) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen) values
  ('6f510001-0000-0000-0000-000000000001','6f500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false),
  ('6f510002-0000-0000-0000-000000000001','6f500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true),
  ('6f510003-0000-0000-0000-000000000001','6f500002-0000-0000-0000-000000000001',1,'Wall W1',1,null,false),
  ('6f510004-0000-0000-0000-000000000001','6f500003-0000-0000-0000-000000000001',1,'Wall W2',1,null,false);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status) values
  ('6f520001-0000-0000-0000-000000000001','6f500001-0000-0000-0000-000000000001','6f100000-0000-0000-0000-000000000001','SAR','responses_received'),
  ('6f520002-0000-0000-0000-000000000001','6f500002-0000-0000-0000-000000000001','6f100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen, is_selected, selected_by, selected_at) values
  ('6f520001-0000-0000-0000-000000000001','6f510001-0000-0000-0000-000000000001',5000,2,10000,null,false,null,null),
  ('6f520001-0000-0000-0000-000000000001','6f510002-0000-0000-0000-000000000001',1000,4,4000,1500,false,null,null),
  ('6f520002-0000-0000-0000-000000000001','6f510003-0000-0000-0000-000000000001',700,1,700,null,true,'6f000000-0000-0000-0000-000000000002',now());
update public.boq_revisions set frozen_at = now(), frozen_by = '6f000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '6f50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
select ('6f60000' || n || '-0000-0000-0000-000000000001')::uuid, ('6f20000' || n || '-0000-0000-0000-000000000001')::uuid,
       (case n when 1 then 'supplier_priced' else 'selling_build' end)::public.pricing_file_state,
       ('6f50000' || n || '-0000-0000-0000-000000000001')::uuid
  from generate_series(1,3) n;
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('6f600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate) values
  ('6f900001-0000-0000-0000-000000000001','bp_crane','Crane','رافعة','lump',3000),
  ('6f900002-0000-0000-0000-000000000001','bp_scaffold','Scaffold','سقالة','lump',800);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('6f600001-0000-0000-0000-000000000001','6f900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- ===== Who builds, and when =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  '42501', null, 'Zayed cannot build the selling price: the GM sets it');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'The price is built in the selling build');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6f600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);

-- ===== Build =====
select is((public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001'))->>'total_selling', '53200.00',
  'Kalas builds the price from the grid');
select ok(exists (select 1 from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'
                   and estimation_id is not null and internal_price_id is not null), 'The file links its estimation and price');
select is((select p.status::text || '/' || p.proposed_price::text from public.internal_prices p
             join public.pricing_files f on f.internal_price_id = p.id where f.id = '6f600001-0000-0000-0000-000000000001'),
  'internal_price_proposed/53200.00', 'The price is a proposal at the grid''s total');
select is((select e.cost_total::text || '/' || e.installation_cost::text || '/' || e.wastage_pct::text from public.estimations e
             join public.pricing_files f on f.estimation_id = e.id where f.id = '6f600001-0000-0000-0000-000000000001'),
  '37300.00/2600.00/0.00', 'The estimation holds materials + extras + logistics, installation, no wastage');
select is((select public.estimation_cost_basis(f.estimation_id) from public.pricing_files f where f.id = '6f600001-0000-0000-0000-000000000001'),
  39900.00::numeric, 'Phase 8''s cost basis equals the grid''s total cost');
select is((select s.margin_percentage from public.internal_price_summary s join public.pricing_files f on f.internal_price_id = s.id
            where f.id = '6f600001-0000-0000-0000-000000000001'), 25.00::numeric,
  'The margin Phase 8 computes is the margin the grid shows');
select is((select p.figure_set_by::text from public.internal_prices p join public.pricing_files f on f.internal_price_id = p.id
            where f.id = '6f600001-0000-0000-0000-000000000001'),
  '6f000000-0000-0000-0000-000000000003', 'Kalas set the figure');
select is((select built_selling_price from public.pricing_file_lines where boq_line_id = '6f510001-0000-0000-0000-000000000001'),
  34322.58::numeric, 'Each line''s selling price is kept with the build');

-- ===== Rebuild after a change =====
select lives_ok($$select public.pricing_file_set_line('6f600001-0000-0000-0000-000000000001','6f510001-0000-0000-0000-000000000001','{"margin_pct":30}')$$,
  'Kalas raises L1 to 30%');
select is((public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001'))->>'total_selling', '55651.61',
  'Rebuilding updates the same price');
select is((select count(*)::int from public.estimations where boq_revision_id = '6f500001-0000-0000-0000-000000000001'), 1,
  'The estimation is reused, not duplicated');

-- ===== Propose =====
select throws_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 53200)$$,
  'P0001', null, 'A stale total is refused');
select is((select p.status::text from public.internal_prices p join public.pricing_files f on f.internal_price_id = p.id
            where f.id = '6f600001-0000-0000-0000-000000000001'), 'internal_price_proposed', '... and nothing moved');
reset role;
insert into public.pricing_file_extras (file_id, catalog_id, rate)
values ('6f600001-0000-0000-0000-000000000001','6f900002-0000-0000-0000-000000000001',800);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61)$$,
  'P0001', null, 'An undecided suggestion blocks Propose');
reset role;
update public.pricing_file_extras set status = 'dismissed', dismiss_reason = 'Not needed', decided_at = now()
 where catalog_id = '6f900002-0000-0000-0000-000000000001';
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (40, now() - interval '1 day', 'bp-floor');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61)$$,
  '23514', null, 'Below the floor, Propose needs a justification (Phase 8 guard)');
select lives_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61, 'Strategic first job with this client')$$,
  'Kalas proposes with a justification');
select is((select state::text from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'), 'price_review',
  'The file goes to Zayed''s price review');
select is((select p.status::text || '/' || p.proposed_by::text from public.internal_prices p
             join public.pricing_files f on f.internal_price_id = p.id where f.id = '6f600001-0000-0000-0000-000000000001'),
  'gm_pending/6f000000-0000-0000-0000-000000000003', 'Kalas is the proposer');
select throws_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'Nothing is rebuilt under review');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.estimations set cost_total = 1 where id = (select estimation_id from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'The cost basis is frozen under review');

-- ===== Zayed returns it; Kalas rebuilds and proposes again; Zayed approves =====
select lives_ok($$update public.internal_prices set status = 'returned', return_reason = 'Check the logistics'
                   where id = (select internal_price_id from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001')$$,
  'Zayed returns the price');
select is((select state::text from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'), 'selling_build',
  'The file is back with Kalas');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
-- Build in its own statement: a query that calls it cannot see what it wrote.
select lives_ok($$select public.pricing_file_build_price('6f600001-0000-0000-0000-000000000001')$$,
  'Kalas rebuilds the returned price');
select is((select p.status::text from public.internal_prices p join public.pricing_files f on f.internal_price_id = p.id
            where f.id = '6f600001-0000-0000-0000-000000000001'),
  'internal_price_proposed', 'Rebuilding a returned price makes it a proposal again');
select lives_ok($$select public.pricing_file_propose('6f600001-0000-0000-0000-000000000001', 55651.61, 'Strategic first job with this client')$$,
  'Kalas proposes again');
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_approved'
                   where id = (select internal_price_id from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001')$$,
  'Zayed approves the price Kalas set (he set no figure)');
select is((select state::text from public.pricing_files where id = '6f600001-0000-0000-0000-000000000001'), 'approved',
  'The file is approved');

-- ===== Refusals on the other two deals =====
select set_config('request.jwt.claims','{"sub":"6f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_build_price('6f600002-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A supplier line already marked selected would make Phase 8 ignore the grid, so it is refused');
select throws_ok($$select public.pricing_file_build_price('6f600003-0000-0000-0000-000000000001')$$,
  'P0001', null, 'An unpriced line is refused');

-- ===== Extra: the figure and the proposal are Kalas's; the lines sum to the price =====
select is((select p.figure_set_by::text || '/' || p.proposed_by::text from public.internal_prices p
             join public.pricing_files f on f.internal_price_id = p.id where f.id = '6f600001-0000-0000-0000-000000000001'),
  '6f000000-0000-0000-0000-000000000003/6f000000-0000-0000-0000-000000000003', 'Kalas is both figure_set_by and proposed_by');
select is((select sum(built_selling_price) from public.pricing_file_lines where file_id = '6f600001-0000-0000-0000-000000000001'),
  55651.61::numeric, 'The per-line built prices sum exactly to the approved price');
reset role;
select * from finish();
rollback;
