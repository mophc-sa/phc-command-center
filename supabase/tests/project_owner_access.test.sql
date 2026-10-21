-- A project has an owner, and its owner may edit it
--
-- Spec: docs/superpowers/specs/2026-10-21-project-owner-design.md
-- Project data is open to the sales team while nobody owns a project, and
-- editing an unowned project claims it. The budget is narrower: the assigned
-- owner, or finance/BD. Test user UUIDs use the 4b… prefix; each test rolls back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','4b000000-0000-0000-0000-000000000001','authenticated','authenticated','po-owner+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4b000000-0000-0000-0000-000000000002','authenticated','authenticated','po-other+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4b000000-0000-0000-0000-000000000003','authenticated','authenticated','po-sm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','4b000000-0000-0000-0000-000000000004','authenticated','authenticated','po-fin+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '4b000000-%';
insert into public.user_roles (user_id, role) values
  ('4b000000-0000-0000-0000-000000000001','salesperson'),
  ('4b000000-0000-0000-0000-000000000002','salesperson'),
  ('4b000000-0000-0000-0000-000000000003','sales_manager'),
  ('4b000000-0000-0000-0000-000000000004','finance_manager');

-- Two projects: one nobody owns, one owned by the first salesperson.
insert into public.projects (id, name, owner_id) values
  ('4b100000-0000-0000-0000-000000000001', 'po-unassigned', null),
  ('4b100000-0000-0000-0000-000000000002', 'po-owned', '4b000000-0000-0000-0000-000000000001');

-- ── A salesperson and an unassigned project ────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"4b000000-0000-0000-0000-000000000002","role":"authenticated"}',true);

select lives_ok(
  $$update public.projects set notes = 'touched while unassigned' where id = '4b100000-0000-0000-0000-000000000001'$$,
  'A salesperson may edit a project nobody owns');

select is(
  (select owner_id from public.projects where id = '4b100000-0000-0000-0000-000000000001'),
  '4b000000-0000-0000-0000-000000000002'::uuid,
  'Editing an unassigned project makes the editor its owner');

select is(
  (select count(*)::int from public.audit_log
    where action = 'project.owner_claimed' and entity_id = '4b100000-0000-0000-0000-000000000001'),
  1,
  'The claim is recorded');

-- Now that it is owned, the other salesperson is out.
select set_config('request.jwt.claims','{"sub":"4b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select is(
  (select count(*)::int from public.projects
    where id = '4b100000-0000-0000-0000-000000000001'
      and public.can_edit_project(id, '4b000000-0000-0000-0000-000000000001')),
  0,
  'A salesperson may not edit a project someone else owns');

select throws_ok(
  $$update public.projects set owner_id = '4b000000-0000-0000-0000-000000000001'
     where id = '4b100000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'A salesperson cannot take a project that already has an owner');

-- Their own project is theirs to edit.
select lives_ok(
  $$update public.projects set notes = 'owner edit' where id = '4b100000-0000-0000-0000-000000000002'$$,
  'The owner edits their own project');

select lives_ok(
  $$insert into public.project_job_stages (id, project_id, name)
    values ('4b400000-0000-0000-0000-000000000001', '4b100000-0000-0000-0000-000000000002', 'po-stage')$$,
  'The owner adds a stage to their own project');

select lives_ok(
  $$insert into public.project_jobs (project_id, stage_id, title)
    values ('4b100000-0000-0000-0000-000000000002', '4b400000-0000-0000-0000-000000000001', 'po-job')$$,
  'The owner adds a job to their own project');

-- ── The budget: the assigned owner only ────────────────────────────────────
select lives_ok(
  $$insert into public.project_budget_items (project_id, category, planned_amount)
    values ('4b100000-0000-0000-0000-000000000002', 'signage', 1000)$$,
  'The owner may budget their own project');

select set_config('request.jwt.claims','{"sub":"4b000000-0000-0000-0000-000000000002","role":"authenticated"}',true);

select is(
  (select count(*)::int from public.projects
    where id = '4b100000-0000-0000-0000-000000000002'
      and public.can_edit_project_budget(id, '4b000000-0000-0000-0000-000000000002')),
  0,
  'A salesperson may not budget a project owned by someone else');

-- The project this salesperson now owns by claiming is budgetable; an unowned
-- one is not — so a fresh unassigned project stays closed.
insert into public.projects (id, name, owner_id) values
  ('4b100000-0000-0000-0000-000000000003', 'po-unassigned-2', null);

select is(
  (select count(*)::int from public.projects
    where id = '4b100000-0000-0000-0000-000000000003'
      and public.can_edit_project_budget(id, '4b000000-0000-0000-0000-000000000002')),
  0,
  'An unassigned project''s budget is closed, even to the sales team');

-- ── Managers ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims','{"sub":"4b000000-0000-0000-0000-000000000003","role":"authenticated"}',true);

select lives_ok(
  $$update public.projects set owner_id = '4b000000-0000-0000-0000-000000000002'
     where id = '4b100000-0000-0000-0000-000000000002'$$,
  'A sales manager reassigns a project that already has an owner');

select set_config('request.jwt.claims','{"sub":"4b000000-0000-0000-0000-000000000004","role":"authenticated"}',true);

select is(
  (select count(*)::int from public.projects
    where id = '4b100000-0000-0000-0000-000000000003'
      and public.can_edit_project_budget(id, '4b000000-0000-0000-0000-000000000004')),
  1,
  'Finance may budget any project, assigned or not');

select * from finish();
rollback;
