-- Data sync from the master quotation list. Test user UUIDs use the 9e… prefix.
-- Users: 1 rep (FA), 2 sales manager.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9e000000-0000-0000-0000-00000000000' || n)::uuid, 'authenticated','authenticated',
       'ds-user' || n || '+test@phc-sa.com', now(), '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,2) n;
update public.profiles set status = 'active' where id::text like '9e000000-%';
insert into public.user_roles (user_id, role) values
  ('9e000000-0000-0000-0000-000000000001','salesperson'), ('9e000000-0000-0000-0000-000000000002','sales_manager');
update public.historical_sales_owner_map set user_id = '9e000000-0000-0000-0000-000000000001' where prefix = 'FA';
insert into public.companies (id, name) values ('9e700001-0000-0000-0000-000000000001', 'Known Client Co');

-- Deals: FA25001 twice (a duplicate, the older one kept), FA25002 open, FA25003 won, FA25004 open but moved by a person
-- after the file's last update, FA25005 open with no owner.
insert into public.opportunities (id, project_name, owner_id, sales_stage, stage, quotation_value, created_at, extra_data) values
  ('9e200001-0000-0000-0000-000000000001','ds-a', '9e000000-0000-0000-0000-000000000001','jih','quotation',100, now() - interval '9 days', '{"sales_code":"FA25001"}'),
  ('9e200002-0000-0000-0000-000000000001','ds-a dup', '9e000000-0000-0000-0000-000000000001','jih','quotation',100, now() - interval '1 day', '{"sales_code":"fa 25001"}'),
  ('9e200003-0000-0000-0000-000000000001','ds-b', '9e000000-0000-0000-0000-000000000001','jih','quotation',200, now(), '{"sales_code":"FA25002"}'),
  ('9e200004-0000-0000-0000-000000000001','ds-c', '9e000000-0000-0000-0000-000000000001','won','quotation',300, now(), '{"sales_code":"FA25003"}'),
  ('9e200005-0000-0000-0000-000000000001','ds-d', '9e000000-0000-0000-0000-000000000001','jih','quotation',400, now(), '{"sales_code":"FA25004"}'),
  ('9e200006-0000-0000-0000-000000000001','ds-e', null,'jih','quotation',500, now(), '{"sales_code":"FA25005"}');
insert into public.stage_transition_history (record_type, record_id, to_stage, created_at)
values ('opportunity','9e200005-0000-0000-0000-000000000001','jih', '2026-10-15');

insert into public.data_sync_runs (id, source, file_name, as_of, actor_id)
values ('9e900001-0000-0000-0000-000000000001','master_list','test.xlsx','2026-11-03','9e000000-0000-0000-0000-000000000002');
insert into public.data_sync_rows (run_id, sheet, row_no, payload) values
  ('9e900001-0000-0000-0000-000000000001','quotations',1,'{"code":"FA25001","status":"SUBMITTED","amount":150,"submitted":"2026-09-01","last_update":"2026-10-20","client":"Known Client Co"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',2,'{"code":"FA25002","status":"LOST","amount":200,"submitted":"2026-08-01","last_update":"2026-10-10","client":"Brand New Client"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',3,'{"code":"FA25003","status":"SUBMITTED","amount":300,"last_update":"2026-10-01"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',4,'{"code":"FA25004","status":"WON","amount":400,"last_update":"2026-10-01"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',5,'{"code":"FA25005","status":"WAITING FOR CLIENT","amount":"RATES ONLY","received":"2026-07-01"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',6,'{"code":"FA26099","status":"WON","amount":9000,"project":"ds-new","client":"Known Client Co","last_update":"2026-10-30","route":"JIH"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',7,'{"code":"BA24001","status":"LOST","amount":50,"project":"ds-legacy","last_update":"2024-05-01"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',8,'{"code":null,"status":"SUBMITTED","project":"no code"}'),
  ('9e900001-0000-0000-0000-000000000001','quotations',9,'{"code":"FA25009","status":"MAYBE","project":"odd"}'),
  ('9e900001-0000-0000-0000-000000000001','weekly',1,'{"code":"FA25002","notes":"Called, they chose another vendor","last_update":"2026-10-11"}');

-- ===== Nobody but the server runs it =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.data_sync_plan('9e900001-0000-0000-0000-000000000001')$$, '42501', null, 'A person cannot plan a sync');
select throws_ok($$select public.data_sync_apply('9e900001-0000-0000-0000-000000000001')$$, '42501', null, 'Nor apply one');
reset role;
-- The server's session carries no person (as the management API and the service role run it).
select set_config('request.jwt.claims', '', true);

-- ===== Plan =====
select lives_ok($$select public.data_sync_plan('9e900001-0000-0000-0000-000000000001')$$, 'The server plans the run');
select is((select opportunity_id from public.data_sync_rows where sheet = 'duplicates' and code_norm = 'FA25001'),
  '9e200002-0000-0000-0000-000000000001'::uuid, 'The newer duplicate is archived; the older is kept');
select is((select action from public.data_sync_rows where payload->>'code' = 'FA25003'), 'review', 'Won in the system, open in the file: review');
select is((select action || '/' || reason from public.data_sync_rows where payload->>'code' = 'FA25004'),
  'review/The system moved the stage after the file''s last update', 'The system is newer: review');
select is((select action from public.data_sync_rows where payload->>'code' = 'FA26099'), 'create', 'A new code is created');
select is((select (detail->>'needs_owner')::boolean from public.data_sync_rows where payload->>'code' = 'BA24001'), true,
  'A legacy prefix with no account is flagged for an owner');
select is((select reason from public.data_sync_rows where row_no = 8 and sheet = 'quotations'), 'No sales code', 'No code: review');
select is((select reason from public.data_sync_rows where payload->>'code' = 'FA25009'), 'Unknown status: MAYBE', 'Unknown status: review');

-- ===== Apply =====
select lives_ok($$select public.data_sync_apply('9e900001-0000-0000-0000-000000000001')$$, 'The server applies the run');
select is((select stage::text || '/' || exclusion_reason::text from public.opportunities where id = '9e200002-0000-0000-0000-000000000001'),
  'archived/duplicate_opportunity', 'The duplicate is archived (out of the dashboards), not deleted');
select is((select quotation_value::text || '/' || company_id::text || '/' || expected_contract_date::text from public.opportunities where id = '9e200001-0000-0000-0000-000000000001'),
  '150.00/9e700001-0000-0000-0000-000000000001/2026-11-30', 'Value from the file, company by name, expected date = submitted + 90');
select is((select sales_stage::text || '/' || lost_at::date::text || '/' || loss_reason from public.opportunities where id = '9e200003-0000-0000-0000-000000000001'),
  'lost/2026-10-10/Lost (master list)', 'Lost on the file''s date');
select ok((select c.account_status::text = 'pending_review' from public.opportunities o join public.companies c on c.id = o.company_id
            where o.id = '9e200003-0000-0000-0000-000000000001'), 'A company the system did not know is created pending review');
select is((select owner_id from public.opportunities where id = '9e200006-0000-0000-0000-000000000001'),
  '9e000000-0000-0000-0000-000000000001'::uuid, 'The owner comes from the code prefix');
select is((select sales_stage::text || '/' || won_at::date::text || '/' || quotation_value::text from public.opportunities
            where extra_data->>'sales_code' = 'FA26099'), 'won/2026-10-30/9000.00', 'The new won deal, with its date and value');
select is((select extra_data->'weekly_update'->>'note' from public.opportunities where id = '9e200003-0000-0000-0000-000000000001'),
  'Called, they chose another vendor', 'The weekly note is on the deal');
select is((select count(*)::int from public.notifications where notification_type = 'stage_changed'
            and recipient_user_id = '9e000000-0000-0000-0000-000000000001'), 0, 'No notice per deal');
select ok(exists (select 1 from public.notifications where notification_type = 'data_sync_summary'
                   and recipient_user_id = '9e000000-0000-0000-0000-000000000001'), 'One summary to the owner');

-- ===== Undo =====
select lives_ok($$select public.data_sync_undo('9e900001-0000-0000-0000-000000000001')$$, 'The run is undone');
select is((select o1.stage::text || '/' || o2.sales_stage::text || '/' || o2.quotation_value::text || '/' || o3.stage::text
             from public.opportunities o1, public.opportunities o2, public.opportunities o3
            where o1.id = '9e200002-0000-0000-0000-000000000001' and o2.id = '9e200001-0000-0000-0000-000000000001'
              and o3.extra_data->>'sales_code' = 'FA26099'),
  'quotation/jih/100.00/archived', 'The duplicate is back, the update reversed, the created deal archived');

select * from finish();
rollback;
