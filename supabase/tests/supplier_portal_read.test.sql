-- PR 3 Task 3: what a supplier reads in the portal, and the file it may download.
-- Test user UUIDs use the 8c prefix. Sessions carry aal2 unless they say otherwise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8c000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'pr-rep'),(2,'pr-pricer'),(3,'pr-gm'),(4,'pr-supplier-a'),(5,'pr-supplier-b')) v(n, r);
update public.profiles set status = 'active' where id::text like '8c000000-%';
insert into public.user_roles (user_id, role) values
  ('8c000000-0000-0000-0000-000000000001','salesperson'),
  ('8c000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8c000000-0000-0000-0000-000000000002','finance_manager'),
  ('8c000000-0000-0000-0000-000000000003','general_manager');
insert into public.vendors (id, name) values
  ('8c100001-0000-0000-0000-000000000001','pr-vendor-a'),
  ('8c100002-0000-0000-0000-000000000001','pr-vendor-b');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8c100001-0000-0000-0000-000000000001' where id = '8c000000-0000-0000-0000-000000000004';
update public.profiles set vendor_id = '8c100002-0000-0000-0000-000000000001' where id = '8c000000-0000-0000-0000-000000000005';
insert into public.user_roles (user_id, role) values
  ('8c000000-0000-0000-0000-000000000004','supplier'), ('8c000000-0000-0000-0000-000000000005','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pr-deal-secret-' || n,
       '8c000000-0000-0000-0000-000000000001','8c000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8c40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pr-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8c50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8c40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
-- A later revision of BOQ 1, to move file 1 onto while it stays at the supplier.
insert into public.boq_revisions (id, boq_id, revision_number, is_current) values
  ('8c500003-0000-0000-0000-000000000001','8c400001-0000-0000-0000-000000000001',2,false);
insert into public.boq_lines (id, revision_id, line_number, sign_type, description, quantity, unit, location, has_screen) values
  ('8c510001-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001',1,'Pylon P1','Double-sided pylon',2,'pcs','pr-site-secret',true),
  ('8c510002-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001',2,'Wall W1','Channel letters',4,'pcs',null,false),
  ('8c510003-0000-0000-0000-000000000001','8c500002-0000-0000-0000-000000000001',1,'Ceiling C1','Hanging sign',1,'pcs',null,false);
-- Vendor A's own quote from before the freeze (Phase 7B, typed by PHC): not this request's, so the portal never shows it.
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, lead_time_days) values
  ('8c800001-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001','8c100001-0000-0000-0000-000000000001','SAR',21);
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost) values
  ('8c800001-0000-0000-0000-000000000001','8c510001-0000-0000-0000-000000000001',2,100);
update public.boq_revisions set frozen_at = now(), frozen_by = '8c000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('8c500001-0000-0000-0000-000000000001','8c500002-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8c600001-0000-0000-0000-000000000001','8c200001-0000-0000-0000-000000000001','boq_frozen','8c500001-0000-0000-0000-000000000001'),
  ('8c600002-0000-0000-0000-000000000001','8c200002-0000-0000-0000-000000000001','boq_frozen','8c500002-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by) values
  ('8c700001-0000-0000-0000-000000000001','attachments','opportunity/8c1/a.pdf','pr-deal-secret-1 drawings.pdf','application/pdf',1000,repeat('a',64),'drawing','8c000000-0000-0000-0000-000000000001'),
  ('8c700002-0000-0000-0000-000000000001','attachments','opportunity/8c2/b.pdf','b.pdf','application/pdf',1000,repeat('b',64),'drawing','8c000000-0000-0000-0000-000000000001');
insert into public.document_links (document_id, entity_type, entity_id, linked_by) values
  ('8c700001-0000-0000-0000-000000000001','opportunity','8c200001-0000-0000-0000-000000000001','8c000000-0000-0000-0000-000000000001'),
  ('8c700002-0000-0000-0000-000000000001','opportunity','8c200002-0000-0000-0000-000000000001','8c000000-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name, owner, version, metadata) values
  ('attachments','opportunity/8c1/a.pdf','8c000000-0000-0000-0000-000000000001','v1','{"size": 1234}');
-- Storage reported no updated time for b: it must still download (nothing to compare is not a mismatch).
insert into storage.objects (bucket_id, name, owner, version, updated_at, metadata) values
  ('attachments','opportunity/8c2/b.pdf','8c000000-0000-0000-0000-000000000001','v1',null,'{"size": 99}');

-- The pricer sends file 1 to vendor A and file 2 to vendor B.
create temp table pr_inv (k text, id uuid);
grant all on pr_inv to authenticated, service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into pr_inv select 'a', (public.pricing_send_to_supplier('8c600001-0000-0000-0000-000000000001','8c100001-0000-0000-0000-000000000001',
  current_date + 7, array['8c700001-0000-0000-0000-000000000001']::uuid[], 'Two prices for the pylon, please.')->>'invitation_id')::uuid;
insert into pr_inv select 'b', (public.pricing_send_to_supplier('8c600002-0000-0000-0000-000000000001','8c100002-0000-0000-0000-000000000001',
  current_date + 7, array['8c700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id')::uuid;
select throws_ok($$select * from public.supplier_portal_invitations()$$, '42501', null, 'Staff do not use the portal functions');
-- What the supplier sessions below cannot read themselves.
reset role;
create temp table pr_ref (k text, v text);
grant all on pr_ref to authenticated, service_role;
insert into pr_ref
  select 'code', project_code from public.opportunities where id = '8c200001-0000-0000-0000-000000000001'
  union all select 'file_a', f.id::text from public.supplier_invitation_files f where f.document_id = '8c700001-0000-0000-0000-000000000001'
  union all select 'file_b', f.id::text from public.supplier_invitation_files f where f.document_id = '8c700002-0000-0000-0000-000000000001';
-- Each vendor's prices stay its own: vendor B has a current quote on vendor A's revision,
-- and vendor A one on vendor B's (fixtures written with the 7B guards off). Vendor B has
-- no quote of its own on its revision, so without the portal's vendor filter it would be
-- shown vendor A's (the test that fails then); vendor A's own quote is found first by
-- row order either way, so A's check states the rule but cannot catch the filter alone.
set local session_replication_role = replica;
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, lead_time_days) values
  ('8c800002-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001','8c100002-0000-0000-0000-000000000001','SAR',99),
  ('8c800003-0000-0000-0000-000000000001','8c500002-0000-0000-0000-000000000001','8c100001-0000-0000-0000-000000000001','SAR',88);
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost) values
  ('8c800002-0000-0000-0000-000000000001','8c510001-0000-0000-0000-000000000001',2,777),
  ('8c800003-0000-0000-0000-000000000001','8c510003-0000-0000-0000-000000000001',1,555);
set local session_replication_role = origin;
set local role authenticated;

select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select * from public.supplier_portal_invitations()$$, '42501', null, 'Without two-step verification a supplier reads nothing');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_portal_invitations()), 1, 'Supplier A lists its one request');
select is((select project_code || '/' || status || '/' || lines || '/' || open_lines from public.supplier_portal_invitations()),
  (select v from pr_ref where k = 'code') || '/open/2/2',
  'The list shows the project code, the status and the open lines');
select is((select count(*)::int from public.supplier_portal_invitations() where invitation_id = (select id from pr_inv where k = 'b')), 0,
  'Supplier A does not list vendor B''s request');

create temp table pr_doc (j jsonb);
grant all on pr_doc to authenticated;
insert into pr_doc select public.supplier_portal_invitation((select id from pr_inv where k = 'a'));
select is((select j->>'status' || '/' || (j->>'editable') from pr_doc), 'open/true', 'The request is open and takes prices');
select is((select jsonb_array_length(j->'lines') from pr_doc), 2, 'It carries both lines');
select is((select j->'lines'->0->>'sign_type' || '/' || (j->'lines'->0->>'quantity') || '/' || (j->'lines'->0->>'has_screen') from pr_doc),
  'Pylon P1/2.000/true', 'A line shows its sign type, quantity and screen');
select ok((select j->'lines'->0->>'unit_cost' is null from pr_doc),
  'A pre-freeze internal quote for the same vendor is not shown: own prices come only from this request''s submissions');
select ok((select j->'terms'->>'lead_time_days' is null from pr_doc), 'Nor its lead time');
select is((select count(*)::int from pr_doc, jsonb_array_elements(j->'lines') e
             where (e->>'unit_cost')::numeric = 777), 0,
  'Vendor B''s price on the same revision never reaches vendor A');
select ok((select not (j->'lines'->0 ? 'location') and not (j->'lines'->0 ? 'boq_line_id') from pr_doc),
  'A line carries no site and no internal BOQ id');
select is((select strpos(j::text, 'pr-deal-secret') + strpos(j::text, 'pr-site-secret') + strpos(j::text, '8c510001') + strpos(j::text, '8c200001') from pr_doc), 0,
  'No deal name, site, BOQ line id or deal id reaches the supplier');
select is((select j->'files'->0->>'name' from pr_doc),
  (select v from pr_ref where k = 'code') || '-01.pdf',
  'The file is listed under its neutral name');
select is((select j->>'instructions' from pr_doc), 'Two prices for the pylon, please.', 'The pricer''s note is shown');
reset role;
select is((select status || '/' || (opened_at is not null)::text from public.supplier_invitations where id = (select id from pr_inv where k = 'a')),
  'opened/true', 'Reading the request marks it opened');
select ok(exists (select 1 from public.audit_log where action = 'supplier_portal.opened'
  and actor_id = '8c000000-0000-0000-0000-000000000004' and after_value->>'invitation_id' = (select id from pr_inv where k = 'a')::text),
  'Marking it opened is audited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_invitation('%s')$$, (select id from pr_inv where k = 'b')),
  '42501', null, 'Supplier A cannot open vendor B''s request');
select throws_ok($$select public.supplier_portal_invitation('8c90000f-0000-0000-0000-000000000001')$$,
  '42501', null, 'An unknown request answers the same as another supplier''s');

select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select ((j->'lines'->0->>'unit_cost') is null and (j->'terms'->>'lead_time_days') is null)::text
             from (select public.supplier_portal_invitation((select id from pr_inv where k = 'b')) j) x), 'true',
  'Vendor B, with no prices of its own, never sees vendor A''s price or terms on its revision');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);

-- Files: only the version sent, only one's own. The supplier's check says which
-- file under its neutral name; where the bytes are is for the service only.
create temp table pr_file (j jsonb);
grant all on pr_file to authenticated, service_role;
insert into pr_file select public.supplier_portal_file((select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a'));
select is((select array_agg(k order by k) from pr_file, jsonb_object_keys(j) k),
  array['file_id','mime_type','name','ok','size_bytes'],
  'The supplier''s file check returns only ok, the file id, its neutral name, type and size');
select is((select (j->>'ok') || '/' || (j->>'name') || '/' || (j->>'file_id') from pr_file),
  'true/' || (select v from pr_ref where k = 'code') || '-01.pdf/' || (select v from pr_ref where k = 'file_a'),
  'Under the neutral name');
select is((select strpos(j::text, 'opportunity/') + strpos(j::text, 'attachments') + strpos(j::text, '8c700001')
                + strpos(j::text, 'pr-deal-secret') + strpos(j::text, 'drawings') from pr_file), 0,
  'No bucket, path, document id or original file name reaches the supplier');
select throws_ok(format($$select public._supplier_portal_file_location('%s', '%s', '8c000000-0000-0000-0000-000000000004')$$,
  (select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a')),
  '42501', null, 'A supplier cannot call the internal location function');
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_b')),
  '42501', null, 'Another request''s file is refused');
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'b'),
  (select v::uuid from pr_ref where k = 'file_b')),
  '42501', null, 'Another supplier''s file is refused');
select is((select count(*)::int from storage.objects), 0, 'The supplier has no storage access of its own');

-- The service (sales-os-api) asks where the bytes are, for the supplier user it checked.
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public._supplier_portal_file_location((select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a'),
  '8c000000-0000-0000-0000-000000000004'))->>'path', 'opportunity/8c1/a.pdf', 'The service gets the location once the checks pass');
select is((public._supplier_portal_file_location((select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a'),
  '8c000000-0000-0000-0000-000000000004'))->>'size_bytes', '1234', 'The size is the storage object''s, not the documents row''s (1000)');
select throws_ok(format($$select public._supplier_portal_file_location('%s', '%s', '8c000000-0000-0000-0000-000000000005')$$,
  (select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a')),
  '42501', null, 'Not for another supplier''s user');
select throws_ok(format($$select public._supplier_portal_file_location('%s', '%s', '8c000000-0000-0000-0000-000000000004')$$,
  (select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_b')),
  '42501', null, 'Nor for another request''s file');
select throws_ok(format($$select public._supplier_portal_file_location('%s', '%s', '8c000000-0000-0000-0000-000000000002')$$,
  (select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a')),
  '42501', null, 'Nor for a staff user');
select is((public._supplier_portal_file_location((select id from pr_inv where k = 'b'), (select v::uuid from pr_ref where k = 'file_b'),
  '8c000000-0000-0000-0000-000000000005'))->>'path', 'opportunity/8c2/b.pdf',
  'A file whose storage object had no updated time still downloads');
select ok((select s->>'version' = l->>'object_version' and s->>'updated_at' = l->>'object_updated_at'
             from (select public._supplier_portal_object_state((select v::uuid from pr_ref where k = 'file_a')) s,
                          public._supplier_portal_file_location((select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a'),
                                                                '8c000000-0000-0000-0000-000000000004') l) x),
  'The re-read after a download matches the version and time the location checked');
reset role;
select ok(not has_function_privilege('authenticated', 'public._supplier_portal_object_state(uuid)', 'execute')
          and not has_function_privilege('anon', 'public._supplier_portal_object_state(uuid)', 'execute'),
  'The object re-read is for the service only');
select ok(exists (select 1 from public.audit_log where action = 'supplier_portal.file_downloaded'
  and actor_id = '8c000000-0000-0000-0000-000000000004'), 'A download is audited');

-- Overwritten after it was sent: a new version alone, then a new updated time alone.
set local session_replication_role = replica;
update storage.objects set version = 'v2' where name = 'opportunity/8c1/a.pdf';
set local session_replication_role = origin;
select is((select o.updated_at from storage.objects o where o.name = 'opportunity/8c1/a.pdf'),
  (select f.object_updated_at from public.supplier_invitation_files f where f.id = (select v::uuid from pr_ref where k = 'file_a')),
  'Fixture: only the version changed');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  'P0001', null, 'A file with a new storage version is refused');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format($$select public._supplier_portal_file_location('%s', '%s', '8c000000-0000-0000-0000-000000000004')$$,
  (select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a')),
  'P0001', null, 'And the service gets no location for it');
select is(public._supplier_portal_object_state((select v::uuid from pr_ref where k = 'file_a'))->>'version', 'v2',
  'The re-read sees the replaced object, so bytes read after a swap are refused');
reset role;
set local session_replication_role = replica;
update storage.objects set version = 'v1', updated_at = updated_at + interval '1 second' where name = 'opportunity/8c1/a.pdf';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  'P0001', null, 'A file rewritten under the same version (a new updated time) is refused');
reset role;
set local session_replication_role = replica;
update storage.objects set updated_at = (select f.object_updated_at from public.supplier_invitation_files f
                                          where f.id = (select v::uuid from pr_ref where k = 'file_a'))
 where name = 'opportunity/8c1/a.pdf';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')), 'Back to the exact version sent, the file is available again');

-- Still at the supplier, but on a new revision: the old request's files are refused.
reset role;
set local session_replication_role = replica;
update public.pricing_files set boq_revision_id = '8c500003-0000-0000-0000-000000000001' where id = '8c600001-0000-0000-0000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  '42501', null, 'A file still at the supplier but on a new revision is refused');
reset role;
set local session_replication_role = replica;
update public.pricing_files set boq_revision_id = '8c500001-0000-0000-0000-000000000001' where id = '8c600001-0000-0000-0000-000000000001';
set local session_replication_role = origin;

-- A suspended supplier reads and downloads nothing, and the service gets nothing for it.
set local session_replication_role = replica;
update public.profiles set status = 'suspended' where id = '8c000000-0000-0000-0000-000000000004';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select * from public.supplier_portal_invitations()$$, '42501', null, 'A suspended supplier reads nothing');
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')), '42501', null, 'And checks no file');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format($$select public._supplier_portal_file_location('%s', '%s', '8c000000-0000-0000-0000-000000000004')$$,
  (select id from pr_inv where k = 'a'), (select v::uuid from pr_ref where k = 'file_a')),
  '42501', null, 'And the service gets no location for a suspended supplier');
reset role;
set local session_replication_role = replica;
update public.profiles set status = 'active' where id = '8c000000-0000-0000-0000-000000000004';
set local session_replication_role = origin;

update public.documents set deleted_at = now(), deleted_by = '8c000000-0000-0000-0000-000000000001' where id = '8c700001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  'P0001', null, 'A file deleted after it was sent is refused');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')),
  '42501', null, 'Staff do not download through the supplier path');

-- When the file leaves the supplier, or the request is cancelled.
reset role;
update public.pricing_files set state = 'supplier_priced' where id = '8c600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select status from public.supplier_portal_invitations()), 'closed', 'A request whose file moved on is closed');
select is((public.supplier_portal_invitation((select id from pr_inv where k = 'a')))->>'editable', 'false', 'And takes no prices');
select is((select open_lines from public.supplier_portal_invitations()), 0, 'A closed request has no open lines');
select is((select jsonb_array_length(j->'lines') + jsonb_array_length(j->'files')
             from (select public.supplier_portal_invitation((select id from pr_inv where k = 'a')) j) x), 0,
  'A closed request shows no lines, prices or files');
select throws_ok(format($$select public.supplier_portal_file('%s', '%s')$$, (select id from pr_inv where k = 'a'),
  (select v::uuid from pr_ref where k = 'file_a')), '42501', null, 'And no file downloads once the file left the supplier');
reset role;
set local session_replication_role = replica;
update public.supplier_invitations set status = 'reopened', return_message = 'pr-return-note'
 where id = (select id from pr_inv where k = 'a');
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((public.supplier_portal_invitation((select id from pr_inv where k = 'a')))->>'return_message', null,
  'A returned request whose file moved on shows no return message');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.pricing_cancel_invitation('%s', 'Sent by mistake')$$, (select id from pr_inv where k = 'b')),
  'The pricer cancels vendor B''s request');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_portal_invitations()), 0, 'A cancelled request disappears from the supplier''s list');
select throws_ok(format($$select public.supplier_portal_invitation('%s')$$, (select id from pr_inv where k = 'b')),
  '42501', null, 'And cannot be opened');

select * from finish();
rollback;
