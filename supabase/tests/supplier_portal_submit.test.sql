-- PR 3 Task 4: the supplier submits, the quote locks, entry on behalf follows the request.
-- Test user UUIDs use the 8d prefix. Sessions carry aal2 unless they say otherwise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8d000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'ps-rep'),(2,'ps-pricer'),(3,'ps-gm'),(4,'ps-supplier-a'),(5,'ps-supplier-b')) v(n, r);
update public.profiles set status = 'active' where id::text like '8d000000-%';
insert into public.user_roles (user_id, role) values
  ('8d000000-0000-0000-0000-000000000001','salesperson'),
  ('8d000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8d000000-0000-0000-0000-000000000002','finance_manager'),
  ('8d000000-0000-0000-0000-000000000003','general_manager');
insert into public.vendors (id, name) values
  ('8d100001-0000-0000-0000-000000000001','ps-vendor-a'),
  ('8d100002-0000-0000-0000-000000000001','ps-vendor-b');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8d100001-0000-0000-0000-000000000001' where id = '8d000000-0000-0000-0000-000000000004';
update public.profiles set vendor_id = '8d100002-0000-0000-0000-000000000001' where id = '8d000000-0000-0000-0000-000000000005';
insert into public.user_roles (user_id, role) values
  ('8d000000-0000-0000-0000-000000000004','supplier'), ('8d000000-0000-0000-0000-000000000005','supplier');
set local session_replication_role = origin;
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'ps-deal-' || n,
       '8d000000-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8d40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'ps-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8d50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8d40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, has_screen) values
  ('8d510001-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',1,'Pylon P1',2,true),
  ('8d510002-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',2,'Wall W1',4,false),
  ('8d510003-0000-0000-0000-000000000001','8d500002-0000-0000-0000-000000000001',1,'Ceiling C1',1,false);
-- Vendor A's quote from before the freeze (it will be superseded by the portal submission).
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency) values
  ('8d800001-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001','SAR');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost) values
  ('8d800001-0000-0000-0000-000000000001','8d510002-0000-0000-0000-000000000001',4,50);
update public.boq_revisions set frozen_at = now(), frozen_by = '8d000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('8d500001-0000-0000-0000-000000000001','8d500002-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8d600001-0000-0000-0000-000000000001','8d200001-0000-0000-0000-000000000001','boq_frozen','8d500001-0000-0000-0000-000000000001'),
  ('8d600002-0000-0000-0000-000000000001','8d200002-0000-0000-0000-000000000001','boq_frozen','8d500002-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by) values
  ('8d700001-0000-0000-0000-000000000001','attachments','opportunity/8d1/a.pdf','a.pdf','application/pdf',1000,repeat('a',64),'drawing','8d000000-0000-0000-0000-000000000001'),
  ('8d700002-0000-0000-0000-000000000001','attachments','opportunity/8d2/b.pdf','b.pdf','application/pdf',1000,repeat('b',64),'drawing','8d000000-0000-0000-0000-000000000001'),
  ('8d700003-0000-0000-0000-000000000001','attachments','opportunity/8d2/quote.xlsx','supplier quote.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1000,repeat('c',64),'quotation','8d000000-0000-0000-0000-000000000002');
insert into public.document_links (document_id, entity_type, entity_id, linked_by) values
  ('8d700001-0000-0000-0000-000000000001','opportunity','8d200001-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000001'),
  ('8d700002-0000-0000-0000-000000000001','opportunity','8d200002-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000001'),
  ('8d700003-0000-0000-0000-000000000001','opportunity','8d200002-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000002');
insert into storage.objects (bucket_id, name, owner, version) values
  ('attachments','opportunity/8d1/a.pdf','8d000000-0000-0000-0000-000000000001','v1'),
  ('attachments','opportunity/8d2/b.pdf','8d000000-0000-0000-0000-000000000001','v1');

create temp table ps_ref (k text, v text);
grant all on ps_ref to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into ps_ref select 'inv_a', public.pricing_send_to_supplier('8d600001-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  current_date + 7, array['8d700001-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
insert into ps_ref select 'inv_2', public.pricing_send_to_supplier('8d600002-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  current_date + 7, array['8d700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
reset role;
insert into ps_ref select 'line1', l.id::text from public.supplier_invitation_lines l
  where l.invitation_id = (select v::uuid from ps_ref where k = 'inv_a') and l.boq_line_id = '8d510001-0000-0000-0000-000000000001';
insert into ps_ref select 'line2', l.id::text from public.supplier_invitation_lines l
  where l.invitation_id = (select v::uuid from ps_ref where k = 'inv_a') and l.boq_line_id = '8d510002-0000-0000-0000-000000000001';
insert into ps_ref select 'line_other', l.id::text from public.supplier_invitation_lines l
  where l.invitation_id = (select v::uuid from ps_ref where k = 'inv_2');
-- The payload a correct submission sends, built once.
insert into ps_ref select 'good', jsonb_build_array(
  jsonb_build_object('line_id', (select v from ps_ref where k = 'line1'), 'unit_cost', 5000, 'unit_cost_with_screen', 6500,
                     'spec_difference', 'Aluminium face instead of acrylic'),
  jsonb_build_object('line_id', (select v from ps_ref where k = 'line2'), 'unit_cost', '700.5'))::text;
insert into ps_ref values ('terms', '{"lead_time_days":30,"payment_terms":"30% advance, 70% before shipping","valid_until":"2099-12-31"}');

select is(public.supplier_portal_confirmation('en'),
  'My prices are based only on the files attached to this request; any material or spec difference is written on its line.',
  'The English confirmation is the spec''s sentence');
select is(public.supplier_portal_confirmation('ar'),
  'أسعاري مبنية فقط على الملفات المرفقة بهذا الطلب، وأي اختلاف في الخامة أو المواصفة مكتوب على سطره.', 'The Arabic confirmation');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '42501', null, 'Without two-step verification a supplier cannot submit');
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '42501', null, 'Another supplier cannot submit on this request');
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '42501', null, 'Staff do not submit through the portal');
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'fr')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'Submitting needs the confirmation');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '{"lead_time_days":30,"valid_until":"2099-12-31"}', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good')),
  '23514', null, 'Payment terms are required');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '{"lead_time_days":30,"payment_terms":"x","valid_until":"2020-01-01"}', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good')),
  '23514', null, 'An offer already expired is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '{"lead_time_days":"3.5","payment_terms":"x","valid_until":"2099-12-31"}', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good')),
  '23514', null, 'A lead time in part days is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":5000}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'Every open line must be sent, priced or empty');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":5000},{"line_id":"%s","unit_cost":1}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'line_other'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'A line of another request is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s","unit_cost":-5},{"line_id":"%s"}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'line2'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'A negative price is refused');
select throws_ok(format($$select public.supplier_portal_submit('%s', '[{"line_id":"%s"},{"line_id":"%s"}]', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'line1'), (select v from ps_ref where k = 'line2'), (select v from ps_ref where k = 'terms')),
  '23514', null, 'At least one line must be priced');

select is((public.supplier_portal_submit((select v::uuid from ps_ref where k = 'inv_a'), (select v::jsonb from ps_ref where k = 'good'),
  (select v::jsonb from ps_ref where k = 'terms'), 'ar'))->>'lines', '2', 'The supplier submits both lines');
select throws_ok(format($$select public.supplier_portal_submit('%s', '%s', '%s', 'en')$$,
  (select v from ps_ref where k = 'inv_a'), (select v from ps_ref where k = 'good'), (select v from ps_ref where k = 'terms')),
  'P0001', null, 'A submitted request is locked');
select is((public.supplier_portal_invitation((select v::uuid from ps_ref where k = 'inv_a')))->>'status', 'submitted',
  'The supplier sees it as submitted');
select is((public.supplier_portal_invitation((select v::uuid from ps_ref where k = 'inv_a')))->'lines'->0->>'spec_difference',
  'Aluminium face instead of acrylic', 'The supplier still reads its own prices and notes');
reset role;
select is((select state::text from public.pricing_files where id = '8d600001-0000-0000-0000-000000000001'), 'supplier_priced',
  'The file goes to the GM');
select is((select actor_id from public.pricing_file_events where file_id = '8d600001-0000-0000-0000-000000000001' and to_state = 'supplier_priced'),
  '8d000000-0000-0000-0000-000000000004'::uuid, 'The supplier is the move''s actor');
select is((select string_agg(state, ',' order by state) from public.supplier_invitation_lines where invitation_id = (select v::uuid from ps_ref where k = 'inv_a')),
  'submitted,submitted', 'Both lines are locked');
select is((select source || '/' || confirmation_lang || '/' || confirmation_text || '/' || jsonb_array_length(confirmed_files)
             from public.supplier_invitation_submissions where invitation_id = (select v::uuid from ps_ref where k = 'inv_a')),
  'portal/ar/' || public.supplier_portal_confirmation('ar') || '/1', 'The confirmation is stored with its text and the file versions');
select is((select confirmed_files->0->>'object_version' from public.supplier_invitation_submissions where invitation_id = (select v::uuid from ps_ref where k = 'inv_a')),
  'v1', 'The stored files carry the exact storage version');
select is((select source || '/' || revision_number || '/' || created_by::text || '/' || payment_terms || '/' || lead_time_days
             from public.supplier_quotes where boq_revision_id = '8d500001-0000-0000-0000-000000000001' and is_current),
  'portal/2/8d000000-0000-0000-0000-000000000004/30% advance, 70% before shipping/30', 'A new quote revision, the supplier''s, with its terms');
select is((select status::text || '/' || is_current::text from public.supplier_quotes where id = '8d800001-0000-0000-0000-000000000001'),
  'superseded/false', 'The earlier quote is superseded, not overwritten');
select is((select count(*)::int from public.notifications where notification_type = 'pricing_supplier_submitted'
             and recipient_user_id in ('8d000000-0000-0000-0000-000000000002','8d000000-0000-0000-0000-000000000003')
             and metadata->>'pricing_file_id' = '8d600001-0000-0000-0000-000000000001'), 2, 'Kalas and Zayed are told the supplier has priced');
select is((select count(*)::int from public.notifications where recipient_user_id = '8d000000-0000-0000-0000-000000000001'
             and notification_type = 'pricing_supplier_submitted'), 0, 'The rep is not');
select ok(exists (select 1 from public.audit_log where action = 'supplier_portal.submitted' and actor_id = '8d000000-0000-0000-0000-000000000004'),
  'The submission is audited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select unit_cost::text || '/' || unit_cost_with_screen::text || '/' || quotes_count from public.pricing_selling_grid
            where file_id = '8d600001-0000-0000-0000-000000000001' and boq_line_id = '8d510001-0000-0000-0000-000000000001'),
  '5000.00/6500.00/1', 'The selling grid picks the portal quote, one quote per line');
select is((select multi_quote_lines from public.pricing_selling_totals where file_id = '8d600001-0000-0000-0000-000000000001'), 0,
  'No line has two quotes');

-- Entry on behalf follows the request.
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_enter_supplier_quote('8d600002-0000-0000-0000-000000000001','8d100002-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510003-0000-0000-0000-000000000001","unit_cost":900}]')$$, 'P0001', null,
  'Entry on behalf for a supplier other than the open request''s is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('8d600002-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510003-0000-0000-0000-000000000001","unit_cost":900}]', '{}', '8d700001-0000-0000-0000-000000000001')$$, '23514', null,
  'The supplier''s file must be attached to this deal');
select is((public.pricing_enter_supplier_quote('8d600002-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510003-0000-0000-0000-000000000001","unit_cost":900}]', '{"lead_time_days":20}', '8d700003-0000-0000-0000-000000000001'))->>'lines', '1',
  'Zayed enters the request''s supplier''s prices with their original file');
reset role;
select is((select status from public.supplier_invitations where id = (select v::uuid from ps_ref where k = 'inv_2')), 'submitted',
  'The request closes as entered on behalf');
select is((select source || '/' || submitted_by::text || '/' || coalesce(confirmation_text, '-') from public.supplier_invitation_submissions
            where invitation_id = (select v::uuid from ps_ref where k = 'inv_2')),
  'on_behalf/8d000000-0000-0000-0000-000000000002/-', 'The submission says who entered it, with no supplier confirmation');
select is((select source || '/' || source_document_id::text from public.supplier_quotes where boq_revision_id = '8d500002-0000-0000-0000-000000000001' and is_current),
  'on_behalf/8d700003-0000-0000-0000-000000000001', 'The quote keeps the supplier''s original file');
select is((select state::text from public.pricing_files where id = '8d600002-0000-0000-0000-000000000001'), 'at_supplier',
  'Entry on behalf still leaves the move to the pricer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((public.supplier_portal_invitation((select v::uuid from ps_ref where k = 'inv_2')))->>'editable', 'false',
  'The supplier cannot price a request PHC entered on its behalf');

-- Entry on behalf over a portal quote supersedes it: what the supplier submitted stays on record.
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_move('8d600001-0000-0000-0000-000000000001','at_supplier','Fix line 1')$$,
  'The pricer sends the file back to the supplier (the plain move)');
select lives_ok($$select public.pricing_enter_supplier_quote('8d600001-0000-0000-0000-000000000001','8d100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"8d510001-0000-0000-0000-000000000001","unit_cost":4800},{"boq_line_id":"8d510002-0000-0000-0000-000000000001","unit_cost":700.5}]')$$,
  'And corrects the prices on the supplier''s behalf');
reset role;
select is((select string_agg(source || ':' || status || ':' || is_current, ',' order by revision_number)
             from public.supplier_quotes where boq_revision_id = '8d500001-0000-0000-0000-000000000001'),
  'internal:superseded:false,portal:superseded:false,on_behalf:responses_received:true',
  'The portal quote is superseded by the entry, and kept');
select is((select count(*)::int from public.supplier_quotes where boq_revision_id = '8d500001-0000-0000-0000-000000000001' and is_current
             and status not in ('cancelled','superseded')), 1, 'Still one live quote');

select * from finish();
rollback;
