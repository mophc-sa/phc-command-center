-- PR 2 Task 14: a pricer enters the supplier's prices on their behalf on a frozen BOQ
-- while the file is at the supplier; nothing else can.
-- Test user UUIDs use the 7a prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('7a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','se-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,2) n;
update public.profiles set status = 'active' where id::text like '7a000000-%';
insert into public.user_roles (user_id, role) values
  ('7a000000-0000-0000-0000-000000000001','salesperson'),
  ('7a000000-0000-0000-0000-000000000002','estimation_manager'),
  ('7a000000-0000-0000-0000-000000000002','finance_manager');
insert into public.vendors (id, name) values
  ('7a100001-0000-0000-0000-000000000001','se-vendor-1'),
  ('7a100002-0000-0000-0000-000000000001','se-vendor-2');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('7a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'se-deal-' || n,
       '7a000000-0000-0000-0000-000000000001','7a000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('7a40000' || n || '-0000-0000-0000-000000000001')::uuid, ('7a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'se-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('7a50000' || n || '-0000-0000-0000-000000000001')::uuid, ('7a40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity) values
  ('7a510001-0000-0000-0000-000000000001','7a500001-0000-0000-0000-000000000001',1,'Pylon P1',2),
  ('7a510002-0000-0000-0000-000000000001','7a500001-0000-0000-0000-000000000001',2,'Ceiling C1',4),
  ('7a510003-0000-0000-0000-000000000001','7a500002-0000-0000-0000-000000000001',1,'Wall W1',1);
update public.boq_revisions set frozen_at = now(), frozen_by = '7a000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '7a50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('7a600001-0000-0000-0000-000000000001','7a200001-0000-0000-0000-000000000001','at_supplier','7a500001-0000-0000-0000-000000000001'),
  ('7a600002-0000-0000-0000-000000000001','7a200002-0000-0000-0000-000000000001','boq_frozen','7a500002-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":5000}]')$$, '42501', null, 'A rep cannot enter supplier prices');
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"not-a-line","unit_cost":5000}]')$$, '23514', null, 'A malformed line is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600002-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510003-0000-0000-0000-000000000001","unit_cost":700}]')$$, 'P0001', null, 'Prices are entered while the file is at the supplier');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510003-0000-0000-0000-000000000001","unit_cost":700}]')$$, '23514', null, 'A line of another BOQ is refused');
select is((public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":5000},
    {"boq_line_id":"7a510002-0000-0000-0000-000000000001","unit_cost":1000,"unit_cost_with_screen":1500,"alternate_spec":"Acrylic instead of glass"}]',
  '{"lead_time_days":30,"payment_terms":"30% advance","valid_until":"2026-12-31"}'))->>'lines', '2',
  'Zayed enters the supplier''s prices on a frozen BOQ');
select is((select line_cost from public.supplier_quote_costs where boq_line_id = '7a510001-0000-0000-0000-000000000001'), 10000.00::numeric,
  'The line cost is unit x the BOQ quantity');
select is((select unit_cost_with_screen::text || '/' || alternate_spec from public.supplier_quote_costs where boq_line_id = '7a510002-0000-0000-0000-000000000001'),
  '1500.00/Acrylic instead of glass', 'The screen price and the spec difference are kept');
select is((select q.created_by::text || '/' || q.notes || '/' || q.lead_time_days from public.supplier_quotes q where q.boq_revision_id = '7a500001-0000-0000-0000-000000000001'),
  '7a000000-0000-0000-0000-000000000002/Entered on behalf of the supplier/30', 'The quote says who entered it, on whose behalf');
select lives_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":6000}]')$$, 'Entering again corrects a price');
select is((select count(*)::int || '/' || (max(unit_cost) filter (where boq_line_id = '7a510001-0000-0000-0000-000000000001'))::text
             from public.supplier_quote_costs where boq_revision_id = '7a500001-0000-0000-0000-000000000001'),
  '2/6000.00', 'Still one line per BOQ line, with the new price');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":4000}]')$$, 'P0001', null, 'One supplier per file in this release');
select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency) values ('7a500001-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001','SAR')$$,
  '42501', null, 'A direct insert on the frozen BOQ is still refused');
select set_config('phc.pricing_supplier_entry', '7a500002-0000-0000-0000-000000000001', true);
select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency) values ('7a500002-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001','SAR')$$,
  '42501', null, 'The flag alone opens nothing: the file must be at the supplier');
select set_config('phc.pricing_supplier_entry', '7a500001-0000-0000-0000-000000000001', true);
select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency) values ('7a500002-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001','SAR')$$,
  '42501', null, 'The flag is for one revision only');
select set_config('phc.pricing_supplier_entry', 'on', true);
select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency) values ('7a500001-0000-0000-0000-000000000001','7a100002-0000-0000-0000-000000000001','SAR')$$,
  '42501', null, 'A flag that names no revision opens nothing');
select set_config('phc.pricing_supplier_entry', '', true);
-- Bounds, currency, re-entry, audit, isolation (as the pricer again)
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":1000000000000}]')$$, '23514', null, 'A price past the column precision is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":-5}]')$$, '23514', null, 'A negative price is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":5},{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":6}]')$$, '23514', null, 'A repeated BOQ line is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":5}]', '{"valid_until":"2026-02-30"}')$$, '23514', null, 'An impossible date is refused');
select throws_ok($$select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":5}]', '{"lead_time_days":99999}')$$, '23514', null, 'A lead time past 9999 days is refused');
select is((select currency::text from public.supplier_quotes where boq_revision_id = '7a500001-0000-0000-0000-000000000001' and is_current), 'SAR',
  'The quote currency defaults to SAR');
select is((select count(*)::int from public.supplier_quotes where boq_revision_id = '7a500001-0000-0000-0000-000000000001' and is_current and status not in ('cancelled','superseded')),
  1, 'Re-entry keeps exactly one live quote');
select is((select count(*)::int from public.supplier_quote_lines l join public.supplier_quotes q on q.id = l.supplier_quote_id
            where q.boq_revision_id = '7a500001-0000-0000-0000-000000000001' and l.is_selected), 0, 'Entry never selects a line');
select public.pricing_enter_supplier_quote('7a600001-0000-0000-0000-000000000001','7a100001-0000-0000-0000-000000000001',
  '[{"boq_line_id":"7a510001-0000-0000-0000-000000000001","unit_cost":6500}]');
select is((select count(*)::int from public.supplier_quote_costs where boq_revision_id = '7a500001-0000-0000-0000-000000000001' and unit_cost is not null), 1,
  'A line left out of a re-entry is cleared, not kept');
select throws_ok($$select unit_cost from public.supplier_quote_lines$$, '42501', null, 'The cost column is still not granted');
select set_config('request.jwt.claims','{"sub":"7a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.supplier_quote_costs), 0, 'A rep reads no supplier cost');
reset role;
select is((select count(*)::int from public.audit_log where action = 'pricing_file.supplier_prices_entered' and actor_id = '7a000000-0000-0000-0000-000000000002'), 3,
  'Every successful entry is audited');
select * from finish();
rollback;
