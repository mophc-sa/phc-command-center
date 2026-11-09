-- PR 3 Task 1: the supplier role, its boundary, and supplier accounts.
-- Test user UUIDs use the 8a prefix. Every session carries aal2 unless it says otherwise.
-- The boundary is keyed on profiles.vendor_id (the guarded column), not on the
-- deletable supplier role row: 8a..07 is a vendor-linked profile with no role row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(96);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'sa-rep'),(2,'sa-pricer'),(3,'sa-gm'),(4,'sa-supplier'),(5,'sa-admin'),(6,'sa-new'),(7,'sa-linked'),(8,'sa-bd'),(9,'sa-staff')) v(n, r);
update public.profiles set status = 'active' where id::text like '8a000000-%' and id <> '8a000000-0000-0000-0000-000000000006';
insert into public.user_roles (user_id, role) values
  ('8a000000-0000-0000-0000-000000000001','salesperson'),
  ('8a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8a000000-0000-0000-0000-000000000002','finance_manager'),
  ('8a000000-0000-0000-0000-000000000003','general_manager'),
  ('8a000000-0000-0000-0000-000000000005','system_admin'),
  ('8a000000-0000-0000-0000-000000000008','bd_manager');
insert into public.vendors (id, name) values
  ('8a100001-0000-0000-0000-000000000001','sa Vendor One Co'),
  ('8a100002-0000-0000-0000-000000000001','SA VENDOR ONE co.');
-- Fixture only: the supplier account as supplier_account_activate leaves it (triggers off),
-- a vendor-linked profile whose role row is missing, and records the supplier would own
-- or be given if the boundary leaked.
set local session_replication_role = replica;
update public.profiles set vendor_id = '8a100001-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000004','supplier');
update public.profiles set vendor_id = '8a100002-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000007';
insert into public.companies (id, name, account_owner_id) values
  ('8a300001-0000-0000-0000-000000000001','sa-co','8a000000-0000-0000-0000-000000000004');
insert into public.contacts (id, company_id, name, owner_id) values
  ('8a300002-0000-0000-0000-000000000001','8a300001-0000-0000-0000-000000000001','sa-contact','8a000000-0000-0000-0000-000000000004');
insert into public.projects (id, name, owner_id) values
  ('8a300003-0000-0000-0000-000000000001','sa-project','8a000000-0000-0000-0000-000000000004');
insert into public.tasks (title, owner_id, due_date, status, source, created_by) values
  ('sa-task', '8a000000-0000-0000-0000-000000000004', public.riyadh_date(now()), 'open', 'self', '8a000000-0000-0000-0000-000000000004');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage) values
  ('8a200001-0000-0000-0000-000000000001','sa-deal-1','8a000000-0000-0000-0000-000000000001','8a000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('8a400001-0000-0000-0000-000000000001','8a200001-0000-0000-0000-000000000001','sa-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('8a500001-0000-0000-0000-000000000001','8a400001-0000-0000-0000-000000000001',1);
insert into public.estimations (id, boq_revision_id, cost_total) values ('8a700001-0000-0000-0000-000000000001','8a500001-0000-0000-0000-000000000001',1000);
insert into public.internal_prices (id, estimation_id, proposed_price, status) values ('8a800001-0000-0000-0000-000000000001','8a700001-0000-0000-0000-000000000001',2000,'internal_price_proposed');
insert into public.automation_runs (trigger) values ('sa-probe');
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (12, now() - interval '1 day', 'sa-floor');

-- The role exists and the boundary closes on it.
select ok('supplier' = any(enum_range(null::public.app_role)::text[]), 'The app_role enum has supplier');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is(public.has_app_access('8a000000-0000-0000-0000-000000000004'), false, 'A supplier with MFA has no app access');
select is((select count(*)::int from public.profiles), 1, 'A supplier reads its own profile only');
select is((select count(*)::int from public.user_roles), 1, 'A supplier reads its own role only');
select is((select count(*)::int from public.opportunities), 0, 'A supplier reads no deal');
select is((select count(*)::int from public.vendors), 0, 'A supplier reads no vendor');
select is((select count(*)::int from public.companies where name like 'sa-%'), 0, 'A supplier reads no company, not even one it owns');
select is((select count(*)::int from public.contacts where name like 'sa-%'), 0, 'A supplier reads no contact, not even one it owns');
select is((select count(*)::int from public.vendor_duplicate_candidates), 0, 'A supplier reads no vendor names through the duplicates view');
select is((select count(*)::int from public.automation_health), 0, 'A supplier reads no automation health');
select is(public.current_margin_floor(), null::numeric, 'A supplier gets no margin floor');
select is((select count(*)::int from public.my_day(public.riyadh_date(now()))), 0, 'My Day lists nothing for a supplier, not even its own task');
select is(public.meeting_review_queue(), null::jsonb, 'The meeting review queue is closed to a supplier');
select is(public.my_fireflies_connection(), null::jsonb, 'The Fireflies connection is closed to a supplier');
select throws_ok($$update public.profiles set vendor_id = '8a100002-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'A supplier cannot move its own account to another vendor');
select throws_ok($$update public.profiles set full_name = 'Someone Else' where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'A supplier cannot rename its own account');
select lives_ok($$update public.profiles set language = 'ar' where id = '8a000000-0000-0000-0000-000000000004'$$,
  'A supplier may change its own language');
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','x@example.com','X')$$,
  '42501', null, 'A supplier cannot create supplier accounts');
select throws_ok($$select * from public.pricing_supplier_accounts('8a100001-0000-0000-0000-000000000001')$$,
  '42501', null, 'A supplier cannot list supplier accounts');
delete from public.user_roles where user_id = '8a000000-0000-0000-0000-000000000004';  -- refused or invisible; checked below

-- A vendor-linked profile is a supplier even with its role row gone.
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal2"}',true);
select is(public.has_app_access('8a000000-0000-0000-0000-000000000007'), false, 'A vendor-linked profile without the role row has no app access');
select is((select count(*)::int from public.companies where name like 'sa-%'), 0, 'It reads no company');
select is((select count(*)::int from public.contacts where name like 'sa-%'), 0, 'It reads no contact');
select is((select count(*)::int from public.projects where name like 'sa-%'), 0, 'It reads no project');

-- Staff are unaffected, and see suppliers as nobody they can work with.
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.companies where name like 'sa-%') || '/' ||
          (select count(*)::int from public.contacts where name like 'sa-%') || '/' ||
          (select count(*)::int from public.projects where name like 'sa-%'), '1/1/1',
  'A rep reads the same company, contact and project (the counts above are the boundary, not missing rows)');
select is(public.is_active_user('8a000000-0000-0000-0000-000000000004'), false, 'To staff, a supplier is not an active user');
select is(public.is_active_user('8a000000-0000-0000-0000-000000000007'), false, 'Nor is a vendor-linked profile without the role row');
select is(public.has_any_role('8a000000-0000-0000-0000-000000000004', array['supplier']::public.app_role[]), false,
  'Role lookups about a supplier find nothing');
select is(public.is_active_user('8a000000-0000-0000-0000-000000000002'), true, 'To staff, a colleague is still an active user');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.has_app_access('8a000000-0000-0000-0000-000000000002'), true, 'A pricer with MFA keeps app access');
select is((select count(*)::int from public.vendor_duplicate_candidates where vendor_count = 2), 1, 'Estimation still reads the duplicate vendors (as invoker)');
select is(public.current_margin_floor(), 12.00::numeric, 'Staff still read the margin floor');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.automation_health where trigger = 'sa-probe'), 1, 'The system administrator still reads automation health');
select throws_ok($$update public.profiles set vendor_id = '8a100002-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'Not even the system administrator edits a supplier''s vendor directly');
select throws_ok($$update public.profiles set vendor_id = null where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'Nor clears it');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000004','salesperson')$$,
  '23514', null, 'A supplier account cannot also be given a staff role');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000007','salesperson')$$,
  '23514', null, 'A vendor-linked profile cannot be given a staff role, even with no role row');
select throws_ok($$delete from public.user_roles where user_id = '8a000000-0000-0000-0000-000000000004' and role = 'supplier'$$,
  '42501', null, 'The system administrator cannot delete a supplier''s role (suspend the account instead)');
select throws_ok($$update public.user_roles set role = 'salesperson' where user_id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'Nor turn it into a staff role');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000001','supplier')$$,
  '23514', null, 'A staff account cannot be given the supplier role');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000006','supplier')$$,
  '23514', null, 'The supplier role needs a vendor on the profile');

-- Nothing is assigned or notified to a supplier, and the cost functions are closed to anon.
reset role;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is(public.emit_notification('8a000000-0000-0000-0000-000000000004','task_assigned','task', gen_random_uuid(),
  'sa-n','b','info','task_assigned','sa-n-1', '{}'::jsonb), null::uuid, 'No notification reaches a supplier');
select isnt(public.emit_notification('8a000000-0000-0000-0000-000000000002','task_assigned','task', gen_random_uuid(),
  'sa-n','b','info','task_assigned','sa-n-2', '{}'::jsonb), null::uuid, 'A colleague still gets one');
select throws_ok($$insert into public.tasks (title, owner_id, status, source) values ('sa-assigned','8a000000-0000-0000-0000-000000000004','open','self')$$,
  '23514', null, 'No task can be given to a supplier');
select throws_ok($$insert into public.tasks (title, owner_id, status, source) values ('sa-assigned','8a000000-0000-0000-0000-000000000007','open','self')$$,
  '23514', null, 'Nor to a vendor-linked profile without the role row');
set local role anon;
select throws_ok($$select public.current_margin_floor()$$, '42501', null, 'anon cannot read the margin floor');
select throws_ok($$select public.estimation_cost_basis(gen_random_uuid())$$, '42501', null, 'anon cannot read a cost basis');
reset role;
select ok(not has_function_privilege('anon', 'public.estimation_cost_basis(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.current_margin_floor()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.current_margin_floor()', 'EXECUTE'),
  'The cost functions are granted to signed-in callers only');

select is((select count(*)::int from public.user_roles where user_id = '8a000000-0000-0000-0000-000000000004' and role = 'supplier'), 1,
  'The supplier still holds its role after it and the administrator tried to remove it');

-- Reading the session's vendor (internal helper: called as the owner with each session's claims).
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is(public._supplier_session_vendor(), '8a100001-0000-0000-0000-000000000001'::uuid, 'A supplier session with MFA prices for its vendor');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
select is(public._supplier_session_vendor(), null::uuid, 'Without MFA a supplier session has no vendor');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public._supplier_session_vendor(), null::uuid, 'A pricer session has no vendor');

-- Creating an account: prepare (pricer), the sign-in account (GoTrue), activate (service role).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','new@factory.example','New Contact')$$,
  '42501', null, 'A rep cannot create supplier accounts');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','not-an-email','New Contact')$$,
  '23514', null, 'A malformed email is refused');
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','someone@phc-sa.com','New Contact')$$,
  '23514', null, 'A PHC address cannot be a supplier account');
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','sa-rep+test@phc-sa.com','Rep')$$,
  '23514', null, 'An existing staff address is refused');
select throws_ok($$select public.supplier_account_prepare('8a10000f-0000-0000-0000-000000000001','new@factory.example','New Contact')$$,
  '23514', null, 'An unknown vendor is refused');
create temp table sa_invite (k text, id uuid);
grant all on sa_invite to authenticated, service_role;
insert into sa_invite select 'new', public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001',' New@Factory.Example ','New Contact');
select throws_ok($$select count(*) from public.supplier_account_invites$$, '42501', null, 'Nobody reads the requests table directly');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$insert into sa_invite select 'other', public.supplier_account_prepare('8a100002-0000-0000-0000-000000000001','other@factory.example','Other')$$,
  'The system administrator can prepare a supplier account');
reset role;
select is((select email from public.supplier_account_invites where id = (select id from sa_invite where k = 'new')), 'new@factory.example',
  'The request keeps the address trimmed and lower-cased');
select set_config('request.jwt.claims','',true);
-- GoTrue's admin createUser (observed on the local auth container): the INSERT
-- carries only {"provider","providers"}; app_metadata.phc_supplier_invite is
-- written by a later UPDATE in the same transaction. So the INSERT needs an open
-- request for the address, and a deferred check at commit needs the request id.
select throws_ok($$insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000b','authenticated','authenticated','stranger@factory.example',
          '{"provider":"email"}','{}', now(), now())$$,
  '23514', null, 'A non-PHC address nobody requested is refused at once');
select throws_ok($q$do $d$ begin
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000a','authenticated','authenticated','new@factory.example',
            '{"provider":"email","providers":["email"]}','{}', now(), now());
    set constraints auth.phc_supplier_invite_check immediate;
  end $d$$q$,
  '23514', null, 'A sign-up for the requested address without the request id fails at commit');
select throws_ok(format($q$do $d$ begin
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000a','authenticated','authenticated','new@factory.example',
            '{"provider":"email","providers":["email"]}','{}', now(), now());
    update auth.users set raw_app_meta_data = raw_app_meta_data || '{"phc_supplier_invite":"%s"}' where id = '8a000000-0000-0000-0000-00000000000a';
    set constraints auth.phc_supplier_invite_check immediate;
  end $d$$q$, (select id from sa_invite where k = 'other')),
  '23514', null, 'Another address''s request id does not pass');
select lives_ok(format($q$do $d$ begin
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000a','authenticated','authenticated','new@factory.example',
            '{"provider":"email","providers":["email"]}','{}', now(), now());
    update auth.users set raw_app_meta_data = raw_app_meta_data || '{"phc_supplier_invite":"%s"}' where id = '8a000000-0000-0000-0000-00000000000a';
    set constraints auth.phc_supplier_invite_check immediate;
  end $d$$q$, (select id from sa_invite where k = 'new')),
  'The supplier-account action''s insert passes (as GoTrue writes it: insert, then app_metadata)');
select lives_ok($$update auth.users set last_sign_in_at = now(), email = email where id = '8a000000-0000-0000-0000-00000000000a'$$,
  'Signing in later (address unchanged) passes');
select throws_ok($$update auth.users set email = 'changed@factory.example' where id = '8a000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'Changing to another non-PHC address is refused');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-00000000000a')$$, (select id from sa_invite where k = 'new')),
  '42501', null, 'Only the service role activates an account');
set local role service_role;
select set_config('request.jwt.claims','',true);
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-000000000006')$$, (select id from sa_invite where k = 'new')),
  '23514', null, 'The account must be the one the request named');
select is((public.supplier_account_activate((select id from sa_invite where k = 'new'), '8a000000-0000-0000-0000-00000000000a'))->>'vendor_id',
  '8a100001-0000-0000-0000-000000000001', 'Activation links the account to the vendor');
select is((select status::text || '/' || coalesce(sales_code, '-') || '/' || full_name from public.profiles where id = '8a000000-0000-0000-0000-00000000000a'),
  'active/-/New Contact', 'The account is active, holds no sales code, and carries the contact''s name');
select is((select array_agg(role::text) from public.user_roles where user_id = '8a000000-0000-0000-0000-00000000000a'), array['supplier'],
  'The account holds the supplier role only');
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-00000000000a')$$, (select id from sa_invite where k = 'new')),
  'P0001', null, 'A request is used once');
-- The service role is held to the same rules.
select throws_ok($$delete from public.user_roles where user_id = '8a000000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'Not even the service role deletes a linked account''s supplier role');
select throws_ok($$update public.profiles set vendor_id = '8a100001-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'A staff account cannot be linked to a supplier');
select throws_ok($$update public.profiles set vendor_id = null where id = '8a000000-0000-0000-0000-000000000007'$$,
  '23514', null, 'An active supplier account cannot be unlinked');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'supplier_account.created' and entity_id = '8a000000-0000-0000-0000-00000000000a'
  and actor_id = '8a000000-0000-0000-0000-000000000002'), 'Creating the account is audited as the pricer''s');
select throws_ok($$update auth.users set email = 'evil@phc-sa.com' where id = '8a000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'A supplier account cannot take a PHC address');

-- Listing and the set-password address.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_supplier_accounts('8a100001-0000-0000-0000-000000000001')), 2,
  'The pricer sees the vendor''s two portal accounts');
select is(public.supplier_account_email('8a000000-0000-0000-0000-00000000000a'), 'new@factory.example', 'The pricer gets the address for a new set-password link');
select throws_ok($$select public.supplier_account_email('8a000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'No set-password link for a staff account through this path');
select throws_ok($$select public._supplier_account_has_verified_mfa('8a000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'A signed-in account cannot ask whether an account has a second factor');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public._supplier_account_has_verified_mfa('8a000000-0000-0000-0000-00000000000a'), false, 'No factor: false');
reset role;
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
  values ('8a900001-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-00000000000a', 'totp', 'unverified', now(), now());
set local role service_role;
select is(public._supplier_account_has_verified_mfa('8a000000-0000-0000-0000-00000000000a'), false, 'An unverified factor does not count');
reset role;
update auth.mfa_factors set status = 'verified' where id = '8a900001-0000-0000-0000-000000000001';
set local role service_role;
select is(public._supplier_account_has_verified_mfa('8a000000-0000-0000-0000-00000000000a'), true, 'A verified factor counts');
reset role;
delete from auth.mfa_factors where id = '8a900001-0000-0000-0000-000000000001';

-- The cost basis: a signed-in account that cannot read cost gets nothing; the
-- Phase 8 margin trigger still computes it for a pipeline user without cost rights.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is(public.estimation_cost_basis('8a700001-0000-0000-0000-000000000001'), null::numeric,
  'A signed-in rep gets no cost basis');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select isnt(public.estimation_cost_basis('8a700001-0000-0000-0000-000000000001'), null::numeric,
  'A cost reader gets it (the rep''s NULL is the gate, not a missing estimation)');
reset role;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000008","role":"authenticated","aal":"aal2"}',true);
update public.internal_prices set proposed_price = 2500 where id = '8a800001-0000-0000-0000-000000000001';
select is((select margin_percentage from public.internal_prices where id = '8a800001-0000-0000-0000-000000000001'),
  60.00::numeric,  -- (2500 - cost 1000) / 2500
  'A pipeline user without cost rights (bd_manager) still gets the margin computed by the trigger');
select isnt((select margin_percentage from public.internal_prices where id = '8a800001-0000-0000-0000-000000000001'), null::numeric,
  'The margin is a figure, not NULL');

-- Retiring an account: suspend and unlink (service role), or delete the sign-in account.
set local role service_role;
select set_config('request.jwt.claims','',true);
select lives_ok($$update public.profiles set status = 'suspended', vendor_id = null where id = '8a000000-0000-0000-0000-000000000007'$$,
  'A suspended account can be unlinked');
-- An unlinked ex-supplier does not become staff, suspended or reactivated.
select lives_ok($$update public.profiles set status = 'suspended', vendor_id = null where id = '8a000000-0000-0000-0000-00000000000a'$$,
  'The activated account is suspended and unlinked');
-- With the supplier role row gone too, only the supplier history remains to stop it.
select lives_ok($$delete from public.user_roles where user_id = '8a000000-0000-0000-0000-00000000000a'$$,
  'An unlinked account''s supplier role can be removed');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-00000000000a','salesperson')$$,
  '23514', null, 'An unlinked ex-supplier cannot be given a staff role');
update public.profiles set status = 'active' where id = '8a000000-0000-0000-0000-00000000000a';
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-00000000000a','general_manager')$$,
  '23514', null, 'Nor once it is reactivated');
select lives_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000009','salesperson')$$,
  'A normal staff account is given a role as before');
reset role;  -- as GoTrue's admin delete does it
select lives_ok($$delete from auth.users where id = '8a000000-0000-0000-0000-00000000000a'$$,
  'Deleting a supplier''s sign-in account removes its role with it');
select is((select count(*)::int from public.user_roles where user_id = '8a000000-0000-0000-0000-00000000000a'), 0, 'Its role went with it');

-- Every public table carries the session boundary.
select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('profiles','user_roles')
              and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                                and p.policyname = 'audit_session_boundary' and p.permissive = 'RESTRICTIVE')),
  null::text[], 'Every public table has the restrictive session boundary');

select * from finish();
rollback;
