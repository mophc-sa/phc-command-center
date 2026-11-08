-- PR 3 Task 2: a pricer sends the frozen file to one supplier; cancel; change the reply-by date.
-- Test user UUIDs use the 8b prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

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
  from generate_series(1,3) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'si-boq-' || n
  from generate_series(1,3) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8b50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,3) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, location) values
  ('8b510001-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'si-site-secret'),
  ('8b510002-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',2,'Wall W1',4,null),
  ('8b510003-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001',1,'Ceiling C1',1,null),
  ('8b510004-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001',1,'Stand S1',3,null);
-- Revision 3: vendor B priced and estimation selected a line before the freeze (Phase 7B).
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency) values
  ('8b800001-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001','8b100002-0000-0000-0000-000000000001','SAR');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost, is_selected, selected_by, selected_at) values
  ('8b800001-0000-0000-0000-000000000001','8b510004-0000-0000-0000-000000000001',3,100,true,'8b000000-0000-0000-0000-000000000002',now());
update public.boq_revisions set frozen_at = now(), frozen_by = '8b000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('8b500001-0000-0000-0000-000000000001','8b500002-0000-0000-0000-000000000001','8b500003-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8b600001-0000-0000-0000-000000000001','8b200001-0000-0000-0000-000000000001','boq_frozen','8b500001-0000-0000-0000-000000000001'),
  ('8b600002-0000-0000-0000-000000000001','8b200002-0000-0000-0000-000000000001','package_review','8b500002-0000-0000-0000-000000000001'),
  ('8b600003-0000-0000-0000-000000000001','8b200003-0000-0000-0000-000000000001','boq_frozen','8b500003-0000-0000-0000-000000000001');
-- Files: 1 on deal 1 (in storage), 2 on deal 2, 3 on deal 1 but missing from storage, 4 on deal 3.
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by) values
  ('8b700001-0000-0000-0000-000000000001','attachments','opportunity/8b1/plan.pdf','Client Mall drawings.PDF','application/pdf',1000,repeat('a',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700002-0000-0000-0000-000000000001','attachments','opportunity/8b2/plan.pdf','other.pdf','application/pdf',1000,repeat('b',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700003-0000-0000-0000-000000000001','attachments','opportunity/8b1/missing.pdf','missing.pdf','application/pdf',1000,repeat('c',64),'drawing','8b000000-0000-0000-0000-000000000001'),
  ('8b700004-0000-0000-0000-000000000001','attachments','opportunity/8b3/plan.dwg','plan.dwg','application/octet-stream',1000,repeat('d',64),'drawing','8b000000-0000-0000-0000-000000000001');
insert into public.document_links (document_id, entity_type, entity_id, linked_by) values
  ('8b700001-0000-0000-0000-000000000001','opportunity','8b200001-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700002-0000-0000-0000-000000000001','opportunity','8b200002-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700003-0000-0000-0000-000000000001','opportunity','8b200001-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001'),
  ('8b700004-0000-0000-0000-000000000001','opportunity','8b200003-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name, owner, version) values
  ('attachments','opportunity/8b1/plan.pdf','8b000000-0000-0000-0000-000000000001','v1'),
  ('attachments','opportunity/8b2/plan.pdf','8b000000-0000-0000-0000-000000000001','v1'),
  ('attachments','opportunity/8b3/plan.dwg','8b000000-0000-0000-0000-000000000001','v1');

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
select is((select status::text || '/' || cancel_reason from public.supplier_quotes where id = '8b800001-0000-0000-0000-000000000001'),
  'cancelled/Another supplier was chosen for this pricing file', 'The other supplier''s quote is cancelled for this file, with the reason');
select is((select count(*)::int from public.supplier_quote_lines where supplier_quote_id = '8b800001-0000-0000-0000-000000000001' and is_selected), 0,
  'The 7B selection is cleared, so the build does not refuse the file');
select is((select display_name from public.supplier_invitation_files f join public.supplier_invitations i on i.id = f.invitation_id
            where i.file_id = '8b600003-0000-0000-0000-000000000001'),
  (select project_code from public.opportunities where id = '8b200003-0000-0000-0000-000000000001') || '-01.dwg', 'The extension is kept, lower-cased');
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.sent_to_supplier'
  and after_value->>'file_id' = '8b600003-0000-0000-0000-000000000001' and (after_value->>'cancelled_quotes')::int = 1
  and (after_value->>'cleared_selections')::int = 1), 'Sending is audited with what it cancelled');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select unit_cost from public.pricing_selling_grid where file_id = '8b600003-0000-0000-0000-000000000001'), null::numeric,
  'The grid no longer sees the cancelled quote');

-- Who reads the requests.
select is((select count(*)::int from public.supplier_invitations), 2, 'The pricer reads the requests');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitation_lines), 3, 'The GM (a cost reader) reads them');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitations), 0, 'A rep does not see which supplier a file went to');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitation_files), 0, 'The BD manager does not either');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_invitations), 0, 'A supplier reads no request table directly (only through the portal)');
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

select * from finish();
rollback;
