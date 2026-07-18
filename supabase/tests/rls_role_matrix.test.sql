begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'rls-viewer@phc-local.test',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'rls-salesperson@phc-local.test',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

update public.profiles
set status = 'active'
where id in (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002'
);

insert into public.user_roles (user_id, role) values
  ('10000000-0000-0000-0000-000000000001', 'viewer'),
  ('10000000-0000-0000-0000-000000000002', 'salesperson');

insert into public.opportunities (project_name, owner_id, created_by)
values (
  'RLS baseline fixture',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.opportunities where project_name = 'RLS baseline fixture'),
  1,
  'viewer can read an opportunity under the authenticated read policy'
);

select throws_ok(
  $$insert into public.opportunities (project_name) values ('viewer must not create')$$,
  '42501',
  null,
  'viewer cannot insert an opportunity'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$insert into public.opportunities (project_name, owner_id, created_by)
    values (
      'salesperson may create',
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002'
    )$$,
  'salesperson can insert an opportunity through RLS'
);

select * from finish();

rollback;
