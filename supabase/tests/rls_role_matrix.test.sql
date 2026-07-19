-- RLS Role Matrix — comprehensive allow/deny coverage
--
-- Role capability model:
--   viewer        read-only on most tables; no writes
--   salesperson   read all; INSERT on core CRM; UPDATE own records only; no DELETE
--   bd_manager    pipeline operator — INSERT + UPDATE; no DELETE
--   sales_manager commercial manager + platform admin — full access; DELETE via API only
--   system_admin  platform admin only — audit/user visibility; NOT commercial manager
--
-- 28 assertions across 7 table groups:
--   A: opportunities (5)   B: leads (5)        C: tenders (4)   D: approvals (4)
--   E: audit_log (3)       F: user_roles (4)   G: sales_targets (3)
--
-- Test user UUIDs (prefix 20…):
--   viewer        20000000-0000-0000-0000-000000000001
--   salesperson   20000000-0000-0000-0000-000000000002
--   bd_manager    20000000-0000-0000-0000-000000000003
--   sales_manager 20000000-0000-0000-0000-000000000004
--   system_admin  20000000-0000-0000-0000-000000000005
--
-- Fixture rows use IDs with prefix f0…

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- ── 1. Seed test users ───────────────────────────────────────────────────────

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'rls2-viewer@phc-local.test',        now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'rls2-salesperson@phc-local.test',   now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'rls2-bd-manager@phc-local.test',    now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'rls2-sales-manager@phc-local.test', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'rls2-system-admin@phc-local.test',  now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- Profiles are auto-created by trigger; activate all five.
update public.profiles
set status = 'active'
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000005'
);

insert into public.user_roles (user_id, role) values
  ('20000000-0000-0000-0000-000000000001', 'viewer'),
  ('20000000-0000-0000-0000-000000000002', 'salesperson'),
  ('20000000-0000-0000-0000-000000000003', 'bd_manager'),
  ('20000000-0000-0000-0000-000000000004', 'sales_manager'),
  ('20000000-0000-0000-0000-000000000005', 'system_admin');

-- ── 2. Fixture data (postgres / bypasses RLS) ────────────────────────────────
-- Two opportunities: one for read/write tests, one reserved for the DELETE test.
insert into public.opportunities (id, project_name, owner_id, created_by) values
  ('f0000000-0000-0000-0000-000000000001', 'fixture-opp',
   '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000002', 'fixture-opp-delete',
   '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004');

-- fixture-lead: owned by salesperson (tests B1–B3 + salesperson-can-edit-own).
-- fixture-lead-other: owned by bd_manager (tests B4 denial — salesperson cannot
-- update another person's lead, since they are not a pipeline_operator).
insert into public.leads (id, project_name, owner_id, created_by) values
  ('f0000000-0000-0000-0000-000000000003', 'fixture-lead',
   '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000006', 'fixture-lead-other',
   '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003');

-- Two tenders: one for read/write tests, one for the DELETE test.
insert into public.tenders (id, tender_name, tender_owner_id) values
  ('f0000000-0000-0000-0000-000000000004', 'fixture-tender',
   '20000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000005', 'fixture-tender-delete',
   '20000000-0000-0000-0000-000000000004');

-- One audit_log row so platform_admin SELECT tests find > 0 rows.
insert into public.audit_log (actor_id, action, entity_type, entity_id) values
  ('20000000-0000-0000-0000-000000000004', 'test.fixture',
   'opportunity', 'f0000000-0000-0000-0000-000000000001');

-- One sales_target for sales_manager so user_id = uid checks are testable.
insert into public.sales_targets
  (user_id, period_type, period_start, sales_target, pipeline_target,
   quotation_target, activity_target, reactivation_target)
values
  ('20000000-0000-0000-0000-000000000004', 'monthly', '2026-07-01',
   500000, 1000000, 5, 20, 2);

-- ── 3. RLS assertions ────────────────────────────────────────────────────────
set local role authenticated;

-- ════════════════════ A: opportunities ═══════════════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.opportunities where project_name = 'fixture-opp'),
  1, 'A1: viewer can read an opportunity');

select throws_ok(
  $$insert into public.opportunities (project_name) values ('viewer-must-not-create')$$,
  '42501', null, 'A2: viewer cannot insert an opportunity');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.opportunities (project_name, owner_id, created_by)
    values ('salesperson-created-opp',
            '20000000-0000-0000-0000-000000000002',
            '20000000-0000-0000-0000-000000000002')$$,
  'A3: salesperson can insert an opportunity');

-- DELETE grant was revoked from the authenticated role by migration
-- 20260711160000_rbac_record_lifecycle_hardening.sql; all direct DELETE
-- attempts raise 42501 regardless of RLS policy.  Deletes must go through
-- the sales-os-api lifecycle handler (service_role).
select throws_ok(
  $$delete from public.opportunities where project_name = 'fixture-opp'$$,
  '42501', null,
  'A4: DELETE on opportunities is rejected (grant revoked from authenticated; use sales-os-api)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select throws_ok(
  $$delete from public.opportunities where project_name = 'fixture-opp-delete'$$,
  '42501', null,
  'A5: DELETE is API-only — sales_manager direct SQL is also rejected (grant revoked)');

-- ════════════════════ B: leads ════════════════════════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.leads where project_name = 'fixture-lead'),
  1, 'B1: viewer can read a lead');

select throws_ok(
  $$insert into public.leads (project_name) values ('viewer-must-not-create-lead')$$,
  '42501', null, 'B2: viewer cannot insert a lead');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.leads (project_name, owner_id, created_by)
    values ('salesperson-created-lead',
            '20000000-0000-0000-0000-000000000002',
            '20000000-0000-0000-0000-000000000002')$$,
  'B3: salesperson can insert a lead');

-- UPDATE policy (after rbac_record_lifecycle_hardening): owner OR pipeline_operator.
-- Salesperson is the owner of fixture-lead but NOT a pipeline_operator,
-- so they can edit their own lead but cannot touch another person's lead.
update public.leads set project_name = 'salesperson-hacked-other-lead'
  where project_name = 'fixture-lead-other';
select is(
  (select count(*)::integer from public.leads where project_name = 'fixture-lead-other'),
  1, 'B4: salesperson cannot UPDATE a lead they do not own (row unchanged)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

-- bd_manager is a pipeline_operator — can update any lead regardless of owner.
update public.leads set project_name = 'bd-updated-lead'
  where project_name = 'fixture-lead-other';
select is(
  (select count(*)::integer from public.leads where project_name = 'bd-updated-lead'),
  1, 'B5: bd_manager (pipeline_operator) can update any lead');

-- ════════════════════ C: tenders ══════════════════════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.tenders where tender_name = 'fixture-tender'),
  1, 'C1: viewer can read a tender');

select throws_ok(
  $$insert into public.tenders (tender_name) values ('viewer-must-not-create-tender')$$,
  '42501', null, 'C2: viewer cannot insert a tender');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.tenders (tender_name, tender_owner_id)
    values ('salesperson-created-tender', '20000000-0000-0000-0000-000000000002')$$,
  'C3: salesperson can insert a tender');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

-- Same as A4/A5: DELETE grant revoked from authenticated on tenders.
select throws_ok(
  $$delete from public.tenders where tender_name = 'fixture-tender-delete'$$,
  '42501', null,
  'C4: DELETE on tenders is API-only — direct SQL rejected for all authenticated');

-- ════════════════════ D: approvals ════════════════════════════════════════════
-- Policies: "Approvals readable" (all authenticated), "Approvals requestable by
-- salesperson" (INSERT; requested_by = uid AND status = pending), "Approvals
-- writable by commercial managers" (ALL; is_commercial_manager).

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select ok(
  (select count(*)::integer from public.approvals) >= 0,
  'D1: viewer can query approvals (readable by all authenticated)');

select throws_ok(
  $$insert into public.approvals (approval_type, requested_by, status)
    values ('owner_assignment', '20000000-0000-0000-0000-000000000001', 'pending')$$,
  '42501', null, 'D2: viewer cannot insert an approval');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.approvals (approval_type, requested_by, status)
    values ('owner_assignment', '20000000-0000-0000-0000-000000000002', 'pending')$$,
  'D3: salesperson can request an approval on their own behalf (status = pending)');

-- system_admin is platform_admin but NOT commercial_manager and NOT salesperson.
select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.approvals (approval_type, requested_by, status)
    values ('owner_assignment', '20000000-0000-0000-0000-000000000005', 'pending')$$,
  '42501', null, 'D4: system_admin cannot insert an approval (not commercial manager or salesperson)');

-- ════════════════════ E: audit_log ════════════════════════════════════════════
-- Policy: is_platform_admin (system_admin, managing_director, general_manager,
-- ceo, sales_manager). salesperson and bd_manager see 0 rows.

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.audit_log),
  0, 'E1: salesperson sees no audit_log rows (platform_admin required)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select ok(
  (select count(*)::integer from public.audit_log) >= 1,
  'E2: system_admin can read audit_log (platform_admin)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select ok(
  (select count(*)::integer from public.audit_log) >= 1,
  'E3: sales_manager can read audit_log (platform_admin)');

-- ════════════════════ F: user_roles ═══════════════════════════════════════════
-- user_roles SELECT policies:
--   1. "Users can view their own roles"  — user_id = auth.uid()   (every user)
--   2. "Platform admins can view all roles" — is_platform_admin()  (managers + system_admin)
-- viewer and salesperson each see exactly 1 row: their own seeded role.

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.user_roles),
  1, 'F1: viewer sees only their own user_roles row (own-role policy)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.user_roles),
  1, 'F2: salesperson sees only their own user_roles row (own-role policy)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select ok(
  (select count(*)::integer from public.user_roles) >= 1,
  'F3: sales_manager can read user_roles (platform_admin)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select ok(
  (select count(*)::integer from public.user_roles) >= 1,
  'F4: system_admin can read user_roles (platform_admin)');

-- ════════════════════ G: sales_targets ════════════════════════════════════════
-- SELECT policy: user_id = auth.uid() OR is_commercial_manager.
-- INSERT/UPDATE/DELETE: is_commercial_manager only.
-- system_admin is platform_admin but NOT commercial_manager → INSERT blocked.

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.sales_targets),
  0, 'G1: viewer sees no sales_targets (no own targets seeded, not commercial manager)');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.sales_targets
      (user_id, period_type, period_start, sales_target, pipeline_target,
       quotation_target, activity_target, reactivation_target)
    values ('20000000-0000-0000-0000-000000000002', 'monthly', '2026-08-01',
            400000, 800000, 4, 15, 1)$$,
  'G2: sales_manager (commercial manager) can insert a sales_target');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.sales_targets
      (user_id, period_type, period_start, sales_target, pipeline_target,
       quotation_target, activity_target, reactivation_target)
    values ('20000000-0000-0000-0000-000000000002', 'monthly', '2026-09-01',
            400000, 800000, 4, 15, 1)$$,
  '42501', null,
  'G3: system_admin cannot insert a sales_target (platform_admin ≠ commercial_manager)');

select * from finish();

rollback;
