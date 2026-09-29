-- Connected Outlook mailboxes — the refresh token is reachable by the service
-- role alone, and disconnecting leaves nothing behind.
--
-- Test user UUIDs use the 2b… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '2b000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'mail-rep+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());
update public.profiles set status = 'active' where id = '2b000000-0000-0000-0000-000000000001';
insert into public.user_roles (user_id, role) values ('2b000000-0000-0000-0000-000000000001', 'salesperson');

-- ── As the service role (what the functions run as) ─────────────────────────
select lives_ok(
  $$select public.save_mail_connection('2b000000-0000-0000-0000-000000000001', 'ms-1',
      'Mail-Rep+Test@phc-sa.com', array['Mail.Send'], 'refresh-one')$$,
  'The service role can store a connection');

select is(public.mail_refresh_token('2b000000-0000-0000-0000-000000000001'), 'refresh-one',
  'The refresh token reads back from Vault');

select is((select email from public.mail_connections where user_id = '2b000000-0000-0000-0000-000000000001'),
  'mail-rep+test@phc-sa.com', 'The mailbox is stored lower-cased');

select lives_ok(
  $$select public.rotate_mail_refresh_token('2b000000-0000-0000-0000-000000000001', 'refresh-two')$$,
  'A rotated token replaces the old one');

select is(public.mail_refresh_token('2b000000-0000-0000-0000-000000000001'), 'refresh-two',
  'The rotated token is the one read back');

-- ── As the salesperson themselves ───────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"2b000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok($$select * from public.mail_connections$$, '42501', null,
  'A person cannot read connections, not even their own');
select throws_ok($$select * from public.mail_oauth_pending$$, '42501', null,
  'A person cannot read sign-ins in progress');
select throws_ok($$select public.mail_refresh_token('2b000000-0000-0000-0000-000000000001')$$, '42501', null,
  'A person cannot read a refresh token, not even their own');
select throws_ok($$select public.delete_mail_connection('2b000000-0000-0000-0000-000000000001')$$, '42501', null,
  'A person cannot call the connection functions directly');

reset role;

-- ── Disconnect leaves nothing ───────────────────────────────────────────────
select ok(public.delete_mail_connection('2b000000-0000-0000-0000-000000000001'), 'Disconnect succeeds');
select ok(not exists(select 1 from vault.secrets where name = 'mail_refresh_2b000000-0000-0000-0000-000000000001'),
  'Disconnect deletes the Vault secret');

select throws_ok(
  $$insert into public.email_threads (opportunity_id) values (null)$$,
  '23514', null, 'A thread needs a reply token or a Graph conversation id');

select * from finish();
rollback;
