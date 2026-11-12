-- Phase B, B3: invoices against dues, receipts, claims, lateness and escalation. Test user UUIDs use the 9b… prefix.
-- Users: 1 rep (deal owner), 2 finance, 3 another rep, 4 sales manager. Fixture as contract_approvals.test.sql.
-- Users: 1 rep (deal owner), 2 finance, 3 another rep, 4 sales manager.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9b000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','cb-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '9b000000-%';
insert into public.user_roles (user_id, role) values
  ('9b000000-0000-0000-0000-000000000001','salesperson'),
  ('9b000000-0000-0000-0000-000000000002','finance_manager'),
  ('9b000000-0000-0000-0000-000000000003','salesperson'),
  ('9b000000-0000-0000-0000-000000000004','sales_manager');

-- Deal 1 has a quotation sent to the client (Rev 0, 53200.00 in two lines). Deal 2 has none.
insert into public.opportunities (id, project_name, project_code, client, owner_id, created_by, sales_stage)
select ('9b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'cb-deal-' || n, 'CB-26-000' || n, 'cb-client',
       '9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001','contract_received'
  from generate_series(1,2) n;
set local session_replication_role = replica;
insert into public.quotations (id, quote_number, related_opportunity_id, owner_id, value, status)
values ('9b300001-0000-0000-0000-000000000001','CB-26-0001','9b200001-0000-0000-0000-000000000001',
        '9b000000-0000-0000-0000-000000000001',53200,'submitted');
insert into public.quotation_revisions (id, quotation_id, revision_number, is_current, status, subtotal_excl_vat,
       approved_by, approved_at, submitted_by, submitted_at, issued_at)
values ('9b310001-0000-0000-0000-000000000001','9b300001-0000-0000-0000-000000000001',1,true,'submitted',53200,
        '9b000000-0000-0000-0000-000000000004',now(),'9b000000-0000-0000-0000-000000000004',now(),now());
insert into public.quotation_revision_lines (revision_id, line_number, description, quantity, unit, line_total) values
  ('9b310001-0000-0000-0000-000000000001',1,'Pylon P1',2,'no',34322.58),
  ('9b310001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'no',18877.42);
set local session_replication_role = origin;

-- The terms the rep enters: 30/20/30/20, signed 2026-11-01, the meeting's periods.
create temp table t (k text primary key, v jsonb);
grant all on t to authenticated;
insert into t values ('terms', '{"reference":"PO-778","signed_on":"2026-10-01","value":53200,
  "drawings_days":5,"supply_install_days":45,"handover_days":10,"credit_days":30,
  "payments":[{"kind":"advance","pct":30},{"kind":"drawings_approval","pct":20},{"kind":"mir","pct":30},{"kind":"wir","pct":20}]}');

-- The rep records 30/20/30/20 on 53200, signed 2026-10-01, drawings 5 days, credit 30; finance approves.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select set_config('cb.id', public.contract_terms_save('9b200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'))::text, false);
select set_config('cb.adv', (select id::text from public.contract_payments where contract_id = current_setting('cb.id')::uuid and kind = 'advance'), false);
select set_config('cb.drw', (select id::text from public.contract_payments where contract_id = current_setting('cb.id')::uuid and kind = 'drawings_approval'), false);
select set_config('cb.mir', (select id::text from public.contract_payments where contract_id = current_setting('cb.id')::uuid and kind = 'mir'), false);
select set_config('cb.wir', (select id::text from public.contract_payments where contract_id = current_setting('cb.id')::uuid and kind = 'wir'), false);

-- Terms approved (advance due 15960.00 on 2026-10-31); drawings approved 2026-10-15 (due 10640.00).
select public.contract_terms_submit(current_setting('cb.id')::uuid);
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.contract_terms_review(current_setting('cb.id')::uuid, 'approve');
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select public.contract_approval_record(current_setting('cb.id')::uuid, current_setting('cb.drw')::uuid, '2026-10-15', 100, '2026-10-12', null, null, null);
select set_config('cb.due_adv', (select id::text from public.contract_dues where payment_id = current_setting('cb.adv')::uuid), false);
select set_config('cb.due_drw', (select id::text from public.contract_dues where payment_id = current_setting('cb.drw')::uuid), false);

-- ===== Who records an invoice =====
select throws_ok(format($$select public.contract_invoice_record('%s', 'INV-1', '2026-10-02', array['%s']::uuid[], null)$$,
  current_setting('cb.id'), current_setting('cb.due_adv')), '42501', null, 'The rep cannot record an invoice');
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);

-- ===== Bad invoices =====
select throws_ok(format($$select public.contract_invoice_record('%s', '  ', '2026-10-02', array['%s']::uuid[], null)$$,
  current_setting('cb.id'), current_setting('cb.due_adv')), '23514', null, 'An invoice needs its number');
select throws_ok(format($$select public.contract_invoice_record('%s', 'INV-1', '2026-10-02', array[]::uuid[], null)$$,
  current_setting('cb.id')), '23514', null, 'An invoice covers at least one due');
select throws_ok(format($$select public.contract_invoice_record('%s', 'INV-1', current_date + 1, array['%s']::uuid[], null)$$,
  current_setting('cb.id'), current_setting('cb.due_adv')), '23514', null, 'Not dated in the future');
select throws_ok(format($$select public.contract_invoice_record('%s', 'INV-1', '2026-10-02', array['9b000000-0000-0000-0000-00000000dead']::uuid[], null)$$,
  current_setting('cb.id')), '23514', null, 'Only this contract''s dues');

-- ===== Invoice the advance =====
select lives_ok(format($$select set_config('cb.inv1', public.contract_invoice_record('%s', 'INV-1', '2026-10-02', array['%s']::uuid[], 'Advance')::text, false)$$,
  current_setting('cb.id'), current_setting('cb.due_adv')), 'Finance records the advance invoice');
select is((select amount_excl_vat::text || '/' || vat_amount::text || '/' || total_incl_vat::text || '/' || due_on::text
             from public.contract_invoices where id = current_setting('cb.inv1')::uuid),
  '15960.00/2394.00/18354.00/2026-11-01', 'Amount from its dues, VAT 15%, due 30 days after the invoice');
select throws_ok(format($$select public.contract_invoice_record('%s', 'INV-2', '2026-10-03', array['%s']::uuid[], null)$$,
  current_setting('cb.id'), current_setting('cb.due_adv')), '23514', null, 'A due is invoiced once');
select throws_ok(format($$select public.contract_invoice_record('%s', 'INV-1', '2026-10-20', array['%s']::uuid[], null)$$,
  current_setting('cb.id'), current_setting('cb.due_drw')), '23514', null, 'An invoice number is used once per contract');

-- ===== Receipts =====
select throws_ok(format($$select public.contract_receipt_record('%s', '2026-10-20', 20000, null, null)$$, current_setting('cb.inv1')),
  '23514', null, 'Not more than the invoice total');
select lives_ok(format($$select public.contract_receipt_record('%s', '2026-10-20', 10000, 'TRX-1', null)$$, current_setting('cb.inv1')),
  'A partial receipt');
select is((select received::text || '/' || outstanding::text from public.contract_receivables where invoice_id = current_setting('cb.inv1')::uuid),
  '10000.00/8354.00', 'Received and outstanding');
select is((select days_late from public.contract_receivables where invoice_id = current_setting('cb.inv1')::uuid),
  greatest(0, current_date - date '2026-11-01'), 'Days late from the due date');
select is((select tier from public.contract_receivables where invoice_id = current_setting('cb.inv1')::uuid),
  case when current_date - date '2026-11-01' >= 60 then 3 when current_date - date '2026-11-01' >= 30 then 2
       when current_date - date '2026-11-01' >= 1 then 1 else 0 end, 'The tier follows the days late');
select throws_ok(format($$select public.contract_invoice_void('%s', 'Wrong number')$$, current_setting('cb.inv1')),
  'P0001', null, 'An invoice with a receipt cannot be voided');

-- ===== The rep's view and the claim log =====
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select invoiced_excl_vat::text || '/' || left_to_invoice::text || '/' || received::text || '/' || outstanding::text
             from public.contract_billing_summary where contract_id = current_setting('cb.id')::uuid),
  '15960.00/37240.00/10000.00/8354.00', 'The rep sees the billing and collection gauges');
select is((select dues_not_invoiced from public.contract_billing_summary where contract_id = current_setting('cb.id')::uuid), 1,
  'The drawings due is waiting to be invoiced');
select throws_ok(format($$select public.contract_claim_record('%s', '%s', '2026-11-05', 'fax', 'x', null)$$,
  current_setting('cb.id'), current_setting('cb.inv1')), '23514', null, 'A known channel');
select lives_ok(format($$select public.contract_claim_record('%s', '%s', '2026-11-05', 'email', 'Sent the claim letter', '2026-11-12')$$,
  current_setting('cb.id'), current_setting('cb.inv1')), 'The rep logs a claim');
select throws_ok(format($$select public.contract_receipt_record('%s', '2026-10-21', 100, null, null)$$, current_setting('cb.inv1')),
  '42501', null, 'The rep cannot record a receipt');
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.contract_invoices), 0, 'Another rep reads no invoice');
select throws_ok(format($$select public.contract_claim_record('%s', null, '2026-11-05', 'email', 'x', null)$$, current_setting('cb.id')),
  '42501', null, 'Another rep cannot log a claim');

-- ===== Escalation (a fixed day, so the test does not age) =====
reset role;
select is(public.contract_collections_escalate(date '2026-11-02'), 1, 'Day 1 late: the rep (the drawings due is not past its date yet)');
select is(public.contract_collections_escalate(date '2026-11-02'), 0, 'Once per tier');
select ok(exists (select 1 from public.notifications where notification_type = 'contract_invoice_late'
                   and recipient_user_id = '9b000000-0000-0000-0000-000000000001'), 'The rep is told first');
select is(public.contract_collections_escalate(date '2026-12-01'), 2, 'Day 30: the sales manager; and finance for the drawings due past its date, not invoiced');
select ok(exists (select 1 from public.notifications where notification_type = 'contract_invoice_late'
                   and recipient_user_id = '9b000000-0000-0000-0000-000000000004'), 'The sales manager is told');

-- ===== An approval whose due is invoiced cannot be voided =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.contract_invoice_record(current_setting('cb.id')::uuid, 'INV-2', '2026-10-20', array[current_setting('cb.due_drw')::uuid], null);
select throws_ok(format($$select public.contract_approval_void((select approval_id from public.contract_dues where id = '%s'), 'x')$$,
  current_setting('cb.due_drw')), 'P0001', null, 'Void the invoice first');
reset role;

select * from finish();
rollback;
