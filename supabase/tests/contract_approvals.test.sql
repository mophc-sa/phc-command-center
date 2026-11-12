-- Phase B, B2: execution approvals make payments due. Test user UUIDs use the 9a… prefix.
-- Users: 1 rep (deal owner), 2 finance, 3 another rep, 4 sales manager. Fixture as contract_terms.test.sql.
-- Users: 1 rep (deal owner), 2 finance, 3 another rep, 4 sales manager.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('9a000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','ca-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '9a000000-%';
insert into public.user_roles (user_id, role) values
  ('9a000000-0000-0000-0000-000000000001','salesperson'),
  ('9a000000-0000-0000-0000-000000000002','finance_manager'),
  ('9a000000-0000-0000-0000-000000000003','salesperson'),
  ('9a000000-0000-0000-0000-000000000004','sales_manager');

-- Deal 1 has a quotation sent to the client (Rev 0, 53200.00 in two lines). Deal 2 has none.
insert into public.opportunities (id, project_name, project_code, client, owner_id, created_by, sales_stage)
select ('9a20000' || n || '-0000-0000-0000-000000000001')::uuid, 'ca-deal-' || n, 'CA-26-000' || n, 'ca-client',
       '9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001','contract_received'
  from generate_series(1,2) n;
set local session_replication_role = replica;
insert into public.quotations (id, quote_number, related_opportunity_id, owner_id, value, status)
values ('9a300001-0000-0000-0000-000000000001','CA-26-0001','9a200001-0000-0000-0000-000000000001',
        '9a000000-0000-0000-0000-000000000001',53200,'submitted');
insert into public.quotation_revisions (id, quotation_id, revision_number, is_current, status, subtotal_excl_vat,
       approved_by, approved_at, submitted_by, submitted_at, issued_at)
values ('9a310001-0000-0000-0000-000000000001','9a300001-0000-0000-0000-000000000001',1,true,'submitted',53200,
        '9a000000-0000-0000-0000-000000000004',now(),'9a000000-0000-0000-0000-000000000004',now(),now());
insert into public.quotation_revision_lines (revision_id, line_number, description, quantity, unit, line_total) values
  ('9a310001-0000-0000-0000-000000000001',1,'Pylon P1',2,'no',34322.58),
  ('9a310001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'no',18877.42);
set local session_replication_role = origin;

-- The terms the rep enters: 30/20/30/20, signed 2026-11-01, the meeting's periods.
create temp table t (k text primary key, v jsonb);
grant all on t to authenticated;
insert into t values ('terms', '{"reference":"PO-778","signed_on":"2026-10-01","value":53200,
  "drawings_days":5,"supply_install_days":45,"handover_days":10,"credit_days":30,
  "payments":[{"kind":"advance","pct":30},{"kind":"drawings_approval","pct":20},{"kind":"mir","pct":30},{"kind":"wir","pct":20}]}');

-- The rep records 30/20/30/20 on 53200, signed 2026-10-01, drawings 5 days, credit 30; finance approves.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select set_config('ca.id', public.contract_terms_save('9a200001-0000-0000-0000-000000000001', (select v from t where k = 'terms'))::text, false);
select set_config('ca.adv', (select id::text from public.contract_payments where contract_id = current_setting('ca.id')::uuid and kind = 'advance'), false);
select set_config('ca.drw', (select id::text from public.contract_payments where contract_id = current_setting('ca.id')::uuid and kind = 'drawings_approval'), false);
select set_config('ca.mir', (select id::text from public.contract_payments where contract_id = current_setting('ca.id')::uuid and kind = 'mir'), false);
select set_config('ca.wir', (select id::text from public.contract_payments where contract_id = current_setting('ca.id')::uuid and kind = 'wir'), false);

-- ===== Not before the terms are approved =====
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-05', 100, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.drw')), 'P0001', null, 'No approval on terms finance has not approved');
select public.contract_terms_submit(current_setting('ca.id')::uuid);
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.contract_terms_review(current_setting('ca.id')::uuid, 'approve');

-- ===== The advance falls due on approval of the terms =====
select is((select amount::text || '/' || event_on::text || '/' || due_on::text || '/' || status from public.contract_dues
            where payment_id = current_setting('ca.adv')::uuid), '15960.00/2026-10-01/2026-10-31/open',
  'The advance is due at signing + the credit period');

-- ===== Who records =====
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-10', 100, '2026-10-02', null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.drw')), '42501', null, 'Another rep cannot record an approval');
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- ===== Bad approvals =====
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-10', 100, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.drw')), '23514', null, 'A drawings approval needs the date the drawings were submitted');
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-10', 100, '2026-10-12', null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.drw')), '23514', null, 'Submitted after approved is refused');
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-09-30', 100, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.mir')), '23514', null, 'Not before the signing date');
select throws_ok(format($$select public.contract_approval_record('%s', '%s', current_date + 1, 100, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.mir')), '23514', null, 'Not in the future');
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-10', 0, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.mir')), '23514', null, 'A share above 0');
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-10', 100, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.adv')), 'P0001', null, 'The advance is not recorded by hand');

-- ===== Drawings approved late by the consultant: 2026-10-02 -> 2026-10-15, 13 days for 5 allowed =====
select lives_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-15', 100, '2026-10-02', 'CONS-12', 'contracts/x.pdf', null)$$,
  current_setting('ca.id'), current_setting('ca.drw')), 'The rep records the drawings approval');
select is((select consultant_delay_days from public.contracts where id = current_setting('ca.id')::uuid), 8,
  'Eight days of consultant delay');
select is((select amount::text || '/' || due_on::text from public.contract_dues where payment_id = current_setting('ca.drw')::uuid),
  '10640.00/2026-11-14', 'The drawings payment is due 30 days after the approval');
select is((select expected_on::text || '/' || expected_on_adjusted::text from public.contract_payment_schedule
            where payment_id = current_setting('ca.mir')::uuid), '2026-11-20/2026-11-28',
  'MIR''s expected date moves by the consultant delay');
reset role;
select ok(exists (select 1 from public.notifications where notification_type = 'contract_due'
                   and recipient_user_id = '9a000000-0000-0000-0000-000000000002'), 'Finance is told a payment is due');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- ===== MIR in batches: a third, then the rest; the last takes the remainder =====
select lives_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-20', 33.333, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.mir')), 'A first MIR for a third of the work');
select throws_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-21', 70, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.mir')), '23514', null, 'Shares cannot pass 100%');
select lives_ok(format($$select public.contract_approval_record('%s', '%s', '2026-10-22', 66.667, null, null, null, null)$$,
  current_setting('ca.id'), current_setting('ca.mir')), 'The rest of the MIR');
select is((select array_agg(amount::text order by event_on) from public.contract_dues where payment_id = current_setting('ca.mir')::uuid),
  array['5319.95','10640.05'], 'The dues of a payment sum to it exactly');
select is((select share_due::text || '/' || amount_due::text from public.contract_payment_schedule where payment_id = current_setting('ca.mir')::uuid),
  '100.000/15960.00', 'The schedule shows the payment fully due');

-- ===== Direct writes are closed; another rep reads nothing =====
select throws_ok(format($$update public.contract_dues set amount = 1 where payment_id = '%s'$$, current_setting('ca.mir')),
  '42501', null, 'Dues change only through the RPCs');
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.contract_dues), 0, 'Another rep reads no due');

-- ===== Void =====
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select set_config('ca.appr', (select id::text from public.contract_approvals where payment_id = current_setting('ca.mir')::uuid order by approved_on desc limit 1), false);
select throws_ok(format($$select public.contract_approval_void('%s', 'typo')$$, current_setting('ca.appr')),
  '42501', null, 'The rep cannot void');
select set_config('request.jwt.claims','{"sub":"9a000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format($$select public.contract_approval_void('%s', 'Entered on the wrong deal')$$, current_setting('ca.appr')),
  'Finance voids an approval with a reason');
select is((select share_due::text from public.contract_payment_schedule where payment_id = current_setting('ca.mir')::uuid),
  '33.333', 'Its due no longer counts');
reset role;

select * from finish();
rollback;
