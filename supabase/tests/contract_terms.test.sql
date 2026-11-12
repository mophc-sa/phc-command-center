-- Phase B, B1: the contract's terms and payment schedule, recorded by the rep from
-- the quotation and reviewed by finance. Test user UUIDs use the 8e… prefix.
-- Users: 1 rep (deal owner), 2 finance, 3 another rep, 4 sales manager.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8e000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','ct-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '8e000000-%';
insert into public.user_roles (user_id, role) values
  ('8e000000-0000-0000-0000-000000000001','salesperson'),
  ('8e000000-0000-0000-0000-000000000002','finance_manager'),
  ('8e000000-0000-0000-0000-000000000003','salesperson'),
  ('8e000000-0000-0000-0000-000000000004','sales_manager');

-- Deal 1 has a quotation sent to the client (Rev 0, 53200.00 in two lines). Deal 2 has none.
insert into public.opportunities (id, project_name, project_code, client, owner_id, created_by, sales_stage)
select ('8e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'ct-deal-' || n, 'CT-26-000' || n, 'ct-client',
       '8e000000-0000-0000-0000-000000000001','8e000000-0000-0000-0000-000000000001','contract_received'
  from generate_series(1,2) n;
set local session_replication_role = replica;
insert into public.quotations (id, quote_number, related_opportunity_id, owner_id, value, status)
values ('8e300001-0000-0000-0000-000000000001','CT-26-0001','8e200001-0000-0000-0000-000000000001',
        '8e000000-0000-0000-0000-000000000001',53200,'submitted');
insert into public.quotation_revisions (id, quotation_id, revision_number, is_current, status, subtotal_excl_vat,
       approved_by, approved_at, submitted_by, submitted_at, issued_at)
values ('8e310001-0000-0000-0000-000000000001','8e300001-0000-0000-0000-000000000001',1,true,'submitted',53200,
        '8e000000-0000-0000-0000-000000000004',now(),'8e000000-0000-0000-0000-000000000004',now(),now());
insert into public.quotation_revision_lines (revision_id, line_number, description, quantity, unit, line_total) values
  ('8e310001-0000-0000-0000-000000000001',1,'Pylon P1',2,'no',34322.58),
  ('8e310001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'no',18877.42);
set local session_replication_role = origin;

-- The terms the rep enters: 30/20/30/20, signed 2026-11-01, the meeting's periods.
create temp table t (k text primary key, v jsonb);
grant all on t to authenticated;
insert into t values ('terms', '{"reference":"PO-778","signed_on":"2026-11-01","value":53200,
  "drawings_days":5,"supply_install_days":45,"handover_days":10,"credit_days":30,
  "payments":[{"kind":"advance","pct":30},{"kind":"drawings_approval","pct":20},{"kind":"mir","pct":30},{"kind":"wir","pct":20}]}');

-- ===== Who records =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'))$$,
  '42501', null, 'Another rep cannot record this deal''s contract');
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.contract_terms_save('8e200002-0000-0000-0000-000000000001', (select v from t where k = 'terms'))$$,
  'P0001', null, 'A deal with no quotation sent has nothing to contract');

-- ===== Bad terms =====
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  jsonb_set((select v from t where k = 'terms'), '{payments}', '[{"kind":"advance","pct":30},{"kind":"wir","pct":60}]'))$$,
  '23514', null, 'Payments must add up to 100%');
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  jsonb_set((select v from t where k = 'terms'), '{payments}', '[{"kind":"advance","pct":0},{"kind":"wir","pct":100}]'))$$,
  '23514', null, 'Each payment is above 0%');
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  jsonb_set((select v from t where k = 'terms'), '{payments}', '[]'))$$,
  '23514', null, 'At least one payment');
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  jsonb_set((select v from t where k = 'terms'), '{value}', '50000'))$$,
  '23514', null, 'A value other than the quotation''s needs a reason');
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  jsonb_set((select v from t where k = 'terms'), '{value}', '0'))$$,
  '23514', null, 'The value is above 0');
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  jsonb_set((select v from t where k = 'terms'), '{payments}', '[{"kind":"deposit","pct":100}]'))$$,
  '23514', null, 'An unknown payment kind is refused');

-- ===== Save =====
select lives_ok($$select set_config('ct.id', public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  (select v from t where k = 'terms'))::text, false)$$, 'The deal owner records the contract');
select is((select terms_status || '/' || contract_value::text || '/' || quotation_revision_id::text from public.contracts
            where id = current_setting('ct.id')::uuid),
  'draft/53200.00/8e310001-0000-0000-0000-000000000001', 'A draft at the quotation''s value, linked to it');
select is((select array_agg(kind || ':' || pct::int || ':' || amount::text order by position) from public.contract_payments
            where contract_id = current_setting('ct.id')::uuid),
  array['advance:30:15960.00','drawings_approval:20:10640.00','mir:30:15960.00','wir:20:10640.00'],
  'Amounts are computed from the percentages');
select is((select array_agg(kind || ':' || expected_on::text order by position) from public.contract_payments
            where contract_id = current_setting('ct.id')::uuid),
  array['advance:2026-11-01','drawings_approval:2026-11-06','mir:2026-12-21','wir:2026-12-31'],
  'Expected dates follow the execution period');
select is((select string_agg(description || ':' || quantity::int, ',' order by line_number) from public.contract_lines
            where contract_id = current_setting('ct.id')::uuid), 'Pylon P1:2,Ceiling C1:4',
  'The quotation''s lines are the contract quantities');

-- Rounding: three equal thirds of 53200 give the remainder to the last payment.
select lives_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001',
  jsonb_set(jsonb_set((select v from t where k = 'terms'), '{value}', '50000'), '{payments}',
  '[{"kind":"advance","pct":33.33},{"kind":"mir","pct":33.33},{"kind":"wir","pct":33.34}]')
  || '{"value_difference_reason":"Negotiated discount"}')$$, 'Saving again updates the same draft, with a reason for the value');
select is((select array_agg(amount::text order by position) from public.contract_payments where contract_id = current_setting('ct.id')::uuid),
  array['16665.00','16665.00','16670.00'], 'The amounts sum to the value exactly');
select is((select count(*)::int from public.contracts where opportunity_id = '8e200001-0000-0000-0000-000000000001'), 1,
  'One open contract per deal');
select lives_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'))$$,
  'Back to the agreed terms');

-- ===== Direct writes are closed =====
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$update public.contracts set terms_status = 'approved' where id = '%s'$$, current_setting('ct.id')),
  '42501', null, 'The terms status moves only through the review');
select throws_ok(format($$update public.contract_payments set pct = 50 where contract_id = '%s'$$, current_setting('ct.id')),
  '42501', null, 'Payments change only through the save');

-- ===== Submit and review =====
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.contract_terms_submit('%s')$$, current_setting('ct.id')), 'The rep sends it for review');
reset role;
select ok(exists (select 1 from public.notifications where notification_type = 'contract_review'
                   and recipient_user_id = '8e000000-0000-0000-0000-000000000002'), 'Finance is told');
set local role authenticated;
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'))$$,
  'P0001', null, 'No edits while finance reviews it');
select throws_ok(format($$select public.contract_terms_review('%s','approve')$$, current_setting('ct.id')),
  '42501', null, 'The rep cannot approve');
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.contract_terms_review('%s','return','  ')$$, current_setting('ct.id')),
  '23514', null, 'A return needs a reason');
select lives_ok(format($$select public.contract_terms_review('%s','return','Advance is 20%% in the PO')$$, current_setting('ct.id')),
  'Finance returns it');
reset role;
select ok(exists (select 1 from public.notifications where notification_type = 'contract_returned'
                   and recipient_user_id = '8e000000-0000-0000-0000-000000000001'), 'The rep is told');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select public.contract_terms_save('8e200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'));
select public.contract_terms_submit(current_setting('ct.id')::uuid);
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.contract_terms_review('%s','approve')$$, current_setting('ct.id')), 'Finance approves');
select is((select terms_status from public.contracts where id = current_setting('ct.id')::uuid), 'approved', 'Approved');

-- ===== Frozen, and readable by the deal's people only =====
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.contract_terms_save('8e200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'))$$,
  'P0001', null, 'Approved terms cannot be edited');
select is((select count(*)::int from public.contract_payments where contract_id = current_setting('ct.id')::uuid), 4,
  'The rep reads the payments');
select set_config('request.jwt.claims','{"sub":"8e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.contract_payments where contract_id = current_setting('ct.id')::uuid), 0,
  'Another rep reads none');
reset role;

select * from finish();
rollback;
