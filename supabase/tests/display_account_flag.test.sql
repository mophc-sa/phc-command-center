-- The display-account guard — who it must stop, and who it must not
--
-- The trigger from 20260924100000 refused every UPDATE where `auth.uid()` was
-- NULL. That reads as caution and is the opposite: measured on production,
-- UPDATE on `public.profiles` is granted only to authenticated, postgres and
-- service_role, and the single UPDATE policy is `TO authenticated`. `anon`
-- cannot reach the table at all, so a NULL uid means the caller is already
-- inside the database -- and `postgres` deletes the guard in one statement:
--
--     alter table public.profiles disable trigger profiles_guard_display_flag;
--
-- So the NULL branch stopped nobody it was written for, and stopped the one
-- person who needs it: the Supabase SQL editor runs as `postgres`, so the
-- system_admin setting the flag was refused twice on 2026-09-02 while holding
-- every required role.
--
-- Case C is that regression. Cases A and B are the guard's actual job, and
-- they must keep passing -- a fix that widened the door instead of moving it
-- would show up here as B failing.
--
-- Test user UUIDs use the 24… prefix; document_upload uses 20… and the role
-- matrix 10…. Each test rolls back, so they do not collide.

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

-- ── 1. Users ─────────────────────────────────────────────────────────────────
-- Emails must be @phc-sa.com: a signup trigger rejects anything else.
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '24000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'flag-viewer+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '24000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'flag-admin+test@phc-sa.com',  now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set status = 'active'
 where id in ('24000000-0000-0000-0000-000000000001',
              '24000000-0000-0000-0000-000000000002');

insert into public.user_roles (user_id, role) values
  ('24000000-0000-0000-0000-000000000001', 'viewer'),
  ('24000000-0000-0000-0000-000000000002', 'system_admin');

-- ── 2. Assertions ────────────────────────────────────────────────────────────

-- ════════════════ A: the whole point of the trigger ══════════════════════════
-- "My session never expires" is not a preference a user grants themselves.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"24000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$update public.profiles set is_display_account = true
     where id = '24000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'Only an administrator may mark an account as a display account',
  'A: a viewer cannot grant itself display-account status');

-- And the rest of the row is still theirs to edit -- the guard watches one
-- column, not the table.
select lives_ok(
  $$update public.profiles set full_name = 'Flag Viewer'
     where id = '24000000-0000-0000-0000-000000000001'$$,
  'A2: the same viewer can still edit its own profile');

-- ════════════════ B: an administrator through the API ════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"24000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$update public.profiles set is_display_account = true
     where id = '24000000-0000-0000-0000-000000000001'$$,
  'B: a system_admin may mark an account as a display account');

-- ════════════════ C: the SQL editor, which is where this is actually done ════
-- No JWT and no RLS: this is `postgres`, the role that can drop the trigger.
-- Refusing it protected nothing and was the only thing the guard ever blocked.
reset role;
select set_config('request.jwt.claims', '', true);

select lives_ok(
  $$update public.profiles set is_display_account = false
     where id = '24000000-0000-0000-0000-000000000001'$$,
  'C: an admin in the SQL editor (auth.uid() IS NULL) is not refused');

select * from finish();
rollback;
