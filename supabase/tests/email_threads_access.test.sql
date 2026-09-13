-- Email threads — tokens that bind a client's reply to a deal
--
-- A valid thread token lets whoever holds it attach an email to that deal. The
-- tokens are stored hashed and the table belongs to the service role alone: the
-- send_email handler writes it, the inbound webhook will read it, and no browser
-- session has any reason to see, add or enumerate a row.
--
-- These assertions exercise the grants and RLS as a real signed-in salesperson,
-- because "no policy" is only a guarantee if the grant is gone too — a future
-- permissive policy on a table that still grants SELECT would open it silently.
--
-- Test user UUIDs use the 26… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '26000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'mail-rep+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set status = 'active'
 where id = '26000000-0000-0000-0000-000000000001';
insert into public.user_roles (user_id, role)
values ('26000000-0000-0000-0000-000000000001', 'salesperson');

-- A row written the way the handler writes it: as the service role.
insert into public.email_threads (token_hash, owner_id)
values (repeat('a', 64), '26000000-0000-0000-0000-000000000001');

-- ── As the signed-in salesperson ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"26000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$select * from public.email_threads$$,
  '42501', null,
  'A salesperson cannot read thread tokens, not even their own');

select throws_ok(
  $$insert into public.email_threads (token_hash) values (repeat('b', 64))$$,
  '42501', null,
  'A salesperson cannot mint a thread token');

select throws_ok(
  $$delete from public.email_threads$$,
  '42501', null,
  'A salesperson cannot delete thread tokens');

-- ── Back to the owner: the table's own guarantees ───────────────────────────
reset role;

select throws_ok(
  $$insert into public.email_threads (token_hash) values ('not-a-hash')$$,
  '23514', null,
  'Only a SHA-256 hex digest can be stored — a plaintext token is refused');

select throws_ok(
  $$insert into public.email_threads (token_hash) values (repeat('a', 64))$$,
  '23505', null,
  'A token hash is unique');

insert into public.activities (activity_type, status, provider_message_id)
values ('email_draft', 'sent', 'pm-msg-1');

select throws_ok(
  $$insert into public.activities (activity_type, status, provider_message_id)
    values ('email_draft', 'sent', 'pm-msg-1')$$,
  '23505', null,
  'A provider message is recorded once — a retried webhook cannot duplicate it');

select * from finish();
rollback;
