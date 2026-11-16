-- AI output dedupe, recommendation upsert, field-level audit, data sync that
-- respects edits, and Riyadh calendar days (20261116150000..150300).
-- Test user UUIDs use the 9f… prefix. Users: 1 finance manager, 2 sales manager.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9f000000-0000-0000-0000-00000000000' || n)::uuid, 'authenticated','authenticated',
       'aar-user' || n || '+test@phc-sa.com', now(), '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,2) n;
update public.profiles set status = 'active' where id::text like '9f000000-%';
insert into public.user_roles (user_id, role) values
  ('9f000000-0000-0000-0000-000000000001','finance_manager'), ('9f000000-0000-0000-0000-000000000002','sales_manager');

-- ===== Riyadh calendar days =====
insert into public.opportunities (id, project_name, owner_id, sales_stage, stage) values
  ('9f100001-0000-0000-0000-000000000001','aar-riyadh','9f000000-0000-0000-0000-000000000002','jih','quotation');
insert into public.commitments (opportunity_id, direction, description, due_date, owner_id) values
  ('9f100001-0000-0000-0000-000000000001','we_owe_client','aar due today', public.riyadh_date(now()), '9f000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
-- UTC-12: for most of the Riyadh day CURRENT_DATE here is a different day.
set local timezone = 'Etc/GMT+12';
select is((select days_until_due || '/' || is_overdue from public.opportunity_next_action
            where opportunity_id = '9f100001-0000-0000-0000-000000000001'), '0/false',
  'Due today in Riyadh is due today, whatever the session time zone');
reset timezone;
select ok(pg_get_viewdef('public.overdue_commitments') like '%riyadh_date(now())%'
      and pg_get_viewdef('public.overdue_commitments') not ilike '%current_date%', 'overdue_commitments counts Riyadh days');
select ok(pg_get_viewdef('public.sla_breaches') not ilike '%current_date%', 'sla_breaches counts Riyadh days');
select ok(pg_get_functiondef('public.run_sales_automations(text)'::regprocedure) not ilike '%current_date%'
      and pg_get_functiondef('public.notify_overdue_items()'::regprocedure) not ilike '%current_date%'
      and pg_get_functiondef('public.notify_due_follow_ups(date)'::regprocedure) not ilike '%current_date%',
  'The nightly automations count Riyadh days');
select set_config('request.jwt.claims', '', true);

-- ===== One pending AI output per key =====
select lives_ok($$select public.store_ai_agent_output(jsonb_build_object(
  'trace_id', gen_random_uuid(), 'agent_key', 'sales_report_insights', 'output_type', 'recommendation',
  'entity_type', 'reports', 'entity_id', '00000000-0000-0000-0000-000000000001',
  'requested_by', '9f000000-0000-0000-0000-000000000002', 'structured_output', '{"n":1}'::jsonb,
  'model', 'test-model', 'provider', 'openai', 'prompt_version', 'phc-ai.v6',
  'source_refs', '{"record_counts":{"opportunities":3}}'::jsonb))$$, 'The first output is stored');
select lives_ok($$select public.store_ai_agent_output(jsonb_build_object(
  'trace_id', gen_random_uuid(), 'agent_key', 'sales_report_insights', 'output_type', 'recommendation',
  'entity_type', 'reports', 'entity_id', '00000000-0000-0000-0000-000000000001',
  'requested_by', '9f000000-0000-0000-0000-000000000002', 'structured_output', '{"n":2}'::jsonb,
  'model', 'test-model', 'provider', 'openai', 'prompt_version', 'phc-ai.v6'))$$, 'A second run for the same key is stored');
select is((select string_agg(status || ':' || (structured_output->>'n'), ',' order by structured_output->>'n')
             from public.ai_agent_outputs where requested_by = '9f000000-0000-0000-0000-000000000002'),
  'superseded:1,pending_review:2', 'The newer one is pending; the older one is superseded, not deleted');
select is((select model || '/' || provider || '/' || prompt_version from public.ai_agent_outputs
            where requested_by = '9f000000-0000-0000-0000-000000000002' and status = 'pending_review'),
  'test-model/openai/phc-ai.v6', 'The output records the model and prompt that produced it');
select throws_ok($$insert into public.ai_agent_outputs (trace_id, agent_key, output_type, entity_type, entity_id, requested_by, structured_output)
  values (gen_random_uuid(), 'sales_report_insights', 'recommendation', 'reports', '00000000-0000-0000-0000-000000000001',
          '9f000000-0000-0000-0000-000000000002', '{}')$$, '23505', null, 'A second pending row for the key is refused');
select ok(not has_function_privilege('authenticated', 'public.store_ai_agent_output(jsonb)', 'execute'),
  'Only the server stores outputs');

-- ===== Recommendation upsert =====
select lives_ok($$select public.create_ai_recommendation(
  '{"agent_key":"aar_agent","title":"First","recommendation":"r","entity_type":"company","entity_id":"9f700001-0000-0000-0000-000000000001","suggested_action":"review_merge"}',
  '[{"label":"a","value":"1"},{"label":"b","value":"2"}]')$$, 'A recommendation is created');
select lives_ok($$select public.create_ai_recommendation(
  '{"agent_key":"aar_agent","title":"Second","recommendation":"r","entity_type":"company","entity_id":"9f700001-0000-0000-0000-000000000001","suggested_action":"review_merge"}',
  '[{"label":"c","value":"3"}]')$$, 'The same open recommendation again');
select is((select count(*)::int || '/' || max(title) from public.ai_recommendations where agent_key = 'aar_agent'), '1/First',
  'It is refreshed, not repeated (the advice text stays as first generated)');
select is((select string_agg(e.label, ',') from public.ai_evidence_items e join public.ai_recommendations r on r.id = e.recommendation_id
            where r.agent_key = 'aar_agent'), 'c', 'Its evidence is the latest scan''s');

-- ===== Field-level audit =====
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
update public.opportunities set project_name = 'aar-riyadh renamed' where id = '9f100001-0000-0000-0000-000000000001';
select is((select actor_type || '/' || actor_id::text || '/' || (after_value->>'project_name') || '/' || (select count(*) from jsonb_object_keys(after_value))
             from public.audit_log where entity_type = 'opportunity' and entity_id = '9f100001-0000-0000-0000-000000000001'
              and action = 'opportunity.fields_changed'),
  'user/9f000000-0000-0000-0000-000000000002/aar-riyadh renamed/1', 'A person''s edit: only the changed column, with who');
select set_config('request.jwt.claims', '', true);
update public.opportunities set next_action = 'Call' where id = '9f100001-0000-0000-0000-000000000001';
select set_config('phc.data_sync', 'on', true);
update public.opportunities set location = 'Riyadh' where id = '9f100001-0000-0000-0000-000000000001';
select set_config('phc.data_sync', '', true);
select is((select string_agg(actor_type, ',' order by created_at, actor_type) from public.audit_log
            where entity_id = '9f100001-0000-0000-0000-000000000001' and action = 'opportunity.fields_changed'),
  'data_sync,system,user', 'No user is "system"; the master-list sync is "data_sync"');
update public.opportunities set updated_at = now() + interval '1 minute' where id = '9f100001-0000-0000-0000-000000000001';
select is((select count(*)::int from public.audit_log where entity_id = '9f100001-0000-0000-0000-000000000001'
            and action = 'opportunity.fields_changed'), 3, 'A bookkeeping-only update writes nothing');

-- ===== Data sync never overwrites a person's edit =====
-- A: edited between plan and apply. B: edited before planning but after the
-- file's last update. C: applied, then edited, then undone.
insert into public.opportunities (id, project_name, owner_id, sales_stage, stage, quotation_value, extra_data) values
  ('9f200001-0000-0000-0000-000000000001','aar-a','9f000000-0000-0000-0000-000000000002','jih','quotation',100,'{"sales_code":"FA27001"}'),
  ('9f200002-0000-0000-0000-000000000001','aar-b','9f000000-0000-0000-0000-000000000002','jih','quotation',100,'{"sales_code":"FA27002"}'),
  ('9f200003-0000-0000-0000-000000000001','aar-c','9f000000-0000-0000-0000-000000000002','jih','quotation',100,'{"sales_code":"FA27003"}');
insert into public.data_sync_runs (id, source, file_name, as_of, actor_id)
values ('9f900001-0000-0000-0000-000000000001','master_list','aar.xlsx','2026-11-03','9f000000-0000-0000-0000-000000000002');
insert into public.data_sync_rows (run_id, sheet, row_no, payload) values
  ('9f900001-0000-0000-0000-000000000001','quotations',1,'{"code":"FA27001","status":"SUBMITTED","amount":150,"submitted":"2026-09-01","last_update":"2026-10-20"}'),
  ('9f900001-0000-0000-0000-000000000001','quotations',2,'{"code":"FA27002","status":"SUBMITTED","amount":150,"submitted":"2026-09-01","last_update":"2026-10-20"}'),
  ('9f900001-0000-0000-0000-000000000001','quotations',3,'{"code":"FA27003","status":"LOST","amount":150,"submitted":"2026-09-01","last_update":"2026-10-10"}');

-- Finance corrects B's value before the run is planned (after the file's 2026-10-20).
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
update public.opportunities set quotation_value = 130 where id = '9f200002-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '', true);
select lives_ok($$select public.data_sync_plan('9f900001-0000-0000-0000-000000000001')$$, 'The server plans the run');
-- Finance corrects A's value after planning.
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
update public.opportunities set quotation_value = 120 where id = '9f200001-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '', true);
select lives_ok($$select public.data_sync_apply('9f900001-0000-0000-0000-000000000001')$$, 'The server applies the run');
select is((select quotation_value::text || '/' || x.action || '/' || x.reason from public.opportunities o
             join public.data_sync_rows x on x.opportunity_id = o.id and x.run_id = '9f900001-0000-0000-0000-000000000001'
            where o.id = '9f200001-0000-0000-0000-000000000001'),
  '120.00/review/Changed in the system after the master list: quotation_value', 'Edited after planning: kept, and sent to review');
select is((select quotation_value::text || '/' || x.action from public.opportunities o
             join public.data_sync_rows x on x.opportunity_id = o.id and x.run_id = '9f900001-0000-0000-0000-000000000001'
            where o.id = '9f200002-0000-0000-0000-000000000001'),
  '130.00/review', 'Edited after the file''s last update: kept, and sent to review');
select is((select sales_stage::text || '/' || quotation_value::text from public.opportunities where id = '9f200003-0000-0000-0000-000000000001'),
  'lost/150.00', 'An untouched deal follows the file');

-- C is edited after the sync, then the sync is undone.
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
update public.opportunities set quotation_value = 170 where id = '9f200003-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '', true);
select is((select (public.data_sync_undo('9f900001-0000-0000-0000-000000000001'))->>'fields_kept'), '1', 'Undo reports the field it kept');
select is((select sales_stage::text || '/' || quotation_value::text from public.opportunities where id = '9f200003-0000-0000-0000-000000000001'),
  'jih/170.00', 'Undo restores the stage the sync wrote, and keeps the value a person changed since');

select * from finish();
rollback;
