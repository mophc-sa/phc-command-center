-- Calendar feed links — whoever holds one can read a person's schedule
--
-- The table stores one hashed link per person and belongs to the service role
-- alone: the sales-os-api handlers write it for the caller, the calendar-feed
-- function reads it. No browser session may read, mint or remove a row — not
-- even its own, since the handlers are the only intended path.
--
-- Test user UUIDs use the 28… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '28000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'feed-rep+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set status = 'active'
 where id = '28000000-0000-0000-0000-000000000001';
insert into public.user_roles (user_id, role)
values ('28000000-0000-0000-0000-000000000001', 'salesperson');

-- A link written the way the handler writes it: as the service role.
insert into public.calendar_feed_tokens (user_id, token_hash)
values ('28000000-0000-0000-0000-000000000001', repeat('c', 64));

-- ── As the signed-in salesperson ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"28000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$select * from public.calendar_feed_tokens$$,
  '42501', null,
  'A salesperson cannot read feed links, not even their own');

select throws_ok(
  $$update public.calendar_feed_tokens set token_hash = repeat('d', 64)$$,
  '42501', null,
  'A salesperson cannot overwrite a feed link');

select throws_ok(
  $$delete from public.calendar_feed_tokens$$,
  '42501', null,
  'A salesperson cannot delete feed links directly');

-- ── Back to the owner: the table's own guarantees ───────────────────────────
reset role;

select throws_ok(
  $$update public.calendar_feed_tokens set token_hash = 'plaintext'$$,
  '23514', null,
  'Only a SHA-256 hex digest can be stored — a plaintext link is refused');

select throws_ok(
  $$insert into public.calendar_feed_tokens (user_id, token_hash)
    values ('28000000-0000-0000-0000-000000000001', repeat('e', 64))$$,
  '23505', null,
  'One link per person — a second is an upsert, never a parallel link');

delete from auth.users where id = '28000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.calendar_feed_tokens
    where user_id = '28000000-0000-0000-0000-000000000001'),
  0,
  'Deleting the user deletes their link');

select * from finish();
rollback;
