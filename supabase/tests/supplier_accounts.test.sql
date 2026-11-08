-- PR 3 Task 1: the supplier role, its boundary, and supplier accounts.
-- Test user UUIDs use the 8a prefix. Every session carries aal2 unless it says otherwise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'sa-rep'),(2,'sa-pricer'),(3,'sa-gm'),(4,'sa-supplier'),(5,'sa-admin'),(6,'sa-new')) v(n, r);
update public.profiles set status = 'active' where id::text like '8a000000-%' and id <> '8a000000-0000-0000-0000-000000000006';
insert into public.user_roles (user_id, role) values
  ('8a000000-0000-0000-0000-000000000001','salesperson'),
  ('8a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8a000000-0000-0000-0000-000000000002','finance_manager'),
  ('8a000000-0000-0000-0000-000000000003','general_manager'),
  ('8a000000-0000-0000-0000-000000000005','system_admin');
insert into public.vendors (id, name) values
  ('8a100001-0000-0000-0000-000000000001','sa Vendor One Co'),
  ('8a100002-0000-0000-0000-000000000001','SA VENDOR ONE co.');
-- Fixture only: the supplier account as supplier_account_activate leaves it (triggers off).
set local session_replication_role = replica;
update public.profiles set vendor_id = '8a100001-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage) values
  ('8a200001-0000-0000-0000-000000000001','sa-deal-1','8a000000-0000-0000-0000-000000000001','8a000000-0000-0000-0000-000000000001','rfq_received');
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
select is((select count(*)::int from public.vendor_duplicate_candidates), 0, 'A supplier reads no vendor names through the duplicates view');
select is((select count(*)::int from public.automation_health), 0, 'A supplier reads no automation health');
select is(public.current_margin_floor(), null::numeric, 'A supplier gets no margin floor');
select throws_ok($$update public.profiles set vendor_id = '8a100002-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'A supplier cannot move its own account to another vendor');
select throws_ok($$select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001','x@example.com','X')$$,
  '42501', null, 'A supplier cannot create supplier accounts');
select throws_ok($$select * from public.pricing_supplier_accounts('8a100001-0000-0000-0000-000000000001')$$,
  '42501', null, 'A supplier cannot list supplier accounts');

-- Staff are unaffected.
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.has_app_access('8a000000-0000-0000-0000-000000000002'), true, 'A pricer with MFA keeps app access');
select is((select count(*)::int from public.vendor_duplicate_candidates where vendor_count = 2), 1, 'Estimation still reads the duplicate vendors (as invoker)');
select is(public.current_margin_floor(), 12.00::numeric, 'Staff still read the margin floor');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.automation_health where trigger = 'sa-probe'), 1, 'The system administrator still reads automation health');
select throws_ok($$update public.profiles set vendor_id = '8a100002-0000-0000-0000-000000000001' where id = '8a000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'Not even the system administrator edits a supplier''s vendor directly');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000004','salesperson')$$,
  '23514', null, 'A supplier account cannot also be given a staff role');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000001','supplier')$$,
  '23514', null, 'A staff account cannot be given the supplier role');
select throws_ok($$insert into public.user_roles (user_id, role) values ('8a000000-0000-0000-0000-000000000006','supplier')$$,
  '23514', null, 'The supplier role needs a vendor on the profile');

-- Reading the session's vendor (internal helper: called as the owner with each session's claims).
reset role;
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
create temp table sa_invite (id uuid);
grant all on sa_invite to authenticated, service_role;
insert into sa_invite select public.supplier_account_prepare('8a100001-0000-0000-0000-000000000001',' New@Factory.Example ','New Contact');
select throws_ok($$select count(*) from public.supplier_account_invites$$, '42501', null, 'Nobody reads the requests table directly');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.supplier_account_prepare('8a100002-0000-0000-0000-000000000001','other@factory.example','Other')$$,
  'The system administrator can prepare a supplier account');
reset role;
select is((select email from public.supplier_account_invites where id = (select id from sa_invite)), 'new@factory.example',
  'The request keeps the address trimmed and lower-cased');
select set_config('request.jwt.claims','',true);
-- GoTrue's insert: a non-PHC address passes only with the request id in app_metadata.
select throws_ok($$insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000a','authenticated','authenticated','new@factory.example',
          '{"provider":"email"}','{}', now(), now())$$,
  '23514', null, 'A non-PHC sign-up without the request is refused');
select lives_ok(format($$insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000','8a000000-0000-0000-0000-00000000000a','authenticated','authenticated','new@factory.example',
          '{"provider":"email","phc_supplier_invite":"%s"}','{}', now(), now())$$, (select id from sa_invite)),
  'The supplier-account action''s insert passes');
select lives_ok($$update auth.users set last_sign_in_at = now(), email = email where id = '8a000000-0000-0000-0000-00000000000a'$$,
  'Signing in later (address unchanged) passes');
select throws_ok($$update auth.users set email = 'changed@factory.example' where id = '8a000000-0000-0000-0000-00000000000a'$$,
  '23514', null, 'Changing to another non-PHC address is refused');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-00000000000a')$$, (select id from sa_invite)),
  '42501', null, 'Only the service role activates an account');
set local role service_role;
select set_config('request.jwt.claims','',true);
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-000000000006')$$, (select id from sa_invite)),
  '23514', null, 'The account must be the one the request named');
select is((public.supplier_account_activate((select id from sa_invite), '8a000000-0000-0000-0000-00000000000a'))->>'vendor_id',
  '8a100001-0000-0000-0000-000000000001', 'Activation links the account to the vendor');
select is((select status::text || '/' || coalesce(sales_code, '-') || '/' || full_name from public.profiles where id = '8a000000-0000-0000-0000-00000000000a'),
  'active/-/New Contact', 'The account is active, holds no sales code, and carries the contact''s name');
select is((select array_agg(role::text) from public.user_roles where user_id = '8a000000-0000-0000-0000-00000000000a'), array['supplier'],
  'The account holds the supplier role only');
select throws_ok(format($$select public.supplier_account_activate('%s','8a000000-0000-0000-0000-00000000000a')$$, (select id from sa_invite)),
  'P0001', null, 'A request is used once');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'supplier_account.created' and entity_id = '8a000000-0000-0000-0000-00000000000a'
  and actor_id = '8a000000-0000-0000-0000-000000000002'), 'Creating the account is audited as the pricer''s');

-- Listing and the set-password address.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_supplier_accounts('8a100001-0000-0000-0000-000000000001')), 2,
  'The pricer sees the vendor''s two portal accounts');
select is(public.supplier_account_email('8a000000-0000-0000-0000-00000000000a'), 'new@factory.example', 'The pricer gets the address for a new set-password link');
select throws_ok($$select public.supplier_account_email('8a000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'No set-password link for a staff account through this path');

-- Every public table carries the session boundary.
reset role;
select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('profiles','user_roles')
              and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                                and p.policyname = 'audit_session_boundary' and p.permissive = 'RESTRICTIVE')),
  null::text[], 'Every public table has the restrictive session boundary');

select * from finish();
rollback;
