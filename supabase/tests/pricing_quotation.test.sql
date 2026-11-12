-- PR 4, part 2: the BD manager issues the quotation from the approved price; line snapshot; mark sent.
-- Fixture: PR 2's worked example (cost 39900.00, selling 53200.00), built, proposed and approved.
-- Users: 1 rep, 2 estimation + finance (Zayed), 3 GM (Kalas), 4 BD manager (Marie).
-- Test user UUIDs use the 8b… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8b000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','pq-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '8b000000-%';
insert into public.user_roles (user_id, role) values
  ('8b000000-0000-0000-0000-000000000001','salesperson'),
  ('8b000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8b000000-0000-0000-0000-000000000002','finance_manager'),
  ('8b000000-0000-0000-0000-000000000003','general_manager'),
  ('8b000000-0000-0000-0000-000000000004','bd_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('8b100000-0000-0000-0000-000000000001','pq-vendor');

-- Deal 1: the worked example, in the selling build. Deal 2: in package review (for needs_info).
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pq-deal-' || n,
       '8b000000-0000-0000-0000-000000000001','8b000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pq-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8b50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8b40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen) values
  ('8b510001-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false),
  ('8b510002-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status) values
  ('8b520001-0000-0000-0000-000000000001','8b500001-0000-0000-0000-000000000001','8b100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen) values
  ('8b520001-0000-0000-0000-000000000001','8b510001-0000-0000-0000-000000000001',5000,2,10000,null),
  ('8b520001-0000-0000-0000-000000000001','8b510002-0000-0000-0000-000000000001',1000,4,4000,1500);
update public.boq_revisions set frozen_at = now(), frozen_by = '8b000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '8b500001-0000-0000-0000-000000000001';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8b600001-0000-0000-0000-000000000001','8b200001-0000-0000-0000-000000000001','selling_build','8b500001-0000-0000-0000-000000000001'),
  ('8b600002-0000-0000-0000-000000000001','8b200002-0000-0000-0000-000000000001','package_review','8b500002-0000-0000-0000-000000000001');
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('8b600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate) values
  ('8b900001-0000-0000-0000-000000000001','pq_crane','Crane','رافعة','lump',3000);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('8b600001-0000-0000-0000-000000000001','8b900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- Kalas builds and proposes.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_build_price('8b600001-0000-0000-0000-000000000001');
select public.pricing_file_propose('8b600001-0000-0000-0000-000000000001', 53200, 39900);
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_review('8b600001-0000-0000-0000-000000000001','approve');
reset role;
select is((select state::text from public.pricing_files where id = '8b600001-0000-0000-0000-000000000001'), 'approved',
  'fixture: the price is approved');

-- ===== Who issues =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date + 30, '30% advance', '60 days', 'Signage')$$,
  '42501', null, 'A rep cannot issue');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date + 30, null, null, null)$$,
  '42501', null, 'Finance does not issue');

-- ===== Issue =====
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date - 1, null, null, null)$$,
  '23514', null, 'Validity cannot be in the past');
select throws_ok($$select public.pricing_issue_quotation('8b600002-0000-0000-0000-000000000001', current_date + 30, null, null, null)$$,
  'P0001', null, 'A file that is not approved cannot issue');
select lives_ok($$select set_config('pq.rev', public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001',
                   current_date + 30, '30% advance', '60 days', 'Signage')::text, false)$$,
  'The BD manager issues the quotation');
reset role;
select is((select status::text from public.quotation_revisions where id = current_setting('pq.rev')::uuid), 'approved',
  'An in-file revision is approved by the issue itself');
select is((select subtotal_excl_vat from public.quotation_revisions where id = current_setting('pq.rev')::uuid), 53200.00::numeric,
  'The subtotal is the approved price');
select is((select total_incl_vat from public.quotation_revisions where id = current_setting('pq.rev')::uuid), 61180.00::numeric,
  'VAT 15% is added');
select is((select sum(line_total) from public.quotation_revision_lines where revision_id = current_setting('pq.rev')::uuid),
  53200.00::numeric, 'The lines sum to the approved price');
select is((select string_agg(description, ' | ' order by line_number) from public.quotation_revision_lines
            where revision_id = current_setting('pq.rev')::uuid), 'Pylon P1 | Ceiling C1', 'One line per BOQ line, in order');
select is((select state::text from public.pricing_files where id = '8b600001-0000-0000-0000-000000000001'), 'quoted',
  'The file moves to quoted');
select is((select revision_number from public.quotation_revisions where id = current_setting('pq.rev')::uuid), 1, 'First revision');
select is((select q.status::text from public.quotations q join public.quotation_revisions r on r.quotation_id = q.id
            where r.id = current_setting('pq.rev')::uuid), 'approved_for_submission', 'The quotation header is ready to send');

-- ===== Twice is refused =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_issue_quotation('8b600001-0000-0000-0000-000000000001', current_date + 30, null, null, null)$$,
  'P0001', null, 'A quoted file cannot issue again');

-- ===== The rep reads the quotation and its lines, never cost =====
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.quotation_revision_lines where revision_id = current_setting('pq.rev')::uuid), 2,
  'The rep reads every line');
select is((select count(*)::int from public.pricing_file_lines where file_id = '8b600001-0000-0000-0000-000000000001'), 0,
  'The rep reads no built cost');
select throws_ok(format($$insert into public.quotation_revision_lines (revision_id, line_number, description, quantity, line_total)
                   values ('%s', 99, 'x', 1, 1)$$, current_setting('pq.rev')), '42501', null, 'No direct writes to the lines');

-- ===== Mark sent =====
select throws_ok(format($$select public.pricing_mark_quotation_sent('%s')$$, current_setting('pq.rev')), '42501', null,
  'A rep cannot mark it sent');
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.pricing_mark_quotation_sent('%s')$$, current_setting('pq.rev')), 'The BD manager marks it sent');
reset role;
select is((select status::text from public.quotation_revisions where id = current_setting('pq.rev')::uuid), 'submitted', 'Submitted');

-- ===== Outside the issue RPC the GM gate stays =====
-- A revision that claims the file but was not written by the issue RPC is refused.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8b000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_like(format($$insert into public.quotation_revisions (quotation_id, revision_number, is_current, subtotal_excl_vat, pricing_file_id)
                   select quotation_id, 50, false, 1, '8b600001-0000-0000-0000-000000000001' from public.quotation_revisions where id = '%s'$$,
                   current_setting('pq.rev')),
  '%pricing file%', 'A hand-made revision cannot claim a pricing file');

select * from finish();
rollback;
