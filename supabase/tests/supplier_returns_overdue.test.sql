-- PR 3 Task 5: returned lines reopen alone; the overdue reminder.
-- Test user UUIDs use the 8e prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8e000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'rt-rep'),(2,'rt-pricer'),(3,'rt-gm'),(4,'rt-supplier')) v(n, r);
update public.profiles set status = 'active' where id::text like '8e000000-%';
insert into public.user_roles (user_id, role) values
  ('8e000000-0000-0000-0000-000000000001','salesperson'),
  ('8e000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8e000000-0000-0000-0000-000000000002','finance_manager'),
  ('8e000000-0000-0000-0000-000000000003','general_manager');
insert into public.vendors (id, name) values ('8e100001-0000-0000-0000-000000000001','rt-vendor-a');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8e100001-0000-0000-0000-000000000001' where id = '8e000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values ('8e000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'rt-deal-' || n,
       '8e000000-0000-0000-0000-000000000001','8e000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,4) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8e40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'rt-boq-' || n
  from generate_series(1,4) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8e50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8e40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,4) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity) values
  ('8e510001-0000-0000-0000-000000000001','8e500001-0000-0000-0000-000000000001',1,'Pylon P1',2),
  ('8e510002-0000-0000-0000-000000000001','8e500001-0000-0000-0000-000000000001',2,'Wall W1',4),
  ('8e510003-0000-0000-0000-000000000001','8e500002-0000-0000-0000-000000000001',1,'Ceiling C1',1),
  ('8e510004-0000-0000-0000-000000000001','8e500003-0000-0000-0000-000000000001',1,'Stand S1',1),
  ('8e510005-0000-0000-0000-000000000001','8e500004-0000-0000-0000-000000000001',1,'Arch A1',3);
update public.boq_revisions set frozen_at = now(), frozen_by = '8e000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '8e50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8e600001-0000-0000-0000-000000000001','8e200001-0000-0000-0000-000000000001','boq_frozen','8e500001-0000-0000-0000-000000000001'),
  ('8e600002-0000-0000-0000-000000000001','8e200002-0000-0000-0000-000000000001','boq_frozen','8e500002-0000-0000-0000-000000000001'),
  ('8e600003-0000-0000-0000-000000000001','8e200003-0000-0000-0000-000000000001','supplier_priced','8e500003-0000-0000-0000-000000000001'),
  ('8e600004-0000-0000-0000-000000000001','8e200004-0000-0000-0000-000000000001','boq_frozen','8e500004-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by)
select ('8e70000' || n || '-0000-0000-0000-000000000001')::uuid, 'attachments', 'opportunity/8e' || n || '/a.pdf', 'a.pdf', 'application/pdf',
       1000, repeat('a',64), 'drawing', '8e000000-0000-0000-0000-000000000001'
  from generate_series(1,4) n;
insert into public.document_links (document_id, entity_type, entity_id, linked_by)
select ('8e70000' || n || '-0000-0000-0000-000000000001')::uuid, 'opportunity', ('8e20000' || n || '-0000-0000-0000-000000000001')::uuid,
       '8e000000-0000-0000-0000-000000000001'
  from generate_series(1,4) n;
insert into storage.objects (bucket_id, name, owner, version)
select 'attachments', 'opportunity/8e' || n || '/a.pdf', '8e000000-0000-0000-0000-000000000001', 'v1' from generate_series(1,4) n;

create temp table rt_ref (k text, v text);
grant all on rt_ref to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into rt_ref select 'inv', public.pricing_send_to_supplier('8e600001-0000-0000-0000-000000000001','8e100001-0000-0000-0000-000000000001',
  current_date + 7, array['8e700001-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
insert into rt_ref select 'inv2', public.pricing_send_to_supplier('8e600002-0000-0000-0000-000000000001','8e100001-0000-0000-0000-000000000001',
  current_date + 7, array['8e700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
reset role;
insert into rt_ref select 'l1', id::text from public.supplier_invitation_lines
 where invitation_id = (select v::uuid from rt_ref where k = 'inv') and boq_line_id = '8e510001-0000-0000-0000-000000000001';
insert into rt_ref select 'l2', id::text from public.supplier_invitation_lines
 where invitation_id = (select v::uuid from rt_ref where k = 'inv') and boq_line_id = '8e510002-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select public.supplier_portal_submit((select v::uuid from rt_ref where k = 'inv'),
  jsonb_build_array(jsonb_build_object('line_id', (select v from rt_ref where k = 'l1'), 'unit_cost', 1000),
                    jsonb_build_object('line_id', (select v from rt_ref where k = 'l2'), 'unit_cost', 200, 'spec_difference', 'Acrylic')),
  '{"lead_time_days":30,"payment_terms":"Net 30","valid_until":"2099-12-31"}', 'en');

-- Returning lines.
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, '42501', null, 'A rep cannot send lines back');
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date + 3, '  ')$$, '23514', null, 'Sending lines back needs a reason');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date - 1, 'Missing screen price')$$, '23514', null, 'A reply-by date in the past is refused');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510003-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, '23514', null, 'A line outside the request is refused');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array[]::uuid[], current_date + 3, 'Missing screen price')$$, '23514', null, 'At least one line goes back');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600003-0000-0000-0000-000000000001',
  array['8e510004-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, 'P0001', null,
  'A file priced without a portal request is sent back with a plain note instead');
select throws_ok($$select public.pricing_return_lines_to_supplier('8e600002-0000-0000-0000-000000000001',
  array['8e510003-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Missing screen price')$$, 'P0001', null,
  'Lines go back only from cost review or price review');
select is((public.pricing_return_lines_to_supplier('8e600001-0000-0000-0000-000000000001',
  array['8e510001-0000-0000-0000-000000000001']::uuid[], current_date + 3, 'Line 1 has no screen price; margin too thin without it',
  'Please add the price with the screen for the pylon.'))->>'lines', '1', 'Zayed sends one line back');
reset role;
select is((select state::text from public.pricing_files where id = '8e600001-0000-0000-0000-000000000001'), 'at_supplier', 'The file is back at the supplier');
select is((select status || '/' || reply_by::text || '/' || return_message from public.supplier_invitations where id = (select v::uuid from rt_ref where k = 'inv')),
  'reopened/' || (current_date + 3)::text || '/Please add the price with the screen for the pylon.', 'The request reopens with a new date and the message');
select is((select string_agg(state, ',' order by boq_line_id) from public.supplier_invitation_lines where invitation_id = (select v::uuid from rt_ref where k = 'inv')),
  'reopened,submitted', 'Only the returned line reopens');
select is((select cost_note from public.pricing_file_events where file_id = '8e600001-0000-0000-0000-000000000001' and from_state = 'supplier_priced'),
  'Line 1 has no screen price; margin too thin without it', 'The internal reason is a cost note');
select is((select note from public.pricing_file_events where file_id = '8e600001-0000-0000-0000-000000000001' and from_state = 'supplier_priced'),
  null, 'The deal''s readable history does not carry it');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
create temp table rt_doc (j jsonb);
grant all on rt_doc to authenticated;
insert into rt_doc select public.supplier_portal_invitation((select v::uuid from rt_ref where k = 'inv'));
select is((select j->>'status' || '/' || (j->>'return_message') from rt_doc), 'returned/Please add the price with the screen for the pylon.',
  'The supplier sees the request returned, with PHC''s message');
select is((select string_agg(l->>'editable', ',' order by (l->>'line_number')::int) from rt_doc, jsonb_array_elements(j->'lines') l), 'true,false',
  'Only the returned line takes a price');
select is((select (j->'lines'->1->>'unit_cost')::numeric from rt_doc), 200.00::numeric, 'The locked line shows its submitted price');
select is((select open_lines from public.supplier_portal_invitations() where invitation_id = (select v::uuid from rt_ref where k = 'inv')), 1,
  'The list counts one open line');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":1100},{"line_id":"%s","unit_cost":1}]',
  '{"lead_time_days":30,"payment_terms":"Net 30","valid_until":"2099-12-31"}', 'en')$$,
  (select v from rt_ref where k = 'inv'), (select v from rt_ref where k = 'l1'), (select v from rt_ref where k = 'l2')),
  '23514', null, 'A locked line cannot be re-priced');
select is((public.supplier_portal_submit((select v::uuid from rt_ref where k = 'inv'),
  jsonb_build_array(jsonb_build_object('line_id', (select v from rt_ref where k = 'l1'), 'unit_cost', 1000, 'unit_cost_with_screen', 1400)),
  '{"lead_time_days":30,"payment_terms":"Net 30","valid_until":"2099-12-31"}', 'en'))->>'lines', '1', 'The supplier re-prices the returned line only');
reset role;
select is((select string_agg(coalesce(l.unit_cost_with_screen::text, '-') || ':' || l.unit_cost::text || ':' || coalesce(l.alternate_spec, '-'), ',' order by l.boq_line_id)
             from public.supplier_quote_lines l join public.supplier_quotes q on q.id = l.supplier_quote_id
            where q.boq_revision_id = '8e500001-0000-0000-0000-000000000001' and q.is_current),
  '1400.00:1000.00:-,-:200.00:Acrylic', 'The new revision carries the locked line''s price and note unchanged');
select is((select count(*)::int from public.supplier_quotes where boq_revision_id = '8e500001-0000-0000-0000-000000000001'), 2,
  'Each submission is its own quote revision');
select is((select state::text from public.pricing_files where id = '8e600001-0000-0000-0000-000000000001'), 'supplier_priced', 'The file goes back to the GM');

-- The overdue reminder.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_notify_overdue_suppliers()$$, '42501', null, 'Clients cannot run the reminder');
reset role;
select set_config('request.jwt.claims','',true);
update public.supplier_invitations set reply_by = current_date - 2 where id = (select v::uuid from rt_ref where k = 'inv2');
select is(public.pricing_notify_overdue_suppliers(), 1, 'One overdue request: Zayed is told once');
select is(public.pricing_notify_overdue_suppliers(), 0, 'Running again tells nobody twice');
select is((select metadata->>'pricing_file_id' || '/' || title from public.notifications where notification_type = 'pricing_supplier_overdue'
             and recipient_user_id = '8e000000-0000-0000-0000-000000000002'),
  '8e600002-0000-0000-0000-000000000001/' || (select project_code from public.opportunities where id = '8e200002-0000-0000-0000-000000000001'),
  'The reminder opens the pricing file and names the project code');
select is((select count(*)::int from public.notifications where notification_type = 'pricing_supplier_overdue'
             and recipient_user_id in ('8e000000-0000-0000-0000-000000000001','8e000000-0000-0000-0000-000000000003')), 0,
  'The rep and the GM are not reminded');

-- Returning lines from price review also returns the GM's price (PR 1's move).
select set_config('request.jwt.claims','',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into rt_ref select 'inv4', public.pricing_send_to_supplier('8e600004-0000-0000-0000-000000000001','8e100001-0000-0000-0000-000000000001',
  current_date + 7, array['8e700004-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
reset role;
insert into rt_ref select 'l4', id::text from public.supplier_invitation_lines where invitation_id = (select v::uuid from rt_ref where k = 'inv4');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select public.supplier_portal_submit((select v::uuid from rt_ref where k = 'inv4'),
  jsonb_build_array(jsonb_build_object('line_id', (select v from rt_ref where k = 'l4'), 'unit_cost', 500)),
  '{"lead_time_days":30,"payment_terms":"Net 30","valid_until":"2099-12-31"}', 'en');
reset role;
insert into public.estimations (id, boq_revision_id, cost_total) values ('8e900001-0000-0000-0000-000000000001','8e500004-0000-0000-0000-000000000001', 1500);
insert into public.internal_prices (id, estimation_id, proposed_price, status, proposed_by)
values ('8e910001-0000-0000-0000-000000000001','8e900001-0000-0000-0000-000000000001', 2500, 'gm_pending','8e000000-0000-0000-0000-000000000003');
set local session_replication_role = replica;
update public.pricing_files set state = 'price_review', estimation_id = '8e900001-0000-0000-0000-000000000001',
       internal_price_id = '8e910001-0000-0000-0000-000000000001' where id = '8e600004-0000-0000-0000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_return_lines_to_supplier('8e600004-0000-0000-0000-000000000001',
  array['8e510005-0000-0000-0000-000000000001']::uuid[], current_date + 5, 'Margin too thin; ask for a better price'))->>'lines', '1',
  'Lines go back from price review too');
reset role;
select is((select state::text from public.pricing_files where id = '8e600004-0000-0000-0000-000000000001'), 'at_supplier', 'That file is at the supplier');
select is((select status::text from public.internal_prices where id = '8e910001-0000-0000-0000-000000000001'), 'returned', 'The GM''s price comes back with it');
select is((select return_message from public.supplier_invitations where id = (select v::uuid from rt_ref where k = 'inv4')), null,
  'No message was given, so the supplier is shown none');
select is((select count(*)::int from public.notifications where recipient_user_id = '8e000000-0000-0000-0000-000000000004'), 0,
  'The supplier account gets no notification row');

select * from finish();
rollback;
