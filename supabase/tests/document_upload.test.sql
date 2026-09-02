-- Document upload — the RETURNING clause is part of the contract
--
-- Reported 2026-09-02: a BD Manager could not attach a file to an opportunity
-- and got `new row violates row-level security policy for table "documents"`.
-- Measured on production: `documents` held 3 legacy backfill rows and **zero**
-- real uploads, on a feature shipped 2026-08-23. Nobody had ever uploaded
-- anything.
--
-- The INSERT policy was never the problem. A bare INSERT succeeded for the same
-- user in the same session. What failed was `INSERT ... RETURNING`, which the
-- client uses because it needs the id for the document_links row -- PostgreSQL
-- applies the SELECT policy to the row an INSERT hands back, and that policy
-- called a function that goes to `public.documents` to find the row. Mid-INSERT
-- the row is not in the statement snapshot, so it found nothing.
--
-- Which is why the assertions below insert WITH `returning id`. A test that
-- inserts without it passes against the broken policy and proves nothing, and
-- that is exactly the shape of test that would have let this ship.
--
-- Test user UUIDs follow rls_role_matrix.test.sql (prefix 20…).

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- ── 1. Users ─────────────────────────────────────────────────────────────────
-- Emails must be @phc-sa.com: a signup trigger rejects anything else, and it
-- rejected the first draft of this file. Same UUIDs and the same +test
-- convention as rls_role_matrix.test.sql; each test rolls back, so they do not
-- collide.
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'doc-viewer+test@phc-sa.com',      now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'doc-salesperson+test@phc-sa.com', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'doc-bd-manager+test@phc-sa.com',  now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- Profiles are auto-created by trigger; activate all three.
update public.profiles set status = 'active'
 where id in ('20000000-0000-0000-0000-000000000001',
              '20000000-0000-0000-0000-000000000002',
              '20000000-0000-0000-0000-000000000003');

insert into public.user_roles (user_id, role) values
  ('20000000-0000-0000-0000-000000000001', 'viewer'),
  ('20000000-0000-0000-0000-000000000002', 'salesperson'),
  ('20000000-0000-0000-0000-000000000003', 'bd_manager');

insert into public.opportunities (id, project_name, owner_id, created_by)
values ('f1000000-0000-0000-0000-000000000001', 'upload-fixture-opp',
        '20000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000002');

-- ── 2. Assertions ────────────────────────────────────────────────────────────
set local role authenticated;

-- ════════════════ A: the reported failure ════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.documents
      (storage_bucket, storage_path, original_filename, mime_type,
       size_bytes, checksum, doc_type, uploaded_by)
    values ('attachments', 'opportunity/f1/a.pdf', 'a.pdf', 'application/pdf',
            1024, repeat('a', 64), 'other',
            '20000000-0000-0000-0000-000000000003')
    returning id$$,
  'A1: bd_manager can INSERT ... RETURNING a document -- the exact call the client makes');

-- Two statements, not one, because that is what the client does: it inserts the
-- document, gets the id back, then posts the link. A CTE doing both in a single
-- statement fails on `document_links` for the same snapshot reason as the bug
-- above -- and it would have been a test asserting something the application
-- never asks for.
select lives_ok(
  $$insert into public.documents
      (id, storage_bucket, storage_path, original_filename, mime_type,
       size_bytes, checksum, doc_type, uploaded_by)
    values ('d1000000-0000-0000-0000-000000000001',
            'attachments', 'opportunity/f1/b.pdf', 'b.pdf', 'application/pdf',
            2048, repeat('b', 64), 'other',
            '20000000-0000-0000-0000-000000000003')
    returning id$$,
  'A2: the document row lands, and hands its id back');

select lives_ok(
  $$insert into public.document_links (document_id, entity_type, entity_id, linked_by)
    values ('d1000000-0000-0000-0000-000000000001', 'opportunity',
            'f1000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000003')$$,
  'A3: and the link that makes the file reachable lands too');

-- ════════════════ B: a salesperson too ═══════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.documents
      (storage_bucket, storage_path, original_filename, mime_type,
       size_bytes, checksum, doc_type, uploaded_by)
    values ('attachments', 'opportunity/f1/c.pdf', 'c.pdf', 'application/pdf',
            512, repeat('c', 64), 'other',
            '20000000-0000-0000-0000-000000000002')
    returning id$$,
  'B1: salesperson can upload');

-- ════════════════ C: what must still be refused ══════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.documents
      (storage_bucket, storage_path, original_filename, mime_type,
       size_bytes, checksum, doc_type, uploaded_by)
    values ('attachments', 'opportunity/f1/d.pdf', 'd.pdf', 'application/pdf',
            10, repeat('d', 64), 'other',
            '20000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'C1: viewer still cannot upload -- the fix widened reading, not writing');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.documents
      (storage_bucket, storage_path, original_filename, mime_type,
       size_bytes, checksum, doc_type, uploaded_by)
    values ('attachments', 'opportunity/f1/e.pdf', 'e.pdf', 'application/pdf',
            10, repeat('e', 64), 'other',
            '20000000-0000-0000-0000-000000000003')$$,
  '42501', null,
  'C2: you still cannot register a file as somebody else');

-- A document nobody linked and that you did not upload stays invisible. This is
-- the property the inline uploader clause must not have loosened.
select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.documents
    where storage_path = 'opportunity/f1/a.pdf'),
  0, 'C3: viewer cannot read a document uploaded by someone else');

select * from finish();

rollback;
