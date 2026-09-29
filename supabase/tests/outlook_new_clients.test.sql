-- New clients and Outlook capture: a contact's company email teaches the company
-- its domain, and a new client restarts the mailbox sync rounds.
--
-- Rows use the 2d… prefix; each test rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.companies (id, name) values
  ('2d000000-0000-0000-0000-00000000000a', 'capture-newco'),
  ('2d000000-0000-0000-0000-00000000000b', 'capture-freemail-co');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '2d000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
        'capture-sync+test@phc-sa.com', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.mail_sync_state (user_id, folder, delta_link)
values ('2d000000-0000-0000-0000-000000000001', 'inbox', 'https://graph.microsoft.com/v1.0/delta');

insert into public.contacts (company_id, name, email)
values ('2d000000-0000-0000-0000-00000000000a', 'Capture Fixture', 'Buyer@Capture-NewCo-Test.com');

select is((select website_domain from public.companies where id = '2d000000-0000-0000-0000-00000000000a'),
  'capture-newco-test.com', 'A company email fills the company''s domain');
select ok((select delta_link is null from public.mail_sync_state where user_id = '2d000000-0000-0000-0000-000000000001'),
  'A new client restarts the sync round');

insert into public.contacts (company_id, name, email)
values ('2d000000-0000-0000-0000-00000000000b', 'Free Mail Fixture', 'someone@gmail.com');
select is((select website_domain from public.companies where id = '2d000000-0000-0000-0000-00000000000b'),
  null, 'A free-mail address never becomes a company domain');

select ok(public.is_free_mail_domain('Hotmail.com'), 'Free-mail check ignores case');
select ok(not public.is_free_mail_domain('client.sa'), 'A company domain is not free mail');

select * from finish();
rollback;
