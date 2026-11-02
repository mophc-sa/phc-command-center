-- Construction phase on the site, and a project code for every deal
-- (20261026100000).
--
-- The caller is simulated through request.jwt.claims so auth.uid() inside the
-- triggers sees a real user. Test user UUIDs use the 7c… prefix; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','7c000000-0000-0000-0000-000000000001','authenticated','authenticated','cp-repa+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','7c000000-0000-0000-0000-000000000002','authenticated','authenticated','cp-repb+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','7c000000-0000-0000-0000-000000000003','authenticated','authenticated','cp-sm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','7c000000-0000-0000-0000-000000000004','authenticated','authenticated','cp-bd+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active', sales_code = 'ZK' where id = '7c000000-0000-0000-0000-000000000001';
update public.profiles set status = 'active', sales_code = 'ZL' where id = '7c000000-0000-0000-0000-000000000002';
update public.profiles set status = 'active' where id in ('7c000000-0000-0000-0000-000000000003', '7c000000-0000-0000-0000-000000000004');
insert into public.user_roles (user_id, role) values
  ('7c000000-0000-0000-0000-000000000001','salesperson'),
  ('7c000000-0000-0000-0000-000000000002','salesperson'),
  ('7c000000-0000-0000-0000-000000000003','sales_manager'),
  ('7c000000-0000-0000-0000-000000000004','bd_manager');

-- ---- The site's stage ----------------------------------------------------------
select ok('excavation'::public.project_stage > 'under_construction'
      and 'excavation'::public.project_stage < 'structure'
      and 'structure'::public.project_stage < 'mep_finishing'
      and 'mep_finishing'::public.project_stage < 'near_handover',
  'The construction phases sit in order between under construction and handover');
select col_is_null('public', 'inbox_items', 'project_stage',
  'The intake asks the stage, and blank means nobody said');

-- ---- A deal with no RFQ gets the owner's code -----------------------------------
select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.opportunities (id, project_name, owner_id, created_by) values
  ('7c200000-0000-0000-0000-000000000001', 'cp-no-rfq', '7c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000001');
select matches((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000001'),
  '^ZK-[0-9]{2}-[0-9]{4,}$', 'A deal created with an owner gets the owner''s code');

insert into public.opportunities (id, project_name, created_by) values
  ('7c200000-0000-0000-0000-000000000002', 'cp-unowned', '7c000000-0000-0000-0000-000000000001');
select is((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000002'), null,
  'A deal with no owner has no code yet');

-- A rep may not hand-edit a code.
update public.opportunities set project_code = 'ZK-26-0001' where id = '7c200000-0000-0000-0000-000000000001';
select isnt((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000001'), 'ZK-26-0001',
  'A rep''s edit to the code is discarded');

select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
update public.opportunities set project_code = 'BD-26-0001' where id = '7c200000-0000-0000-0000-000000000001';
select isnt((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000001'), 'BD-26-0001',
  '... and so is a BD manager''s');

-- The sales manager assigns the unowned deal; it gets the new owner's code.
select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
update public.opportunities set owner_id = '7c000000-0000-0000-0000-000000000002' where id = '7c200000-0000-0000-0000-000000000002';
select matches((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000002'),
  '^ZL-[0-9]{2}-[0-9]{4,}$', 'Assigning an owner gives the deal that owner''s code');

-- A code is the deal's identity: reassigning does not renumber it.
create temp table cp_before as select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000001';
update public.opportunities set owner_id = '7c000000-0000-0000-0000-000000000002' where id = '7c200000-0000-0000-0000-000000000001';
select is((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000001'),
  (select project_code from cp_before), 'Reassigning the deal keeps its code');

-- The sales manager may change it, and it is audited.
update public.opportunities set project_code = 'ZK-26-9901' where id = '7c200000-0000-0000-0000-000000000002';
select is((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000002'), 'ZK-26-9901',
  'The sales manager''s change to the code is kept');
select is((select count(*)::int from public.audit_log
            where entity_id = '7c200000-0000-0000-0000-000000000002' and action = 'opportunity.project_code_overridden'
              and after_value = to_jsonb('ZK-26-9901'::text)), 1,
  '... and written to the audit log');

-- ---- An RFQ raised for the deal takes its code -----------------------------------
select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
insert into public.rfqs (id, opportunity_id, created_by) values
  ('7c300000-0000-0000-0000-000000000001', '7c200000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000002');
select is((select rfq_number from public.rfqs where id = '7c300000-0000-0000-0000-000000000001'), 'ZK-26-9901',
  'An RFQ raised for a deal takes the deal''s code, not a second one');

-- A rep who does not work the deal does not get its code.
select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.opportunities (id, project_name, owner_id, created_by) values
  ('7c200000-0000-0000-0000-000000000005', 'cp-not-mine', '7c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000002');
insert into public.rfqs (id, opportunity_id, created_by) values
  ('7c300000-0000-0000-0000-000000000005', '7c200000-0000-0000-0000-000000000005', '7c000000-0000-0000-0000-000000000001');
select isnt((select rfq_number from public.rfqs where id = '7c300000-0000-0000-0000-000000000005'),
  (select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000005'),
  'A rep who does not work the deal does not take its code');

-- ---- From an intake, the deal ends up with the intake's code -----------------------
insert into public.inbox_items (id, source_type, project_name, created_by) values
  ('7c400000-0000-0000-0000-000000000001', 'manual_rfq', 'cp-intake', '7c000000-0000-0000-0000-000000000001');
insert into public.opportunities (id, project_name, owner_id, created_by) values
  ('7c200000-0000-0000-0000-000000000003', 'cp-intake', '7c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000001');
insert into public.rfqs (id, opportunity_id, source_inbox_id, created_by, sales_owner_id) values
  ('7c300000-0000-0000-0000-000000000003', '7c200000-0000-0000-0000-000000000003', '7c400000-0000-0000-0000-000000000001',
   '7c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000001');
select is((select rfq_number from public.rfqs where id = '7c300000-0000-0000-0000-000000000003'),
  (select project_number from public.inbox_items where id = '7c400000-0000-0000-0000-000000000001'),
  'The RFQ keeps the intake''s code, as before');
select is((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000003'),
  (select project_number from public.inbox_items where id = '7c400000-0000-0000-0000-000000000001'),
  '... and the deal''s code follows it, so the deal has one code');

-- The manager overrides the RFQ number: the deal follows, audited once (on the RFQ).
select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
update public.rfqs set rfq_number = 'ZK-26-9902' where id = '7c300000-0000-0000-0000-000000000003';
select is((select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000003'), 'ZK-26-9902',
  'A manager''s change to the RFQ number moves the deal''s code too');
select is((select count(*)::int from public.audit_log
            where entity_id = '7c200000-0000-0000-0000-000000000003' and action = 'opportunity.project_code_overridden'), 0,
  '... without a second override entry for the deal');

-- ---- The site stage moves with a project update -------------------------------------
select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.opportunity_updates (opportunity_id, kind, project_stage)
values ('7c200000-0000-0000-0000-000000000003', 'progress_update', 'structure');
select is((select project_stage::text from public.opportunities where id = '7c200000-0000-0000-0000-000000000003'), 'structure',
  'A progress update may report just the stage, and it moves the deal''s stage');
insert into public.opportunity_updates (opportunity_id, kind, completion_pct)
values ('7c200000-0000-0000-0000-000000000003', 'site_visit', 40);
select is((select project_stage::text from public.opportunities where id = '7c200000-0000-0000-0000-000000000003'), 'structure',
  '... and an update without a stage leaves it alone');
select throws_ok($$insert into public.opportunity_updates (opportunity_id, kind) values ('7c200000-0000-0000-0000-000000000003', 'progress_update')$$,
  '23514', null, 'A progress update with neither a % nor a stage is refused');

-- ---- The Production project of a deal with no RFQ gets the deal's code -----------------
select set_config('request.jwt.claims','{"sub":"7c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
update public.opportunities set stage = 'won', sales_stage = 'won' where id = '7c200000-0000-0000-0000-000000000001';
insert into public.boqs (related_opportunity_id, title, status)
values ('7c200000-0000-0000-0000-000000000001', 'Signage BOQ', 'verified');
select is(public.issue_project_number((select project_id from public.opportunities where id = '7c200000-0000-0000-0000-000000000001')),
  (select project_code from public.opportunities where id = '7c200000-0000-0000-0000-000000000001'),
  'A deal with no RFQ gives its Production project its own code, not PRJ-');

select * from finish();
rollback;
