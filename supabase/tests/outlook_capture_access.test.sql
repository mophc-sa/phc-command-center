-- Captured Outlook email — the sync key and state stay with the service role,
-- and only the mailbox owner (or a pipeline operator) can link a conversation.
--
-- Test user UUIDs use the 2c… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '2c000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'capture-owner+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '2c000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'capture-other+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());
update public.profiles set status = 'active'
 where id in ('2c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000002');
insert into public.user_roles (user_id, role) values
  ('2c000000-0000-0000-0000-000000000001', 'salesperson'),
  ('2c000000-0000-0000-0000-000000000002', 'salesperson');

insert into public.opportunities (id, project_name, owner_id, created_by)
values ('f2c00000-0000-0000-0000-000000000001', 'capture-fixture-opp',
        '2c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001');

insert into public.activities (id, activity_type, status, owner_id, created_by, occurred_at, email_conversation_id, provider_message_id)
values
  ('a2c00000-0000-0000-0000-000000000001', 'email_received', 'logged',
   '2c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', now(), 'conv-x', 'imid:<1@client>'),
  ('a2c00000-0000-0000-0000-000000000002', 'email_received', 'logged',
   '2c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', now(), 'conv-x', 'imid:<2@client>');

select ok(exists(select 1 from vault.secrets where name = 'outlook_sync_key'), 'The sync key exists in Vault');
select ok(not public.outlook_sync_key_matches('wrong'), 'A wrong key does not match');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"2c000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok($$select * from public.mail_sync_state$$, '42501', null, 'Sync state is not readable by people');
select throws_ok($$select public.outlook_sync_key_matches('x')$$, '42501', null, 'The key check is not callable by people');
select throws_ok(
  $$select public.bind_email_conversation('a2c00000-0000-0000-0000-000000000001', 'f2c00000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Another salesperson cannot link someone else''s email');

select set_config('request.jwt.claims',
  '{"sub":"2c000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  public.bind_email_conversation('a2c00000-0000-0000-0000-000000000001', 'f2c00000-0000-0000-0000-000000000001')->>'bound',
  '2', 'The owner links the email, and its whole conversation follows');

reset role;

select is((select count(*)::int from public.activities
            where email_conversation_id = 'conv-x' and related_opportunity_id = 'f2c00000-0000-0000-0000-000000000001'),
  2, 'Both emails of the conversation are on the deal');
select ok(exists(select 1 from public.email_threads where graph_conversation_id = 'conv-x'),
  'Later mail in the conversation will bind by thread');

select * from finish();
rollback;
