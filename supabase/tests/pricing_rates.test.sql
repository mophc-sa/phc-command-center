-- Rates and the supplier's screen price are cost: pricers read and write them; BD and reps never.
-- Test user UUIDs use the 5c… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5c000000-0000-0000-0000-000000000001','authenticated','authenticated','pr-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5c000000-0000-0000-0000-000000000003','authenticated','authenticated','pr-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5c000000-%';
insert into public.user_roles (user_id, role) values
  ('5c000000-0000-0000-0000-000000000001','bd_manager'),
  ('5c000000-0000-0000-0000-000000000003','estimation_manager');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5c000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select lives_ok($$insert into public.installation_rates (install_type, base_rate) values ('double_tape', 150)$$,
  'A pricer adds an installation rate');
select lives_ok($$insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
  values ('concrete_base','Concrete base','قاعدة خرسانية','item', 1200, array['pylon','floor']::public.install_type[])$$,
  'A pricer adds a catalog extra');
select lives_ok($$update public.logistics_rates set value = 12000 where key = 'container_rate'$$,
  'A pricer updates a logistics rate');
select is((select count(*)::int from public.logistics_rates), 5, 'Five logistics keys are seeded');

select set_config('request.jwt.claims','{"sub":"5c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.installation_rates), 0, 'The BD manager reads no installation rates (the sales manager does, Task 6)');
select throws_ok($$select unit_cost_with_screen from public.supplier_quote_lines limit 1$$,
  '42501', null, 'The screen price is revoked like every supplier cost');
select throws_ok($$insert into public.installation_rates (install_type, base_rate) values ('pylon', 1)$$,
  '42501', null, 'Sales cannot write rates');
select lives_ok($$select install_type, width_mm, has_screen from public.boq_lines limit 1$$,
  'The new line attributes are readable (they are not cost)');
reset role;
select * from finish();
rollback;
