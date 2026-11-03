-- Kalas sets the price, Zayed reviews it; the file follows.
-- Test user UUIDs use the 5e… prefix. GM and finance sessions carry aal2 (MFA).
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000003','authenticated','authenticated','g1-finance+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000004','authenticated','authenticated','g1-gm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000005','authenticated','authenticated','g1-delegate+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000006','authenticated','authenticated','g1-bd+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000007','authenticated','authenticated','g1-finance-delegate+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5e000000-0000-0000-0000-000000000001','authenticated','authenticated','g1-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5e000000-%';
insert into public.user_roles (user_id, role) values
  ('5e000000-0000-0000-0000-000000000003','finance_manager'),
  ('5e000000-0000-0000-0000-000000000003','estimation_manager'),
  ('5e000000-0000-0000-0000-000000000004','general_manager'),
  ('5e000000-0000-0000-0000-000000000005','bd_manager'),
  ('5e000000-0000-0000-0000-000000000006','bd_manager'),
  ('5e000000-0000-0000-0000-000000000007','finance_manager'),
  ('5e000000-0000-0000-0000-000000000001','salesperson');
-- A GM delegate who is not a cost holder: can move prices, cannot read extras.
insert into public.price_authority_delegations (grantor_id, grantee_id, reason, starts_at, expires_at)
values ('5e000000-0000-0000-0000-000000000004','5e000000-0000-0000-0000-000000000005','g1 cover',
        now() - interval '1 hour', now() + interval '1 day');

-- Deals 1..7 each have one pricing file; deal 1 also carries prices outside any file.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('5e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'g1-deal-' || n,
       '5e000000-0000-0000-0000-000000000001','5e000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,7) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('5e40000' || n || '-0000-0000-0000-000000000001')::uuid, ('5e20000' || n || '-0000-0000-0000-000000000001')::uuid, 'g1-boq-' || n
  from generate_series(1,7) n;
insert into public.boq_revisions (id, boq_id, revision_number, frozen_at, frozen_by, status)
select ('5e50000' || n || '-0000-0000-0000-000000000001')::uuid, ('5e40000' || n || '-0000-0000-0000-000000000001')::uuid, 1,
       now(), '5e000000-0000-0000-0000-000000000003','verified'
  from generate_series(1,7) n;
insert into public.estimations (id, boq_revision_id, cost_total)
select ('5e70000' || n || '-0000-0000-0000-000000000001')::uuid, ('5e50000' || n || '-0000-0000-0000-000000000001')::uuid, 100000
  from generate_series(1,7) n;
-- 1: Kalas has set the price (proposed_by = GM). 2: under review. 3: proposed by
-- estimation, not by Kalas. 4: walked the old chain to finance review in a file.
-- 5: set, but its file is not yet in the selling build. 6: under review while its
-- file is still in the selling build. 7: drafted by estimation, for the finance
-- delegate. 9, 10: outside any pricing file.
insert into public.internal_prices (id, estimation_id, proposed_price, status, proposed_by) values
  ('5e800001-0000-0000-0000-000000000001','5e700001-0000-0000-0000-000000000001', 140000, 'internal_price_proposed', '5e000000-0000-0000-0000-000000000004'),
  ('5e800002-0000-0000-0000-000000000001','5e700002-0000-0000-0000-000000000001', 140000, 'gm_pending',              '5e000000-0000-0000-0000-000000000004'),
  ('5e800003-0000-0000-0000-000000000001','5e700003-0000-0000-0000-000000000001', 140000, 'internal_price_proposed', '5e000000-0000-0000-0000-000000000003'),
  ('5e800004-0000-0000-0000-000000000001','5e700004-0000-0000-0000-000000000001', 140000, 'finance_review',          '5e000000-0000-0000-0000-000000000004'),
  ('5e800005-0000-0000-0000-000000000001','5e700005-0000-0000-0000-000000000001', 140000, 'internal_price_proposed', '5e000000-0000-0000-0000-000000000004'),
  ('5e800006-0000-0000-0000-000000000001','5e700006-0000-0000-0000-000000000001', 140000, 'gm_pending',              '5e000000-0000-0000-0000-000000000004'),
  ('5e800007-0000-0000-0000-000000000001','5e700007-0000-0000-0000-000000000001', 140000, 'internal_price_proposed', '5e000000-0000-0000-0000-000000000003'),
  ('5e800009-0000-0000-0000-000000000001','5e700001-0000-0000-0000-000000000001', 140000, 'internal_price_proposed', '5e000000-0000-0000-0000-000000000003'),
  ('5e800010-0000-0000-0000-000000000001','5e700001-0000-0000-0000-000000000001', 140000, 'gm_pending',              '5e000000-0000-0000-0000-000000000004');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id, estimation_id, internal_price_id)
select ('5e60000' || n || '-0000-0000-0000-000000000001')::uuid, ('5e20000' || n || '-0000-0000-0000-000000000001')::uuid,
       (case n when 2 then 'price_review' when 5 then 'supplier_priced' else 'selling_build' end)::public.pricing_file_state,
       ('5e50000' || n || '-0000-0000-0000-000000000001')::uuid, ('5e70000' || n || '-0000-0000-0000-000000000001')::uuid,
       ('5e80000' || n || '-0000-0000-0000-000000000001')::uuid
  from generate_series(1,7) n;
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate)
values ('5e900000-0000-0000-0000-000000000001','crane_hire','Crane hire','رافعة','lump',2000);
insert into public.pricing_file_extras (file_id, catalog_id, rate) values ('5e600001-0000-0000-0000-000000000001','5e900000-0000-0000-0000-000000000001',2000);

-- ===== Kalas proposes; an open suggestion blocks it, whoever can see it =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_extras), 0, 'The delegate cannot see the file''s extras');
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'A delegate who cannot see the extras is still blocked by an open suggestion');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Proposing is blocked while a suggestion is open');
reset role;
update public.pricing_file_extras set status = 'accepted';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800001-0000-0000-0000-000000000001'$$,
  '42501', null, 'Zayed cannot propose: the GM sets the price');

select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'Kalas proposes his price');
select is((select state::text from public.pricing_files where id = '5e600001-0000-0000-0000-000000000001'), 'price_review',
  'The file goes to Zayed''s price review');
select throws_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800001-0000-0000-0000-000000000001'$$,
  '42501', null, 'Kalas cannot approve his own price in a pricing file');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800001-0000-0000-0000-000000000001'$$,
  '42501', null, 'A GM delegate cannot approve a price in a pricing file either: that is finance''s review');

-- ===== Zayed reviews =====
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set proposed_price = 130000 where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'A price under review cannot be changed');
select throws_ok($$update public.internal_prices set proposed_by = '5e000000-0000-0000-0000-000000000005' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Who proposed a price under review cannot be rewritten');
select throws_ok($$update public.internal_prices set below_floor_justification = 'Strategic client' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'The floor justification of a price under review cannot be changed');
select throws_ok($$update public.internal_prices set status = 'gm_approved', below_floor_justification = 'Strategic client' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'The approval cannot carry a different floor justification');
select throws_ok($$update public.internal_prices set status = 'gm_approved', proposed_at = now() - interval '1 day' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'The approval cannot rewrite when the price was proposed');
select throws_ok($$update public.internal_prices set status = 'gm_approved', proposed_price = 120000 where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'The approval cannot carry a different price than the one Kalas set');
select lives_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800001-0000-0000-0000-000000000001'$$,
  'Zayed approves the price Kalas set');
select is((select state::text from public.pricing_files where id = '5e600001-0000-0000-0000-000000000001'), 'approved',
  'The file follows to approved');
select is((select gm_decided_by::text from public.internal_prices where id = '5e800001-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000004', 'The decision is recorded as Kalas''s price, reviewed by Zayed');
select is((select finance_reviewed_by::text from public.internal_prices where id = '5e800001-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000003', 'Zayed''s review is stamped from the session');

-- ===== An approved price is final: it is what gets quoted =====
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set proposed_price = 150000 where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Kalas cannot edit the price once Zayed has approved it');
select throws_ok($$update public.internal_prices set status = 'returned', return_reason = 'x', proposed_price = 150000 where id = '5e800001-0000-0000-0000-000000000001'$$,
  '42501', null, 'An approved price cannot be moved and repriced in one statement');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select throws_ok($$update public.internal_prices set proposed_price = 150000 where id = '5e800001-0000-0000-0000-000000000001'$$,
  'P0001', null, 'A pipeline operator cannot edit an approved price either');

-- ===== In a file, only the GM or a pricer edits the price =====
select throws_ok($$update public.internal_prices set proposed_price = 135000 where id = '5e800005-0000-0000-0000-000000000001'$$,
  '42501', null, 'A pipeline operator cannot edit a proposed price in a pricing file');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set proposed_price = 145000 where id = '5e800005-0000-0000-0000-000000000001'$$,
  'Kalas edits the price he is setting');
select is((select proposed_price from public.internal_prices where id = '5e800005-0000-0000-0000-000000000001'), 145000::numeric,
  'Kalas''s edit is kept');

-- ===== Propose from the selling build, approve in price review =====
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800005-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Kalas cannot propose before the file reaches the selling build');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800006-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Zayed cannot approve while the file is not in price review');

-- ===== Inside a file, the old commercial review is not a way in =====
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select throws_ok($$update public.internal_prices set status = 'commercial_review' where id = '5e800007-0000-0000-0000-000000000001'$$,
  '23514', null, 'In a pricing file a proposed price cannot go to commercial review');

-- ===== Returns: finance or the proposer, nobody else =====
select throws_ok($$update public.internal_prices set status = 'returned', return_reason = 'x' where id = '5e800005-0000-0000-0000-000000000001'$$,
  '42501', null, 'A pipeline operator cannot return a price in a pricing file');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'returned', return_reason = 'Rechecking line 4' where id = '5e800006-0000-0000-0000-000000000001'$$,
  'Kalas takes back his own price');
select is((select gm_decided_by::text from public.internal_prices where id = '5e800006-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000004', 'Kalas''s return of his own price is stamped as his decision');

-- ===== A finance user who also holds the authority never approves his own price =====
reset role;
update public.price_authority_delegations set revoked_at = now(), revoked_by = '5e000000-0000-0000-0000-000000000004'
 where grantee_id = '5e000000-0000-0000-0000-000000000005';
insert into public.price_authority_delegations (grantor_id, grantee_id, reason, starts_at, expires_at)
values ('5e000000-0000-0000-0000-000000000004','5e000000-0000-0000-0000-000000000007','g1 cover by finance',
        now() - interval '1 hour', now() + interval '1 day');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800007-0000-0000-0000-000000000001'$$,
  'The finance delegate proposes as the authority');
select throws_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800007-0000-0000-0000-000000000001'$$,
  '42501', null, 'The finance delegate cannot approve the price he proposed');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800007-0000-0000-0000-000000000001'$$,
  'A different finance user approves it');
select is((select gm_decided_by::text || ' / ' || finance_reviewed_by::text from public.internal_prices where id = '5e800007-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000007 / 5e000000-0000-0000-0000-000000000003', 'The delegate''s price, the other finance user''s review');
reset role;
select is((select count(*)::int from public.audit_log where entity_type = 'internal_price'
            and entity_id = '5e800007-0000-0000-0000-000000000001' and action = 'internal_price.gm_pending'
            and actor_id = '5e000000-0000-0000-0000-000000000007'
            and after_value->>'from' = 'internal_price_proposed' and (after_value->>'proposed_price')::numeric = 140000),
  1, 'The propose is audited once, by its actor');
select is((select count(*)::int from public.audit_log where entity_type = 'internal_price'
            and entity_id = '5e800007-0000-0000-0000-000000000001' and action = 'internal_price.gm_approved'
            and actor_id = '5e000000-0000-0000-0000-000000000003' and after_value->>'to' = 'gm_approved'),
  1, 'The approval is audited once, by its actor');
set local role authenticated;

-- ===== Lines sent back to the supplier from price review (the Task 2 branch) =====
select lives_ok($$select public.pricing_file_move('5e600002-0000-0000-0000-000000000001', 'at_supplier', 'Line 3 missing screen')$$,
  'The pricer sends lines back to the supplier from price review');
select is((select state::text from public.pricing_files where id = '5e600002-0000-0000-0000-000000000001'), 'at_supplier',
  'The file stays at the supplier; the returned price does not pull it to selling build');
select is((select status::text || ' / ' || return_reason from public.internal_prices where id = '5e800002-0000-0000-0000-000000000001'),
  'returned / Line 3 missing screen', 'Kalas''s price is returned with the pricer''s note');

-- ===== The proposer is the session, and a return sends the file back =====
-- Kalas's propose is the move to gm_pending, so the Phase 8 floor still applies.
reset role;
insert into public.margin_policies (id, min_margin_pct, effective_from)
values ('5ea00000-0000-0000-0000-000000000001', 30, now() - interval '1 day');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800003-0000-0000-0000-000000000001'$$,
  '23514', null, 'A propose below the margin floor without a justification is refused');
reset role;
update public.margin_policies set effective_to = now() - interval '1 minute' where id = '5ea00000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800003-0000-0000-0000-000000000001'$$,
  'Kalas proposes a price estimation had drafted');
select is((select proposed_by::text from public.internal_prices where id = '5e800003-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000004', 'Kalas''s propose stamps him as the proposer');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'returned', return_reason = 'Margin too thin on line 2' where id = '5e800003-0000-0000-0000-000000000001'$$,
  'Zayed returns the price');
select is((select finance_reviewed_by::text || ' / ' || coalesce(gm_decided_by::text, 'none') from public.internal_prices where id = '5e800003-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000003 / none', 'Zayed''s return is his review; the GM decided nothing');
select is((select state::text from public.pricing_files where id = '5e600003-0000-0000-0000-000000000001'), 'selling_build',
  'The file goes back to Kalas''s selling build');
select is((select note from public.pricing_file_events where file_id = '5e600003-0000-0000-0000-000000000001' and to_state = 'selling_build'),
  'Margin too thin on line 2', 'The file event carries the return reason');
select lives_ok($$update public.internal_prices set status = 'internal_price_proposed', proposed_by = '5e000000-0000-0000-0000-000000000004' where id = '5e800003-0000-0000-0000-000000000001'$$,
  'Zayed puts the returned price back up');
select is((select proposed_by::text from public.internal_prices where id = '5e800003-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000003', 'In a file the proposer of a re-proposal is the session, not the payload');

-- ===== In a pricing file, the only way to review is Kalas's propose =====
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800004-0000-0000-0000-000000000001'$$,
  '23514', null, 'In a pricing file the old chain cannot reach review: the GM proposes');

-- ===== A new price starts as a draft or a proposal =====
select throws_ok($$insert into public.internal_prices (estimation_id, proposed_price, status) values ('5e700001-0000-0000-0000-000000000001', 140000, 'gm_approved')$$,
  '42501', null, 'Estimation cannot insert an approved price');
select lives_ok($$insert into public.internal_prices (estimation_id, proposed_price) values ('5e700001-0000-0000-0000-000000000001', 140000)$$,
  'Estimation inserts a draft price');
select lives_ok($$insert into public.internal_prices (estimation_id, proposed_price, status) values ('5e700001-0000-0000-0000-000000000001', 140000, 'internal_price_proposed')$$,
  'Estimation inserts a proposed price');

-- ===== Outside pricing files, Phase 7A is unchanged =====
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set gm_decided_by = '5e000000-0000-0000-0000-000000000004' where id = '5e800009-0000-0000-0000-000000000001'$$,
  'P0001', null, 'A review stamp cannot be written by an edit that is not a move');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '5e800009-0000-0000-0000-000000000001'$$,
  '23514', null, 'Outside a pricing file the GM cannot skip commercial and finance review');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800010-0000-0000-0000-000000000001'$$,
  '42501', null, 'Outside a pricing file finance cannot approve');
select set_config('request.jwt.claims','{"sub":"5e000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_approved' where id = '5e800010-0000-0000-0000-000000000001'$$,
  'Outside a pricing file the GM approves, as before');
select is((select gm_decided_by::text from public.internal_prices where id = '5e800010-0000-0000-0000-000000000001'),
  '5e000000-0000-0000-0000-000000000004', 'Outside a pricing file the GM''s decision is stamped as before');
reset role;
select * from finish();
rollback;
