-- PR 2, part 3: settings stores (fallback %, default margin, in-force dates,
-- installation rate changes, margin floor) and the file's pricing inputs.
-- Test user UUIDs use the 6c… prefix. Every session carries aal2 unless a test says otherwise.
-- Users: 1 rep, 2 estimation+finance (Zayed), 3 GM (Kalas), 4 BD, 5 sales manager,
--        6 estimation only, 7 finance only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6c000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','si-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,7) n;
update public.profiles set status = 'active' where id::text like '6c000000-%';
insert into public.user_roles (user_id, role) values
  ('6c000000-0000-0000-0000-000000000001','salesperson'),
  ('6c000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6c000000-0000-0000-0000-000000000002','finance_manager'),
  ('6c000000-0000-0000-0000-000000000003','general_manager'),
  ('6c000000-0000-0000-0000-000000000004','bd_manager'),
  ('6c000000-0000-0000-0000-000000000005','sales_manager'),
  ('6c000000-0000-0000-0000-000000000006','estimation_manager'),
  ('6c000000-0000-0000-0000-000000000007','finance_manager');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'si-deal-' || n,
       '6c000000-0000-0000-0000-000000000001','6c000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.pricing_files (id, opportunity_id, state) values
  ('6c600001-0000-0000-0000-000000000001','6c200001-0000-0000-0000-000000000001','boq_frozen'),
  ('6c600002-0000-0000-0000-000000000001','6c200002-0000-0000-0000-000000000001','received');
-- File 1 has a BOQ revision with one line, so a cinema flag can suggest extras.
insert into public.boqs (id, related_opportunity_id, title)
values ('6c400001-0000-0000-0000-000000000001','6c200001-0000-0000-0000-000000000001','si-boq');
insert into public.boq_revisions (id, boq_id, revision_number)
values ('6c500001-0000-0000-0000-000000000001','6c400001-0000-0000-0000-000000000001',1);
insert into public.boq_lines (id, revision_id, sign_type, quantity)
values ('6c700001-0000-0000-0000-000000000001','6c500001-0000-0000-0000-000000000001','si-sign',1);
update public.pricing_files set boq_revision_id = '6c500001-0000-0000-0000-000000000001'
 where id = '6c600001-0000-0000-0000-000000000001';
-- An older floor, so the first change closes it.
insert into public.margin_policies (min_margin_pct, effective_from, rationale)
values (5, now() - interval '30 days', 'si-old');

-- ===== Logistics rates and the two new defaults =====
select is((select value from public.logistics_rates where key = 'install_fallback_pct'), 10::numeric, 'The fallback % is seeded at 10');
select is((select value from public.logistics_rates where key = 'default_margin_pct'), 25::numeric, 'The default margin is seeded at 25');
-- The stamp trigger keeps effective_from unless the value changes, so the fixture switches it off to back-date.
alter table public.logistics_rates disable trigger logistics_rates_stamp;
update public.logistics_rates set effective_from = current_date - 10 where key in ('install_fallback_pct','default_margin_pct');
alter table public.logistics_rates enable trigger logistics_rates_stamp;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
update public.logistics_rates set value = 12 where key = 'install_fallback_pct';
select is((select effective_from from public.logistics_rates where key = 'install_fallback_pct'), current_date,
  'A new value is in force from today');
update public.logistics_rates set note = 'confirmed with Kalas' where key = 'default_margin_pct';
select is((select effective_from from public.logistics_rates where key = 'default_margin_pct'), current_date - 10,
  'A note alone does not change the in-force date');
select throws_ok($$update public.logistics_rates set value = 150 where key = 'default_margin_pct'$$,
  '23514', null, 'A margin of 100% or more is refused');
-- Mo 2026-11-03: the default margin is Kalas'/Zayed's (GM or finance); other keys stay any pricer's.
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.logistics_rates set value = 40 where key = 'default_margin_pct'$$,
  '42501', null, 'An estimation-only pricer cannot change the default margin');
select lives_ok($$update public.logistics_rates set value = 11 where key = 'install_fallback_pct'$$,
  'An estimation-only pricer can change the installation fallback %');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.logistics_rates set value = 30 where key = 'default_margin_pct'$$,
  'Finance changes the default margin');
select is((select value from public.logistics_rates where key = 'default_margin_pct'), 30::numeric,
  'The default margin really changed');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.logistics_rates set value = 99 where key = 'default_margin_pct'$$,
  'A BD manager update is accepted as a statement');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select value from public.logistics_rates where key = 'default_margin_pct'), 30::numeric,
  'The BD manager update changed nothing');
select lives_ok($$update public.logistics_rates set value = 28 where key = 'default_margin_pct'$$,
  'Kalas changes the default margin');
select is((select value from public.logistics_rates where key = 'default_margin_pct'), 28::numeric,
  'The default margin is now 28');
select throws_ok($$update public.logistics_rates set value = 1 where key = 'container_rate'$$,
  '42501', null, 'Kalas is not a pricer: cost rates stay with estimation and finance');

-- ===== Catalog =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_if_cinema)
                  values ('si_acoustic','Acoustic insulation','عزل صوتي','m2',150,true)$$,
  'A pricer adds a cinema-only extra');
select is((select effective_from from public.pricing_extras_catalog where code = 'si_acoustic'), current_date,
  'It is in force from today');
reset role;
alter table public.pricing_extras_catalog disable trigger pricing_extras_catalog_stamp;
update public.pricing_extras_catalog set effective_from = current_date - 5 where code = 'si_acoustic';
alter table public.pricing_extras_catalog enable trigger pricing_extras_catalog_stamp;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
update public.pricing_extras_catalog set default_rate = 175 where code = 'si_acoustic';
select is((select effective_from from public.pricing_extras_catalog where code = 'si_acoustic'), current_date,
  'A new default rate is in force from today');

-- ===== Installation rates change on a date =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date, 900)$$,
  '42501', null, 'A rep cannot set rates');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date - 1, 900)$$,
  '23514', null, 'A new rate cannot start in the past');
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date, -1)$$,
  '23514', null, 'A negative rate is refused');
select lives_ok($$select public.pricing_set_installation_rate('pylon', current_date, 900)$$, 'The first pylon rate starts today');
select lives_ok($$select public.pricing_set_installation_rate('pylon', current_date + 10, 950)$$, 'A new pylon rate starts in ten days');
select is((select effective_to from public.installation_rates where install_type = 'pylon' and effective_from = current_date),
  current_date + 10, 'The current rate ends when the new one starts');
select lives_ok($$select public.pricing_set_installation_rate('pylon', current_date + 10, 975)$$, 'Same start date: a correction');
select is((select count(*)::int || '/' || max(base_rate)::text from public.installation_rates where install_type = 'pylon'),
  '2/975.00', 'The correction replaced the figure, not added a row');
select throws_ok($$select public.pricing_set_installation_rate('pylon', current_date + 5, 960)$$,
  'P0001', null, 'A rate cannot start before a later one already set');

-- ===== Margin floor (Kalas or finance; not an estimation-only pricer) =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_margin_floor(12, 'Board decision')$$, '42501', null, 'An estimation-only pricer cannot set the floor');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_margin_floor(12, 'Board decision')$$, '42501', null, 'A BD manager cannot set the floor');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_margin_floor(12, 'Board decision')$$, '42501', null, 'A rep cannot set the floor');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.pricing_set_margin_floor(12, 'Board decision')$$, '42501', null, 'Finance without MFA (aal1) cannot set the floor');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
select throws_ok($$select public.pricing_set_margin_floor(12, 'Board decision')$$, '42501', null, 'Nor can a session with no aal claim at all');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_set_margin_floor(12, ' ')$$, '23514', null, 'The floor needs a reason');
select is((public.pricing_set_margin_floor(12, 'Board decision'))->>'min_margin_pct', '12.00', 'Kalas sets the floor to 12%');
select is(public.current_margin_floor(), 12.00::numeric, 'It is the floor in force');
select is((public.pricing_set_margin_floor(15, 'Board decision, corrected'))->>'min_margin_pct', '15.00', 'A second change the same moment corrects it');
select is((select count(*)::int from public.margin_policies where effective_to is null), 1, 'One floor is open; the old one was closed');
select is((select effective_to from public.margin_policies where rationale = 'si-old'),
          (select effective_from from public.margin_policies where effective_to is null),
  'The closed floor ends exactly where the new one starts (no gap, no overlap)');
-- The floor moves only through the call (rationale, audit, contiguity); a direct write is refused.
select throws_ok($$insert into public.margin_policies (min_margin_pct, effective_from, rationale, created_by)
                   values (9, now() + interval '1 day', 'si-direct', '6c000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'Kalas cannot insert a floor directly');
select throws_ok($$update public.margin_policies set rationale = 'si-direct' where effective_to is null$$,
  '42501', null, 'Nor edit one directly');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_set_margin_floor(18, 'Finance review'))->>'min_margin_pct', '18.00', 'Finance sets the floor');
select is(public.current_margin_floor(), 18.00::numeric, 'The finance change is the floor in force');

-- ===== The UI's margin right (pricing_my_rights) =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights()->'can_set_margins', 'false'::jsonb, 'Estimation only: no margin rights');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights()->'can_set_margins', 'true'::jsonb, 'Finance: margin rights');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_my_rights()->'can_set_margins', 'true'::jsonb, 'The GM: margin rights');

-- ===== The file's inputs =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"containers":1}')$$,
  '42501', null, 'A rep cannot set pricing inputs');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"containers":2,"delivery":"riyadh","clearing":true}'))->>'delivery',
  'riyadh', 'Zayed sets the logistics inputs once the BOQ is frozen');
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"default_margin_pct":20}')$$,
  '42501', null, 'Zayed cannot set the file''s margin (a selling input: the GM''s)');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000007","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"default_margin_pct":20}')$$,
  '42501', null, 'Finance alone cannot set the file''s margin either');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"containers":"two"}')$$,
  '23514', null, 'A wrong type is refused');
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"containers":1000000}')$$,
  '23514', null, 'An out-of-range number is refused');
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"discount":5}')$$,
  '23514', null, 'An unknown input is refused');
select throws_ok($$select public.pricing_file_set_inputs('6c600002-0000-0000-0000-000000000001','{"containers":1}')$$,
  'P0001', null, 'Inputs wait until the BOQ is frozen');
-- The cinema flag is stored. It has no suggestion effect yet: the suggester reads it from Task 4 on.
select is((public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"is_cinema":true}'))->>'is_cinema',
  'true', 'The cinema flag is stored on the file');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"default_margin_pct":20}')$$,
  'P0001', null, 'The margin is set in the selling build');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6c600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_file_set_inputs('6c600001-0000-0000-0000-000000000001','{"default_margin_pct":22}'))->>'default_margin_pct',
  '22.00', 'Kalas sets the file''s default margin');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_inputs), 0, 'A rep reads no inputs (they carry the margin)');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*)::int from public.pricing_file_inputs where file_id = '6c600001-0000-0000-0000-000000000001'), 1,
  'The sales manager reads them');

-- ===== An MFA-role session with no aal claim fails closed (never NULL) =====
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
select is(public.has_app_access('6c000000-0000-0000-0000-000000000007'), false, 'Finance, no aal claim: has_app_access is false, not NULL');
select is(public.is_pricer('6c000000-0000-0000-0000-000000000007'), false, 'Finance, no aal claim: not a pricer');
select is(public.can_read_commercial_cost('6c000000-0000-0000-0000-000000000007'), false, 'Finance, no aal claim: cannot read cost');
select is(public.is_active_user('6c000000-0000-0000-0000-000000000007'), false, 'Finance, no aal claim: not an active user');
select throws_ok($$select public.pricing_file_move('6c600002-0000-0000-0000-000000000001','package_review')$$,
  '42501', null, 'Finance, no aal claim: a PR 1 RPC refuses the call');
select set_config('request.jwt.claims','{"sub":"6c000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is(public.has_app_access('6c000000-0000-0000-0000-000000000003'), false, 'GM, no aal claim: has_app_access is false, not NULL');
select is(public.can_approve_final_price('6c000000-0000-0000-0000-000000000003'), false, 'GM, no aal claim: cannot approve the final price');
select is(public.can_set_pricing_margins('6c000000-0000-0000-0000-000000000003'), false, 'GM, no aal claim: cannot set margins');
select throws_ok($$select public.pricing_file_move('6c600002-0000-0000-0000-000000000001','package_review')$$,
  '42501', null, 'GM, no aal claim: a PR 1 RPC refuses the call');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'margin_policy.set'
                   and actor_id = '6c000000-0000-0000-0000-000000000007'), 'The floor change by finance is audited');
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.inputs_set'
                   and entity_id = '6c200001-0000-0000-0000-000000000001'), 'Setting inputs is audited');
select * from finish();
rollback;
