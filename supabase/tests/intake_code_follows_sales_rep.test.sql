-- Project codes follow the rep who entered the request
--
-- Agreed format <CODE>-<YY>-<NNNN> (20260806160000). An intake is numbered with
-- the code of the person who entered it, and the RFQ converted from it keeps
-- that code — but only for someone allowed to convert it, only while it is
-- open, and never twice.
--
-- The caller is simulated through request.jwt.claims so auth.uid() inside the
-- triggers sees a real user. Test user UUIDs use the 29… prefix; rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '29000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'code-rep+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '29000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'code-other+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '29000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'code-nocode+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set status = 'active', sales_code = 'ZQ'
 where id = '29000000-0000-0000-0000-000000000001';
update public.profiles set status = 'active', sales_code = 'ZR'
 where id = '29000000-0000-0000-0000-000000000002';
update public.profiles set status = 'active', sales_code = null, full_name = 'Yara Test'
 where id = '29000000-0000-0000-0000-000000000003';

insert into public.user_roles (user_id, role) values
  ('29000000-0000-0000-0000-000000000001', 'salesperson'),
  ('29000000-0000-0000-0000-000000000002', 'salesperson'),
  ('29000000-0000-0000-0000-000000000003', 'salesperson');

-- ── Intake numbering ────────────────────────────────────────────────────────
insert into public.inbox_items (id, source_type, project_name, created_by)
values ('f2900000-0000-0000-0000-000000000001', 'manual_rfq', 'code-fixture-open',
        '29000000-0000-0000-0000-000000000001');

select matches(
  (select project_number from public.inbox_items where id = 'f2900000-0000-0000-0000-000000000001'),
  '^ZQ-[0-9]{2}-[0-9]{4}$',
  'An intake carries the code of the rep who entered it');

insert into public.inbox_items (id, source_type, project_name, created_by)
values ('f2900000-0000-0000-0000-000000000003', 'manual_rfq', 'code-fixture-nocode',
        '29000000-0000-0000-0000-000000000003');

select matches(
  (select project_number from public.inbox_items where id = 'f2900000-0000-0000-0000-000000000003'),
  '^YA-[0-9]{2}-[0-9]{4}$',
  'A rep with no sales code gets their initials, as RFQ numbers do');

-- ── The RFQ keeps the intake's code ─────────────────────────────────────────
-- Someone who may not convert this intake (not its creator, owner or a pipeline
-- operator) does not get to claim its code.
select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

insert into public.rfqs (id, source_inbox_id, created_by)
values ('f2900000-0000-0000-0000-0000000000a0', 'f2900000-0000-0000-0000-000000000001',
        '29000000-0000-0000-0000-000000000002');

select isnt(
  (select rfq_number from public.rfqs where id = 'f2900000-0000-0000-0000-0000000000a0'),
  (select project_number from public.inbox_items where id = 'f2900000-0000-0000-0000-000000000001'),
  'A rep who cannot convert the intake does not inherit its code');

-- Its own creator converts it.
select set_config('request.jwt.claims',
  '{"sub":"29000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.rfqs (id, source_inbox_id, created_by, sales_owner_id)
values ('f2900000-0000-0000-0000-0000000000a1', 'f2900000-0000-0000-0000-000000000001',
        '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001');

select is(
  (select rfq_number from public.rfqs where id = 'f2900000-0000-0000-0000-0000000000a1'),
  (select project_number from public.inbox_items where id = 'f2900000-0000-0000-0000-000000000001'),
  'The RFQ converted from an intake keeps the intake''s code');

select is(
  (select count(*)::int from public.audit_log
    where action = 'rfq.number_overridden' and entity_id = 'f2900000-0000-0000-0000-0000000000a1'),
  0,
  'Inheriting the code is not recorded as a manual override');

-- A code is used once: a second RFQ from the same intake draws a new number.
insert into public.rfqs (id, source_inbox_id, created_by)
values ('f2900000-0000-0000-0000-0000000000a2', 'f2900000-0000-0000-0000-000000000001',
        '29000000-0000-0000-0000-000000000001');

select matches(
  (select rfq_number from public.rfqs where id = 'f2900000-0000-0000-0000-0000000000a2'),
  '^ZQ-[0-9]{2}-[0-9]{4}$',
  'A second RFQ from the same intake gets its own number, never a duplicate');

-- A converted intake's code is not handed out again.
insert into public.inbox_items (id, source_type, project_name, created_by, status)
values ('f2900000-0000-0000-0000-000000000002', 'manual_rfq', 'code-fixture-converted',
        '29000000-0000-0000-0000-000000000001', 'converted');

insert into public.rfqs (id, source_inbox_id, created_by)
values ('f2900000-0000-0000-0000-0000000000a3', 'f2900000-0000-0000-0000-000000000002',
        '29000000-0000-0000-0000-000000000001');

select isnt(
  (select rfq_number from public.rfqs where id = 'f2900000-0000-0000-0000-0000000000a3'),
  (select project_number from public.inbox_items where id = 'f2900000-0000-0000-0000-000000000002'),
  'An intake already converted does not give its code to a new RFQ');

select * from finish();
rollback;
