-- Stage playbook: who ticks a manual checklist item, who reads it, and the
-- daily assistant's checklist task. Test user UUIDs use the 3f… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','3f000000-0000-0000-0000-000000000001','authenticated','authenticated','sp-owner+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','3f000000-0000-0000-0000-000000000002','authenticated','authenticated','sp-other+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','3f000000-0000-0000-0000-000000000003','authenticated','authenticated','sp-viewer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '3f000000-%';
insert into public.user_roles (user_id, role) values
  ('3f000000-0000-0000-0000-000000000001','salesperson'),
  ('3f000000-0000-0000-0000-000000000002','salesperson'),
  ('3f000000-0000-0000-0000-000000000003','viewer');
insert into public.companies (id, name, company_type) values ('3f100000-0000-0000-0000-000000000001', 'Playbook Co', 'main_contractor');
insert into public.opportunities (id, project_name, owner_id, created_by, company_id, sales_stage, buyer_type)
values ('3f200000-0000-0000-0000-000000000001', 'playbook-deal', '3f000000-0000-0000-0000-000000000001', '3f000000-0000-0000-0000-000000000001',
        '3f100000-0000-0000-0000-000000000001', 'rfq_received', 'main_contractor');

select throws_ok($$update public.opportunities set buyer_type = 'friend' where id = '3f200000-0000-0000-0000-000000000001'$$,
  '23514', null, 'Buyer type is a closed list');
select throws_ok($$update public.companies set prequalification_status = 'maybe' where id = '3f100000-0000-0000-0000-000000000001'$$,
  '23514', null, 'Prequalification status is a closed list');
update public.companies set prequalification_status = 'approved' where id = '3f100000-0000-0000-0000-000000000001';
select isnt((select prequalification_updated_at from public.companies where id = '3f100000-0000-0000-0000-000000000001'), null,
  'Changing prequalification stamps when');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"3f000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((public.set_checklist_item('3f200000-0000-0000-0000-000000000001', 'site_visit', true, 'Visited 6 Oct'))->>'done', 'true',
  'The owner ticks a manual item');
select is((select note from public.opportunity_checklist where opportunity_id = '3f200000-0000-0000-0000-000000000001' and item_key = 'site_visit'),
  'Visited 6 Oct', '... with its note');
select throws_ok($$insert into public.opportunity_checklist (opportunity_id, item_key, done) values ('3f200000-0000-0000-0000-000000000001', 'why_phc', true)$$,
  '42501', null, 'Direct writes are refused');
select is((public.approve_ai_daily_task('checklist', '3f200000-0000-0000-0000-000000000001',
  (select updated_at from public.opportunities where id = '3f200000-0000-0000-0000-000000000001'), 'Complete stage evidence', null))->>'ok', 'true',
  'A checklist suggestion becomes a task on approval');
select is((select source from public.tasks where owner_id = '3f000000-0000-0000-0000-000000000001' and title = 'Complete stage evidence'),
  'ai_daily:checklist:3f200000-0000-0000-0000-000000000001', '... with the checklist provenance');

select set_config('request.jwt.claims','{"sub":"3f000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.set_checklist_item('3f200000-0000-0000-0000-000000000001', 'site_visit', false)$$,
  '42501', null, 'Someone outside the deal cannot tick its items');
select set_config('request.jwt.claims','{"sub":"3f000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.opportunity_checklist where opportunity_id = '3f200000-0000-0000-0000-000000000001'), 0,
  'A viewer who cannot read the deal sees no checklist rows');
reset role;

select * from finish();
rollback;
