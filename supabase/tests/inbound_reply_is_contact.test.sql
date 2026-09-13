-- A client's reply counts as contact — and visibility still holds
--
-- 20260930120000 adds 'email_received' to last_verified_client_contact(). The
-- function is SECURITY DEFINER and enforces visibility itself, so a change to its
-- contact rule is only safe if a caller who cannot read the deal still gets NULL.
-- Both are asserted here, against a real row, as real users.
--
-- Test user UUIDs use the 27… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '27000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'reply-owner+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '27000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'reply-stranger+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set status = 'active'
 where id in ('27000000-0000-0000-0000-000000000001',
              '27000000-0000-0000-0000-000000000002');

insert into public.user_roles (user_id, role) values
  ('27000000-0000-0000-0000-000000000001', 'salesperson'),
  ('27000000-0000-0000-0000-000000000002', 'salesperson');

insert into public.opportunities (id, project_name, owner_id, created_by)
values ('f2700000-0000-0000-0000-000000000001', 'reply-fixture-opp',
        '27000000-0000-0000-0000-000000000001',
        '27000000-0000-0000-0000-000000000001');

-- ── Before any reply: no proof of contact ───────────────────────────────────
select is(
  public.last_verified_client_contact('f2700000-0000-0000-0000-000000000001'),
  null,
  'A deal with no client-facing activity has no verified contact');

-- A note to ourselves is still not contact.
insert into public.activities (activity_type, status, related_opportunity_id, occurred_at)
values ('note', 'logged', 'f2700000-0000-0000-0000-000000000001', '2026-09-01T09:00:00Z');

select is(
  public.last_verified_client_contact('f2700000-0000-0000-0000-000000000001'),
  null,
  'A note is not contact');

-- ── The client replies ──────────────────────────────────────────────────────
insert into public.activities (activity_type, status, related_opportunity_id, occurred_at, provider_message_id)
values ('email_received', 'logged', 'f2700000-0000-0000-0000-000000000001',
        '2026-09-12T06:00:00Z', 'pm-reply-fixture');

select is(
  public.last_verified_client_contact('f2700000-0000-0000-0000-000000000001'),
  '2026-09-12T06:00:00Z'::timestamptz,
  'A reply received from the client is verified contact');

-- ── Visibility is unchanged by the new rule ─────────────────────────────────
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"27000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.last_verified_client_contact('f2700000-0000-0000-0000-000000000001'),
  '2026-09-12T06:00:00Z'::timestamptz,
  'The deal owner sees the reply as contact');

select set_config('request.jwt.claims',
  '{"sub":"27000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  public.last_verified_client_contact('f2700000-0000-0000-0000-000000000001'),
  null,
  'A salesperson who cannot read the deal gets NULL — the reply does not leak contact history');

select * from finish();
rollback;
