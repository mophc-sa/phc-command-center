-- Rates and the supplier's screen price are cost: pricers read and write them; BD and reps never.
-- Test user UUIDs use the 5c… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5c000000-0000-0000-0000-000000000001','authenticated','authenticated','pr-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5c000000-0000-0000-0000-000000000003','authenticated','authenticated','pr-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5c000000-%';
insert into public.user_roles (user_id, role) values
  ('5c000000-0000-0000-0000-000000000001','bd_manager'),
  ('5c000000-0000-0000-0000-000000000003','estimation_manager');

-- One real supplier line (777 with screen) so the cost-view assertions test data, not emptiness.
-- bd_manager is a pipeline operator, so can_read_boq_revision passes for them: only the cost gate hides the row.
insert into public.vendors (id, name) values ('5c100000-0000-0000-0000-000000000001','pr-vendor');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5c200000-0000-0000-0000-000000000001','pr-deal','5c000000-0000-0000-0000-000000000001','5c000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('5c400000-0000-0000-0000-000000000001','5c200000-0000-0000-0000-000000000001','pr-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('5c500000-0000-0000-0000-000000000001','5c400000-0000-0000-0000-000000000001',1);
insert into public.boq_lines (id, revision_id, sign_type, quantity) values ('5c600000-0000-0000-0000-000000000001','5c500000-0000-0000-0000-000000000001','pylon',1);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id) values ('5c700000-0000-0000-0000-000000000001','5c500000-0000-0000-0000-000000000001','5c100000-0000-0000-0000-000000000001');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, unit_cost_with_screen, quantity)
values ('5c700000-0000-0000-0000-000000000001','5c600000-0000-0000-0000-000000000001',500,777,1);

-- Final review M4: a change with no session (a migration, a script) is audited
-- as the system's, not as a user's.
update public.logistics_rates set note = 'pr-system-edit' where key = 'clearing_fee';
select is((select actor_type from public.audit_log where action = 'logistics_rates.updated'
            and after_value->>'note' = 'pr-system-edit'), 'system', 'A change with no session is audited as the system');
select is((select proconfig::text from pg_proc where oid = 'public.logistics_rates_stamp()'::regprocedure),
  '{search_path=public}', 'The logistics stamp runs with a fixed search_path');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5c000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select lives_ok($$insert into public.installation_rates (install_type, base_rate) values ('double_tape', 150)$$,
  'A pricer adds an installation rate');
select lives_ok($$insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
  values ('concrete_base','Concrete base','قاعدة خرسانية','item', 1200, array['pylon','floor']::public.install_type[])$$,
  'A pricer adds a catalog extra');
select lives_ok($$update public.logistics_rates set value = 13000 where key = 'container_rate'$$,
  'A pricer updates a logistics rate');
select is((select value from public.logistics_rates where key = 'container_rate'), 13000::numeric,
  'The logistics update really changed the value');
select is((select updated_by from public.logistics_rates where key = 'container_rate'),
  '5c000000-0000-0000-0000-000000000003'::uuid, 'The update is stamped with the pricer');
select lives_ok($$insert into public.installation_rates (install_type, base_rate, created_by)
  values ('ceiling', 90, '5c000000-0000-0000-0000-000000000001')$$,
  'A pricer inserts a rate that claims another author');
select is((select created_by from public.installation_rates where install_type = 'ceiling'),
  '5c000000-0000-0000-0000-000000000003'::uuid, 'A client-supplied created_by is ignored');
select lives_ok($$update public.installation_rates set created_by = '5c000000-0000-0000-0000-000000000001'
  where install_type = 'ceiling'$$, 'A pricer tries to rewrite the author');
select is((select created_by from public.installation_rates where install_type = 'ceiling'),
  '5c000000-0000-0000-0000-000000000003'::uuid, 'The author cannot be rewritten');
select is((select count(*)::int from public.supplier_quote_costs), 1,
  'A pricer sees the supplier line in the cost view');
select is((select unit_cost_with_screen from public.supplier_quote_costs), 777::numeric,
  'A pricer reads the screen price through the cost view');
select is((select count(*)::int from public.logistics_rates), 5, 'Five logistics keys are seeded');

select set_config('request.jwt.claims','{"sub":"5c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.installation_rates), 0, 'The BD manager reads no installation rates (the sales manager does, Task 6)');
select throws_ok($$select unit_cost_with_screen from public.supplier_quote_lines limit 1$$,
  '42501', null, 'The screen price is revoked like every supplier cost');
select throws_ok($$insert into public.installation_rates (install_type, base_rate) values ('pylon', 1)$$,
  '42501', null, 'Sales cannot write rates');
select lives_ok($$select install_type, width_mm, has_screen from public.boq_lines limit 1$$,
  'The new line attributes are readable (they are not cost)');
select is((select count(*)::int from public.supplier_quote_costs), 0,
  'The BD manager sees no rows in the cost view even though the line exists and the BOQ is readable to them');
select lives_ok($$update public.logistics_rates set value = 1 where key = 'container_rate'$$,
  'A BD manager logistics update is accepted as a statement');
select set_config('request.jwt.claims','{"sub":"5c000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select value from public.logistics_rates where key = 'container_rate'), 13000::numeric,
  'The BD manager update changed nothing');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'installation_rates.inserted'
  and entity_type = 'installation_rates' and actor_id = '5c000000-0000-0000-0000-000000000003'),
  'Inserting a rate is audited');
select ok(exists (select 1 from public.audit_log where action = 'logistics_rates.updated'
  and (before_value->>'value')::numeric = 12000 and (after_value->>'value')::numeric = 13000
  and after_value->>'key' = 'container_rate' and actor_id = '5c000000-0000-0000-0000-000000000003'),
  'Updating a logistics rate is audited with before and after');
select * from finish();
rollback;
