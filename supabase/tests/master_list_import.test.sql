-- Master list import (2026-11-18): who may run it, new deals, a second contractor
-- counted once, and no silent overwrite of a later human edit.
-- Users: 1 rep, 2 BD manager (Marie). UUIDs use the 9c… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9c000000-0000-0000-0000-00000000000' || n)::uuid, 'authenticated','authenticated',
       'mli-user' || n || '+test@phc-sa.com', now(), '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,2) n;
update public.profiles set status = 'active' where id::text like '9c000000-%';
insert into public.user_roles (user_id, role) values
  ('9c000000-0000-0000-0000-000000000001','salesperson'),
  ('9c000000-0000-0000-0000-000000000002','bd_manager');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage, quotation_value, extra_data)
values ('9c100000-0000-0000-0000-000000000001','mli-existing','9c000000-0000-0000-0000-000000000001','9c000000-0000-0000-0000-000000000001','jih', 1000, '{"sales_code":"FA99001"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.master_list_import('f.xlsx', '2026-11-18', '[{"key":"a","kind":"create","row":{"code":"FA99002"},"changes":{"sales_stage":"jih"}}]')$$,
  '42501', null, 'A salesperson cannot import the master list');

select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select set_config('mli.res', public.master_list_import('f.xlsx', '2026-11-18', '[
  {"key":"p","kind":"update","deal_id":"9c100000-0000-0000-0000-000000000001","row":{"code":"FA99001","amount":1000,"status":"Verbally Awarded","priority":"NEED FOLLOW-UP","remarks":"1. Met. Next: Call"},"row_nos":[2],"codes":["FA99001"],"changes":{"sales_stage":"verbally_awarded"},"next_action":"Call"},
  {"key":"s","kind":"create","counted_on":"9c100000-0000-0000-0000-000000000001","row":{"code":"FA99001-B","project":"mli-second","amount":1000,"status":"SUBMITTED"},"row_nos":[3],"codes":["FA99001-B"],"changes":{"sales_stage":"jih","quotation_value":null}},
  {"key":"n","kind":"create","row":{"code":"FA99003","project":"mli-new","amount":500,"status":"SUBMITTED"},"row_nos":[4],"codes":["FA99003"],"changes":{"sales_stage":"jih","quotation_value":500}}
]')::text, true)$$, 'The BD manager imports approved rows');
reset role;

select is((select sales_stage::text from public.opportunities where id = '9c100000-0000-0000-0000-000000000001'), 'verbally_awarded', 'The approved stage change is applied');
select is((select action_required from public.opportunities where id = '9c100000-0000-0000-0000-000000000001'), true, 'Column A NEED FOLLOW-UP sets action required');
select is((select quotation_value from public.opportunities where project_name = 'mli-second'), null, 'A second contractor''s value is counted once, on the primary');
select is((select quotation_value from public.opportunities where project_name = 'mli-new'), 500::numeric, 'A new tender is created with its value');

-- A person moves the deal after the file; the next import must not overwrite it.
insert into public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
values ('9c000000-0000-0000-0000-000000000001','user','opportunity.fields_changed','opportunity','9c100000-0000-0000-0000-000000000001',
        '{"sales_stage":"verbally_awarded"}','{"sales_stage":"contract_received"}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((public.master_list_import('f2.xlsx', '2026-11-18', '[{"key":"p","kind":"update","deal_id":"9c100000-0000-0000-0000-000000000001","row":{"code":"FA99001","last_update":"2026-11-01"},"changes":{"sales_stage":"lost"}}]')->>'skipped')::int,
  1, 'A deal changed in the system after the file is skipped, not overwritten');
reset role;

select * from finish();
rollback;
