-- A deal's correspondence summary: the deal's people read it; others do not;
-- other agents' outputs keep their narrower rule.
--
-- Users use the 2e… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '2e000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'summary-owner+test@phc-sa.com', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2e000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'summary-bd+test@phc-sa.com', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2e000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'summary-other-rep+test@phc-sa.com', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
update public.profiles set status = 'active' where id::text like '2e000000-%';
insert into public.user_roles (user_id, role) values
  ('2e000000-0000-0000-0000-000000000001', 'salesperson'),
  ('2e000000-0000-0000-0000-000000000002', 'bd_manager'),
  ('2e000000-0000-0000-0000-000000000003', 'salesperson');

insert into public.opportunities (id, project_name, owner_id, created_by)
values ('f2e00000-0000-0000-0000-000000000001', 'summary-fixture-opp',
        '2e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000001');

-- The salesperson ran the summary; a BD manager ran a different agent.
insert into public.ai_agent_outputs (trace_id, agent_key, output_type, entity_type, entity_id, requested_by, structured_output)
values
  (gen_random_uuid(), 'deal_correspondence_summary', 'recommendation', 'opportunities', 'f2e00000-0000-0000-0000-000000000001',
   '2e000000-0000-0000-0000-000000000001', '{}'),
  (gen_random_uuid(), 'risk_finance', 'recommendation', 'opportunities', 'f2e00000-0000-0000-0000-000000000001',
   '2e000000-0000-0000-0000-000000000001', '{}');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"2e000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.ai_agent_outputs where agent_key = 'deal_correspondence_summary'), 1,
  'A pipeline operator reads a summary someone else made on a deal they can see');
select is((select count(*)::int from public.ai_agent_outputs where agent_key = 'risk_finance'
             and entity_id = 'f2e00000-0000-0000-0000-000000000001'), 0,
  'Other agents keep their own rule (requester only)');

select set_config('request.jwt.claims', '{"sub":"2e000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.ai_agent_outputs where agent_key = 'deal_correspondence_summary'), 0,
  'Another salesperson who cannot read the deal does not see its summary');

select * from finish();
rollback;
