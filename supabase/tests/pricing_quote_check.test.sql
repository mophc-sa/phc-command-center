-- PR 5: the supplier quote check. Rules, not a model: a line with no price, a
-- screen line with no screen price, a quantity that differs from the BOQ, a
-- written spec difference. (A quote in another currency than the BOQ is refused
-- by the 7B guard, so it never reaches the check.) Zayed is told on submit; the
-- check lists the lines; nothing moves a file or a price.
-- Users: 1 rep, 2 estimation + finance (Zayed), 3 GM, 4 a second estimator. Test user UUIDs use the 8d… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8d000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','qc-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '8d000000-%';
insert into public.user_roles (user_id, role) values
  ('8d000000-0000-0000-0000-000000000001','salesperson'),
  ('8d000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8d000000-0000-0000-0000-000000000002','finance_manager'),
  ('8d000000-0000-0000-0000-000000000003','general_manager'),
  ('8d000000-0000-0000-0000-000000000004','estimation_manager');
insert into public.vendors (id, name) values ('8d100000-0000-0000-0000-000000000001','qc-vendor');

-- Deal 1: four lines, one issue each, plus one clean line. Deal 2: a clean quote.
insert into public.opportunities (id, project_name, project_code, owner_id, created_by, sales_stage)
select ('8d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'qc-deal-' || n, 'QC-26-000' || n,
       '8d000000-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8d40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8d20000' || n || '-0000-0000-0000-000000000001')::uuid, 'qc-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8d50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8d40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, has_screen) values
  ('8d510001-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',1,'Pylon P1',2,false),
  ('8d510002-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',2,'Screen S1',1,true),
  ('8d510003-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',3,'Wall W1',5,false),
  ('8d510004-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',4,'Wall W2',1,false),
  ('8d510005-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001',5,'Wall W3',1,false),
  ('8d510006-0000-0000-0000-000000000001','8d500002-0000-0000-0000-000000000001',1,'Wall W4',1,false);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status) values
  ('8d520001-0000-0000-0000-000000000001','8d500001-0000-0000-0000-000000000001','8d100000-0000-0000-0000-000000000001','SAR','responses_received'),
  ('8d520002-0000-0000-0000-000000000001','8d500002-0000-0000-0000-000000000001','8d100000-0000-0000-0000-000000000001','SAR','responses_received');
-- Line 1 has no quote line at all; line 2 has no screen price; line 3 quotes 4 of 5;
-- line 4 writes a spec difference; line 5 is clean.
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen, alternate_spec) values
  ('8d520001-0000-0000-0000-000000000001','8d510002-0000-0000-0000-000000000001',1000,1,1000,null,null),
  ('8d520001-0000-0000-0000-000000000001','8d510003-0000-0000-0000-000000000001',100,4,400,null,null),
  ('8d520001-0000-0000-0000-000000000001','8d510004-0000-0000-0000-000000000001',300,1,300,null,'Aluminium instead of stainless'),
  ('8d520001-0000-0000-0000-000000000001','8d510005-0000-0000-0000-000000000001',200,1,200,null,'  '),
  ('8d520002-0000-0000-0000-000000000001','8d510006-0000-0000-0000-000000000001',500,1,500,null,null);
update public.boq_revisions set frozen_at = now(), frozen_by = '8d000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '8d50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
select ('8d60000' || n || '-0000-0000-0000-000000000001')::uuid, ('8d20000' || n || '-0000-0000-0000-000000000001')::uuid,
       'at_supplier', ('8d50000' || n || '-0000-0000-0000-000000000001')::uuid
  from generate_series(1,2) n;

-- ===== Who may run the check =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select * from public.pricing_quote_check('8d600001-0000-0000-0000-000000000001')$$,
  '42501', null, 'A rep cannot run the quote check');

-- ===== The rules =====
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select array_agg(line_number || ':' || array_to_string(issues, '+') order by line_number)
             from public.pricing_quote_check('8d600001-0000-0000-0000-000000000001')),
  array['1:no_price','2:screen_price_missing','3:quantity_differs','4:spec_differs'],
  'Each rule finds its line, and a clean line (or a blank spec note) is not listed');
select is((select spec_note from public.pricing_quote_check('8d600001-0000-0000-0000-000000000001') where line_number = 4),
  'Aluminium instead of stainless', 'The supplier''s own spec note comes with the line');
select is((select quoted_quantity::text || '/' || boq_quantity::text from public.pricing_quote_check('8d600001-0000-0000-0000-000000000001') where line_number = 3),
  '4.000/5.000', 'Both quantities come with a quantity difference');
select is((select count(*)::int from public.pricing_quote_check('8d600002-0000-0000-0000-000000000001')), 0,
  'A complete quote has no issue');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
                       and table_name = 'pricing_quote_check' and column_name ~ 'cost|price$'),
  'The check carries no price column');

-- ===== The GM, a cost reader, may run it too =====
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_quote_check('8d600001-0000-0000-0000-000000000001')), 4,
  'The GM sees the same four lines');

-- ===== On submit, Zayed is told the counts =====
-- Another estimator records the supplier's prices (nobody is notified of their own move).
select set_config('request.jwt.claims','{"sub":"8d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_move('8d600001-0000-0000-0000-000000000001','supplier_priced')$$,
  'The supplier has priced deal 1');
select lives_ok($$select public.pricing_file_move('8d600002-0000-0000-0000-000000000001','supplier_priced')$$,
  'And deal 2');
reset role;
select is((select body from public.notifications where notification_type = 'pricing_quote_check'
            and recipient_user_id = '8d000000-0000-0000-0000-000000000002'
            and entity_id = '8d200001-0000-0000-0000-000000000001'),
  'Quote check: 4 lines need attention (1 without a price, 1 missing the screen price, 1 quantity differs, 1 spec differs). | فحص عرض المورد: 4 بنود تحتاج مراجعة (1 بلا سعر، 1 بلا سعر الشاشة، 1 كمية مختلفة، 1 مواصفة مختلفة).',
  'Zayed gets the counts for deal 1');
select is((select body from public.notifications where notification_type = 'pricing_quote_check'
            and recipient_user_id = '8d000000-0000-0000-0000-000000000002'
            and entity_id = '8d200002-0000-0000-0000-000000000001'),
  'Quote check: every line is priced as asked. | فحص عرض المورد: كل البنود مسعّرة كما طُلب.',
  'And a clean result for deal 2');
select ok(not exists (select 1 from public.notifications where notification_type = 'pricing_quote_check'
                       and recipient_user_id in ('8d000000-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000003')),
  'Only estimation and finance get the check');

select * from finish();
rollback;
