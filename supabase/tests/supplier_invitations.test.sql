-- PR 3 Task 2: a pricer sends the frozen file to one supplier; cancel; change the reply-by date.
-- Test user UUIDs use the 8b prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8b000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'si-rep'),(2,'si-pricer'),(3,'si-gm'),(4,'si-supplier'),(5,'si-bd')) v(n, r);
update public.profiles set status = 'active' where id::text like '8b000000-%';
insert into public.user_roles (user_id, role) values
  ('8b000000-0000-0000-0000-000000000001','salesperson'),
  ('8b000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8b000000-0000-0000-0000-000000000002','finance_manager'),
  ('8b000000-0000-0000-0000-000000000003','general_manager'),
  ('8b000000-0000-0000-0000-000000000005','bd_manager');
insert into public.vendors (id, name) values
  ('8b100001-0000-0000-0000-000000000001','si-vendor-a'),
  ('8b100002-0000-0000-0000-000000000001','si-vendor-b');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8b100001-0000-0000-0000-000000000001' where id = '8b000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values ('8b000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'si-deal-' || n,
       '8b000000-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,5) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'si-boq-' || n
  from generate_series(1,5) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8b50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,5) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, location) values
  ('8b510001-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'si-site-secret'),
  ('8b510002-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',2,'Wall W1',4,null),
  ('8b510003-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001',1,'Ceiling C1',1,null),
  ('8b510004-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001',1,'Stand S1',3,null),
  ('8b510005-0000-0000-0000-000000000001','8b500004-0000-0000-0000-000000000001',1,'Arch A1',1,null),
  ('8b510006-0000-0000-0000-000000000001','8b500005-0000-0000-0000-000000000001',1,'Gate G1',1,null);
-- Phase 7B prices before the freeze.
--   Revision 3 (file 3): vendor B priced and a line is selected; the CHOSEN vendor A also has a quote (it must survive).
--   Revision 2 (not sent): vendor B priced and a line is selected (another revision: it must stay untouched).
--   Revision 4 (file 4): vendor B selected a line AND a second estimation uses this revision (the send is refused).
--   Revision 5 (file 5): vendor B selected a line and the file's own estimation is the only one (the send goes).
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency) values
  ('8b800001-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001','SAR'),
  ('8b800003-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001','SAR'),
  ('8b800002-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001','SAR'),
  ('8b800004-0000-0000-0000-000000000001','8b500004-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001','SAR'),
  ('8b800005-0000-0000-0000-000000000001','8b500005-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001','SAR');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost, is_selected, selected_by, selected_at) values
  ('8b800001-0000-0000-0000-000000000001','8b510004-0000-0000-0000-000000000001',3,100,true,'8b000000-0000-0000-0000-000000000002',now()),
  ('8b800003-0000-0000-0000-000000000001','8b510004-0000-0000-0000-000000000001',3,90,false,null,null),
  ('8b800002-0000-0000-0000-000000000001','8b510003-0000-0000-0000-000000000001',1,100,true,'8b000000-0000-0000-0000-000000000002',now()),
  ('8b800004-0000-0000-0000-000000000001','8b510005-0000-0000-0000-000000000001',1,100,true,'8b000000-0000-0000-0000-000000000002',now()),
  ('8b800005-0000-0000-0000-000000000001','8b510006-0000-0000-0000-000000000001',1,100,true,'8b000000-0000-0000-0000-000000000002',now());
insert into public.estimations (id, boq_revision_id) values
  ('8b900001-0000-0000-0000-000000000001','8b500004-0000-0000-0000-000000000001'),
  ('8b900002-0000-0000-0000-000000000001','8b500005-0000-0000-0000-000000000001');
update public.boq_revisions set frozen_at = now(), frozen_by = '8b000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('8b500001-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001',
              '8b500004-0000-0000-0000-000000000001','8b500005-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8b600001-0000-0000-0000-000000000001','8b200001-0000-0000-0000-000000000001','boq_frozen','8b500001-0000-0000-0000-000000000001'),
  ('8b600002-0000-0000-0000-000000000001','8b200002-0000-0000-0000-000000000001','package_review','8b500002-0000-0000-0000-000000000001'),
  ('8b600003-0000-0000-0000-000000000001','8b200003-0000-0000-0000-000000000001','boq_frozen','8b500003-0000-0000-0000-000000000001'),
  ('8b600004-0000-0000-0000-000000000001','8b200004-0000-0000-0000-000000000001','boq_frozen','8b500004-0000-0000-0000-000000000001'),
  ('8b600005-0000-0000-0000-000000000001','8b200005-0000-0000-0000-000000000001','boq_frozen','8b500005-0000-0000-0000-000000000001');
update public.pricing_files set estimation_id = '8b900002-0000-0000-0000-000000000001' where id = '8b600005-0000-0000-0000-000000000001';
-- Files: 1 on deal 1 (in storage), 2 on deal 2, 3 on deal 1 but missing from storage, 4 on deal 3.
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by) values
  ('8b700001-0000-0000-0000-000000000001','attachments','opportunity/8b1/plan.pdf','Client Mall drawings.PDF','application/pdf',1000,repeat('a',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700002-0000-0000-0000-000000000001','attachments','opportunity/8b2/plan.pdf','other.pdf','application/pdf',1000,repeat('b',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700003-0000-0000-0000-000000000001','attachments','opportunity/8b1/missing.pdf','missing.pdf','application/pdf',1000,repeat('c',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700004-0000-0000-0000-000000000001','attachments','opportunity/8b3/plan.dwg','plan.dwg','application/octet-stream',1000,repeat('d',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700005-0000-0000-0000-000000000001','attachments','opportunity/8b4/plan.pdf','four.pdf','application/pdf',1000,repeat('e',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700006-0000-0000-0000-000000000001','attachments','opportunity/8b5/plan.pdf','five.pdf','application/pdf',1000,repeat('f',64),'drawing','8b000000-0000-0000-0000-000000000001');
insert into public.document_links (document_id, entity_type, entity_id, linked_by) values
  ('8b700001-0000-0000-0000-000000000001','opportunity','8b200001-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700002-0000-0000-0000-000000000001','opportunity','8b200002-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700003-0000-0000-0000-000000000001','opportunity','8b200001-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700004-0000-0000-0000-000000000001','opportunity','8b200003-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700005-0000-0000-0000-000000000001','opportunity','8b200004-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700006-0000-0000-0000-000000000001','opportunity','8b200005-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001');
-- The first file's storage object reports its own ETag, different from the documents row's checksum.
insert into storage.objects (bucket_id, name, owner, version, metadata) values
  ('attachments','opportunity/8b1/plan.pdf','8b000000-0000-0000-0000-000000000001','v1','{"eTag":"\"etag-of-the-bytes-sent\""}'),
  ('attachments','opportunity/8b2/plan.pdf','8b000000-0000-0000-0000-000000000001','v1',null),
  ('attachments','opportunity/8b3/plan.dwg','8b000000-0000-0000-0000-000000000001','v1',null),
  ('attachments','opportunity/8b4/plan.pdf','8b000000-0000-0000-0000-000000000001','v1',null),
  ('attachments','opportunity/8b5/plan.pdf','8b000000-0000-0000-0000-000000000001','v1',null);
-- Riyadh's date, read once as the owner (the helper is internal).
create temp table si_today (d date);
insert into si_today select public._pricing_today();
grant select on si_today to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '42501', null, 'A rep cannot send a file to the supplier');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '42501', null, 'A supplier cannot send a file');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date - 2, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'A reply-by date in the past is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array[]::uuid[])$$, '23514', null, 'A request with no files is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700002-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'Another deal''s file is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700003-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'A file missing from storage is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600002-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700002-0000-0000-0000-000000000001']::uuid[])$$, 'P0001', null, 'A file still in package review cannot be sent');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b10000f-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, '23514', null, 'An unknown supplier is refused');

create temp table si_sent (r jsonb);
grant all on si_sent to authenticated;
insert into si_sent select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[], 'Please give a price with and without the screen.');
select is((select (r->>'lines') || '/' || (r->>'files') from si_sent), '2/1', 'Sending covers the BOQ''s two lines and one file');
select is((select state::text from public.pricing_files where id = '8b600001-0000-0000-0000-000000000001'), 'at_supplier', 'The file is now at the supplier');
select is((select status || '/' || project_code from public.supplier_invitations where id = (select (r->>'invitation_id')::uuid from si_sent)),
  'sent/' || (select project_code from public.opportunities where id = '8b200001-0000-0000-0000-000000000001'),
  'The request is sent under the deal''s project code');
select is((select count(*)::int from public.supplier_invitation_lines where invitation_id = (select (r->>'invitation_id')::uuid from si_sent) and state = 'open'), 2,
  'Both lines are open for pricing');
select is((select display_name from public.supplier_invitation_files where invitation_id = (select (r->>'invitation_id')::uuid from si_sent)),
  (select project_code from public.opportunities where id = '8b200001-0000-0000-0000-000000000001') || '-01.pdf',
  'The file is renamed to the project code: the client''s file name never reaches the supplier');
select is((select object_version from public.supplier_invitation_files where invitation_id = (select (r->>'invitation_id')::uuid from si_sent)), 'v1',
  'The exact storage version sent is kept');
select is((select checksum from public.supplier_invitation_files where invitation_id = (select (r->>'invitation_id')::uuid from si_sent)), 'etag-of-the-bytes-sent',
  'The checksum is the storage object''s own hash, not the documents row''s');
select is((select count(*)::int from public.pricing_file_events where file_id = '8b600001-0000-0000-0000-000000000001'
             and to_state = 'at_supplier' and actor_id = '8b000000-0000-0000-0000-000000000002'), 1, 'The move is in the file''s history, by the pricer');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, 'P0001', null, 'A second open request on the same file is refused');

-- The second supplier's quote from before the freeze (AI_HANDOFF PR 3 contract).
select throws_ok($$select public.pricing_send_to_supplier('8b600003-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700004-0000-0000-0000-000000000001']::uuid[])$$, 'P0001', null,
  'Another supplier''s earlier quote needs the pricer''s confirmation');
select is((select state::text from public.pricing_files where id = '8b600003-0000-0000-0000-000000000001'), 'boq_frozen', 'A refused send leaves the file where it was');
select lives_ok($$select public.pricing_send_to_supplier('8b600003-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700004-0000-0000-0000-000000000001']::uuid[], null, true)$$, 'With the confirmation the file goes to the chosen supplier');
reset role;
-- The supplier fixture's own vendor (A) is the one invited, twice: still it reads nothing directly.
create temp table si_a (n int);
insert into si_a select count(*)::int from public.supplier_invitations where vendor_id = '8b100001-0000-0000-0000-000000000001' and status = 'sent';
grant select on si_a to authenticated;
select is((select status::text || '/' || cancel_reason from public.supplier_quotes where id = '8b800001-0000-0000-0000-000000000001'),
  'cancelled/Another supplier was chosen for this pricing file', 'The other supplier''s quote is cancelled for this file, with the reason');
select is((select count(*)::int from public.supplier_quote_lines where supplier_quote_id = '8b800001-0000-0000-0000-000000000001' and is_selected), 0,
  'The 7B selection is cleared, so the build does not refuse the file');
select is((select display_name from public.supplier_invitation_files f join public.supplier_invitations i on i.id = f.invitation_id
            where i.file_id = '8b600003-0000-0000-0000-000000000001'),
  (select project_code from public.opportunities where id = '8b200003-0000-0000-0000-000000000001') || '-01.dwg', 'The extension is kept, lower-cased');
select is((select status::text || '/' || (select count(*) from public.supplier_quote_lines where supplier_quote_id = '8b800003-0000-0000-0000-000000000001' and unit_cost = 90)
             from public.supplier_quotes where id = '8b800003-0000-0000-0000-000000000001'), 'frozen/1',
  'The chosen supplier''s own quote on this revision is not cancelled');
select is((select status::text || '/' || (select count(*) from public.supplier_quote_lines where supplier_quote_id = '8b800002-0000-0000-0000-000000000001' and is_selected)
             from public.supplier_quotes where id = '8b800002-0000-0000-0000-000000000001'), 'frozen/1',
  'Another revision''s quote from the same other supplier keeps its status and its selection');
select is(coalesce(current_setting('phc.pricing_supplier_entry', true), ''), '', 'The 7B entry flag is closed again after the send');
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.sent_to_supplier'
  and after_value->>'file_id' = '8b600003-0000-0000-0000-000000000001' and (after_value->>'cancelled_quotes')::int = 1
  and (after_value->>'cleared_selections')::int = 1
  and after_value->'cancelled_quote_ids' = '["8b800001-0000-0000-0000-000000000001"]'::jsonb), 'Sending is audited with the ids of the quotes it cancelled');
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.sent_to_supplier'
  and after_value->>'file_id' = '8b600003-0000-0000-0000-000000000001'
  and after_value->'cleared_line_ids' = (select jsonb_agg(l.id) from public.supplier_quote_lines l
                                          where l.supplier_quote_id = '8b800001-0000-0000-0000-000000000001' and l.boq_line_id = '8b510004-0000-0000-0000-000000000001')),
  'and with the ids of the selections it cleared');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select unit_cost from public.pricing_selling_grid where file_id = '8b600003-0000-0000-0000-000000000001'), 90::numeric,
  'The grid sees the chosen supplier''s price only, not the cancelled quote''s');

-- Who reads the requests.
select is((select count(*)::int from public.supplier_invitations), 2, 'The pricer reads the requests');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitation_lines), 3, 'The GM (a cost reader) reads them');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitations), 0, 'A rep does not see which supplier a file went to');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitation_files), 0, 'The BD manager does not either');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select n from si_a), 2, 'The supplier''s own vendor has two open requests');
select is((select (select count(*) from public.supplier_invitations) || '/' || (select count(*) from public.supplier_invitation_lines)
                 || '/' || (select count(*) from public.supplier_invitation_files)), '0/0/0',
  'A supplier linked to the invited vendor still reads no request table directly (only through the portal)');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$insert into public.supplier_invitations (file_id, boq_revision_id, vendor_id, project_code, reply_by)
  values ('8b600002-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001','X',current_date)$$,
  '42501', null, 'Requests are written through the RPCs only');

-- A new reply-by date; cancel; send again.
select throws_ok(format($$select public.pricing_extend_invitation('%s', current_date - 1)$$, (select r->>'invitation_id' from si_sent)),
  '23514', null, 'A new reply-by date in the past is refused');
select is((public.pricing_extend_invitation((select (r->>'invitation_id')::uuid from si_sent), current_date + 14))->>'reply_by',
  (current_date + 14)::text, 'The pricer gives the supplier more time');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.pricing_cancel_invitation('%s', 'no')$$, (select r->>'invitation_id' from si_sent)),
  '42501', null, 'A rep cannot cancel a request');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.pricing_cancel_invitation('%s', '  ')$$, (select r->>'invitation_id' from si_sent)),
  '23514', null, 'Cancelling needs a reason');
select is((public.pricing_cancel_invitation((select (r->>'invitation_id')::uuid from si_sent), 'Wrong supplier'))->>'status', 'cancelled',
  'The pricer cancels the request');
select throws_ok(format($$select public.pricing_cancel_invitation('%s', 'again')$$, (select r->>'invitation_id' from si_sent)),
  'P0001', null, 'A cancelled request cannot be cancelled again');
select is((select state::text from public.pricing_files where id = '8b600001-0000-0000-0000-000000000001'), 'at_supplier',
  'Cancelling leaves the file at the supplier');
select lives_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, 'A file at the supplier with no open request can be sent again');
reset role;
select is((select count(*)::int from public.audit_log where action in ('pricing_file.supplier_request_cancelled','pricing_file.supplier_reply_by_changed')
            and after_value->>'file_id' = '8b600001-0000-0000-0000-000000000001'), 2, 'Cancelling and changing the date are audited');

-- The reply-by date is Riyadh's day; its limits; the note's limit; MFA.
reset role;
select is((select d from si_today), (now() at time zone 'Asia/Riyadh')::date, 'The helper reads the date in Riyadh');
select ok(pg_get_functiondef('public._pricing_today()'::regprocedure) like '%Asia/Riyadh%', 'and is written against Asia/Riyadh, not the server''s zone');
select ok(not has_function_privilege('authenticated', 'public._pricing_today()', 'execute') and not has_function_privilege('anon', 'public._pricing_today()', 'execute'),
  'The helper is internal: no one signed in can call it');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  '%s'::date, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, (select d + 181 from si_today)),
  '23514', null, 'A reply-by date more than 180 days away is refused');
select throws_ok(format($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  '%s'::date, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$, (select d - 1 from si_today)),
  '23514', null, 'Yesterday in Riyadh is refused');
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[], repeat('x', 1001))$$,
  '23514', null, 'A note over 1000 characters is refused');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.pricing_send_to_supplier('8b600001-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001',
  current_date + 7, array['8b700001-0000-0000-0000-000000000001']::uuid[])$$,
  '42501', null, 'A pricer (finance role) signed in without MFA cannot send');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);

-- Clearing selections must not move another estimation's cost.
create temp table si_err (code text, detail text);
grant all on si_err to authenticated;
do $$ begin
  perform public.pricing_send_to_supplier('8b600004-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
    current_date + 7, array['8b700005-0000-0000-0000-000000000001']::uuid[], null, true);
exception when others then
  declare d text; begin get stacked diagnostics d = pg_exception_detail; insert into si_err values (sqlstate, d); end;
end $$;
select is((select code from si_err), 'P0001', 'A send that would clear selections another estimation uses is refused, confirmation or not');
select ok((select detail from si_err) like '%8b900001-0000-0000-0000-000000000001%', 'and the error lists that estimation for the confirmation dialog');
reset role;
select is((select state::text from public.pricing_files where id = '8b600004-0000-0000-0000-000000000001') || '/'
          || (select count(*) from public.supplier_quote_lines where supplier_quote_id = '8b800004-0000-0000-0000-000000000001' and is_selected) || '/'
          || (select status::text from public.supplier_quotes where id = '8b800004-0000-0000-0000-000000000001'),
  'boq_frozen/1/frozen', 'The refused send changed nothing: file, selection and quote as they were');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_send_to_supplier('8b600005-0000-0000-0000-000000000001','8b100001-0000-0000-0000-000000000001',
  current_date + 7, array['8b700006-0000-0000-0000-000000000001']::uuid[], null, true)$$,
  'The file''s own estimation does not block the send');
reset role;
select is((select status::text || '/' || (select count(*) from public.supplier_quote_lines where supplier_quote_id = '8b800005-0000-0000-0000-000000000001' and is_selected)
             from public.supplier_quotes where id = '8b800005-0000-0000-0000-000000000001'), 'cancelled/0', 'and its other-supplier quote is cancelled, its selection cleared');

-- A request of a file that moved on or closed can no longer be changed.
create temp table si_five (id uuid);
insert into si_five select id from public.supplier_invitations where file_id = '8b600005-0000-0000-0000-000000000001' and status = 'sent';
grant select on si_five to authenticated;
set local session_replication_role = replica;
update public.pricing_files set state = 'closed', closed_reason = 'lost' where id = '8b600005-0000-0000-0000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.pricing_extend_invitation('%s', current_date + 3)$$, (select id from si_five)),
  'P0001', null, 'The reply-by date of a closed file''s request cannot be changed');
select throws_ok(format($$select public.pricing_cancel_invitation('%s', 'tidy up')$$, (select id from si_five)),
  'P0001', null, 'A closed file''s request cannot be cancelled either');
select is(((select status from public.supplier_invitations where id = (select id from si_five))), 'sent', 'It stays as it was (task 3 hides it from the supplier)');
-- The date limits of an extension.
select lives_ok(format($$select public.pricing_extend_invitation('%s', '%s'::date)$$, (select id from public.supplier_invitations where file_id = '8b600001-0000-0000-0000-000000000001' and status = 'sent'), (select d from si_today)),
  'Today in Riyadh is a valid new reply-by date');
select lives_ok(format($$select public.pricing_extend_invitation('%s', '%s'::date)$$, (select id from public.supplier_invitations where file_id = '8b600001-0000-0000-0000-000000000001' and status = 'sent'), (select d + 180 from si_today)),
  'and so is 180 days out');
select throws_ok(format($$select public.pricing_extend_invitation('%s', '%s'::date)$$, (select id from public.supplier_invitations where file_id = '8b600001-0000-0000-0000-000000000001' and status = 'sent'), (select d + 181 from si_today)),
  '23514', null, 'but 181 days is not');

select * from finish();
rollback;
