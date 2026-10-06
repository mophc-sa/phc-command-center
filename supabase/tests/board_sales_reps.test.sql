-- board_sales_reps: salespeople without a management role; read by managers
-- and the wall account only. Test user UUIDs use the 3e… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','3e000000-0000-0000-0000-000000000001','authenticated','authenticated','bsr-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','3e000000-0000-0000-0000-000000000002','authenticated','authenticated','bsr-lead+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','3e000000-0000-0000-0000-000000000003','authenticated','authenticated','bsr-wall+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '3e000000-%';
update public.profiles set is_display_account = true where id = '3e000000-0000-0000-0000-000000000003';
insert into public.user_roles (user_id, role) values
  ('3e000000-0000-0000-0000-000000000001','salesperson'),
  ('3e000000-0000-0000-0000-000000000002','salesperson'),
  ('3e000000-0000-0000-0000-000000000002','sales_ops');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"3e000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select ok(exists(select 1 from public.board_sales_reps() where user_id = '3e000000-0000-0000-0000-000000000001'),
  'A salesperson is on the sales team');
select ok(not exists(select 1 from public.board_sales_reps() where user_id = '3e000000-0000-0000-0000-000000000002'),
  'A salesperson who is also a manager is not');
select ok(not exists(select 1 from public.board_sales_reps() where user_id = '3e000000-0000-0000-0000-000000000003'),
  'The wall account is not');

select set_config('request.jwt.claims','{"sub":"3e000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select * from public.board_sales_reps()$$, '42501', null, 'A salesperson cannot list the team');
reset role;

select * from finish();
rollback;
