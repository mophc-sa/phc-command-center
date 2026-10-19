-- Opportunity money fields (quotation, estimate min/max, contract value):
-- only Finance or the BD Manager may change them; service-role writes pass.
-- Migration 20261023100000. Test user UUIDs use the 4d… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','4d000000-0000-0000-0000-000000000001','authenticated','authenticated','mg-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4d000000-0000-0000-0000-000000000002','authenticated','authenticated','mg-salesmgr+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4d000000-0000-0000-0000-000000000003','authenticated','authenticated','mg-bd+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4d000000-0000-0000-0000-000000000004','authenticated','authenticated','mg-admin+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '4d000000-%';
insert into public.user_roles (user_id, role) values
  ('4d000000-0000-0000-0000-000000000001','salesperson'),
  ('4d000000-0000-0000-0000-000000000002','sales_manager'),
  ('4d000000-0000-0000-0000-000000000003','bd_manager'),
  ('4d000000-0000-0000-0000-000000000004','system_admin');
insert into public.opportunities (id, project_name, owner_id, created_by, quotation_value, estimated_value_min, estimated_value_max, contract_value)
values ('4d200000-0000-0000-0000-000000000001', 'money-guard-deal', '4d000000-0000-0000-0000-000000000001',
        '4d000000-0000-0000-0000-000000000001', 100000, 80000, 120000, null);

set local role authenticated;

-- The deal's owner, a salesperson.
select set_config('request.jwt.claims','{"sub":"4d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$update public.opportunities set quotation_value = 1 where id = '4d200000-0000-0000-0000-000000000001'$$,
  '42501', null, 'The owner cannot change the quotation value');
select throws_ok($$update public.opportunities set estimated_value_min = 1 where id = '4d200000-0000-0000-0000-000000000001'$$,
  '42501', null, '... nor the minimum estimate');
select throws_ok($$update public.opportunities set estimated_value_max = 1 where id = '4d200000-0000-0000-0000-000000000001'$$,
  '42501', null, '... nor the maximum estimate');
select throws_ok($$update public.opportunities set contract_value = 1 where id = '4d200000-0000-0000-0000-000000000001'$$,
  '42501', null, '... nor the contract value');
select lives_ok($$update public.opportunities set quotation_value = 100000, next_action = 'Call the PM' where id = '4d200000-0000-0000-0000-000000000001'$$,
  'Resending the same value with another edit is not a change and passes');

-- A sales manager can update any deal under RLS but holds no value authority.
select set_config('request.jwt.claims','{"sub":"4d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.opportunities set contract_value = 500000 where id = '4d200000-0000-0000-0000-000000000001'$$,
  '42501', null, 'A sales manager cannot set the contract value');

-- system_admin has no commercial authority (20260812100000).
select set_config('request.jwt.claims','{"sub":"4d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.opportunities set quotation_value = 2 where id = '4d200000-0000-0000-0000-000000000001'$$,
  '42501', null, 'A system admin cannot change a value either');

-- The BD Manager sets them.
select set_config('request.jwt.claims','{"sub":"4d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select lives_ok($$update public.opportunities set quotation_value = 150000, estimated_value_max = 160000, contract_value = 140000 where id = '4d200000-0000-0000-0000-000000000001'$$,
  'The BD Manager changes the values');
reset role;
select is((select quotation_value::numeric from public.opportunities where id = '4d200000-0000-0000-0000-000000000001'),
  150000::numeric, '... and the new quotation is stored');

-- Service role (no signed-in user): the sales-os-api stage advance, import.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$update public.opportunities set contract_value = 145000 where id = '4d200000-0000-0000-0000-000000000001'$$,
  'A service-role write passes');
select is((select contract_value::numeric from public.opportunities where id = '4d200000-0000-0000-0000-000000000001'),
  145000::numeric, '... and is stored');

select * from finish();
rollback;
