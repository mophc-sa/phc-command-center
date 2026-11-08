-- Omar (sales manager) is management and reads supplier cost; Marie (BD) and reps do not.
-- Test user UUIDs use the 5f… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5f000000-0000-0000-0000-000000000001','authenticated','authenticated','smc-sm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5f000000-0000-0000-0000-000000000002','authenticated','authenticated','smc-bd+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5f000000-0000-0000-0000-000000000003','authenticated','authenticated','smc-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5f000000-%';
insert into public.user_roles (user_id, role) values
  ('5f000000-0000-0000-0000-000000000001','sales_manager'),
  ('5f000000-0000-0000-0000-000000000002','bd_manager'),
  ('5f000000-0000-0000-0000-000000000003','salesperson');
select ok(public.can_read_commercial_cost('5f000000-0000-0000-0000-000000000001'), 'The sales manager reads cost');
select ok(not public.can_read_commercial_cost('5f000000-0000-0000-0000-000000000002'), 'The BD manager does not');
select ok(not public.can_read_commercial_cost('5f000000-0000-0000-0000-000000000003'), 'A rep does not');
insert into public.installation_rates (install_type, base_rate) values ('pylon', 900);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5f000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.installation_rates), 1, 'The sales manager sees the rate card');
reset role;
select * from finish();
rollback;
