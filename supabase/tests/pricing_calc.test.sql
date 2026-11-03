-- Installation by type with modifiers; suggested extras must be decided.
-- Test user UUIDs use the 5d… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5d000000-0000-0000-0000-000000000003','authenticated','authenticated','pc-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5d000000-0000-0000-0000-000000000001','authenticated','authenticated','pc-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5d000000-0000-0000-0000-000000000004','authenticated','authenticated','pc-gm+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5d000000-%';
insert into public.user_roles (user_id, role) values
  ('5d000000-0000-0000-0000-000000000003','estimation_manager'),
  ('5d000000-0000-0000-0000-000000000001','salesperson'),
  ('5d000000-0000-0000-0000-000000000004','general_manager');

insert into public.installation_rates (install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over, height_threshold_m, floor_cut_add, scaffold_add)
values ('ceiling', 300, 5, 20, 50, 4, 0, 400), ('floor', 500, 0, null, 0, null, 250, 0), ('pylon', 900, 0, null, 0, null, 0, 0);
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
values ('concrete_base','Concrete base','قاعدة خرسانية','item',1200, array['pylon','floor']::public.install_type[]);
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_min_height_m)
values ('scaffold_hire','Scaffold hire','استئجار سقالة','lump',800, 6);
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate)
values ('crane_hire','Crane hire','استئجار رافعة','lump',2000);

insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('5d200000-0000-0000-0000-000000000001','pc-deal','5d000000-0000-0000-0000-000000000001','5d000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('5d400000-0000-0000-0000-000000000001','5d200000-0000-0000-0000-000000000001','pc-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('5d500000-0000-0000-0000-000000000001','5d400000-0000-0000-0000-000000000001',1);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('5d500000-0000-0000-0000-000000000001','Pylon P1',2,'pylon',null),
  ('5d500000-0000-0000-0000-000000000001','Ceiling C1',4,'ceiling',7);
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
values ('5d600000-0000-0000-0000-000000000001','5d200000-0000-0000-0000-000000000001','selling_build','5d500000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
-- The cost function answers cost holders only, so these run as the pricer.
select is(public.pricing_installation_cost('ceiling', 30, 6, false), 300 + 5*10 + 50*2 + 400::numeric,
  'Ceiling: base + weight over + height over + scaffold');
select is(public.pricing_installation_cost('floor', null, null, true), 750::numeric, 'Floor with cutting adds the cut');
select is(public.pricing_installation_cost('wall_screw', null, null, false), null::numeric, 'No rate in force gives null (falls back to %)');
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 2,
  'A pylon suggests a concrete base; a 7 m ceiling suggests a scaffold');
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 0, 'Suggesting again adds nothing');
select is(public.pricing_file_open_suggestions('5d600000-0000-0000-0000-000000000001'), 2, 'Two suggestions are open');
select throws_ok($$select public.pricing_decide_extra((select id from public.pricing_file_extras limit 1), false)$$,
  '23514', null, 'Dismissing needs a reason');

select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.pricing_file_extras), 0, 'Sales read no extras (they carry rates)');
select is(public.pricing_installation_cost('floor', null, null, true), null::numeric, 'A rep gets no installation cost (cost isolation)');
select throws_ok($$select public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001')$$, '42501', null, 'A rep cannot suggest extras');
select throws_ok($$select public.pricing_decide_extra('5d700000-0000-0000-0000-000000000001', true)$$, '42501', null, 'A rep cannot decide extras');
select throws_ok($$select public.pricing_file_open_suggestions('5d600000-0000-0000-0000-000000000001')$$, '42501', null, 'A rep cannot read the open-suggestion count');

-- Installation boundaries (pricer).
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is(public.pricing_installation_cost('ceiling', 10, 3, false), 300::numeric, 'Below the weight and height thresholds only the base applies');
reset role;
insert into public.installation_rates (install_type, base_rate, effective_from, effective_to)
values ('wall_screw', 100, current_date - 30, current_date - 1);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is(public.pricing_installation_cost('wall_screw', null, null, false), null::numeric, 'A rate that ended yesterday is not used');
select throws_ok($$select public.pricing_suggest_extras('5d600000-0000-0000-0000-0000000000ff')$$, '23514', 'Unknown pricing file. | ملف التسعير غير موجود.', 'Unknown file is its own error');
select throws_ok($$select public.pricing_decide_extra((select id from public.pricing_file_extras limit 1), true, -1)$$, '23514', null, 'A negative quantity is refused');

-- Accept path: the pricer accepts the scaffold with her own quantity and rate.
select is(public.pricing_decide_extra((select x.id from public.pricing_file_extras x join public.pricing_extras_catalog c on c.id = x.catalog_id where c.code = 'scaffold_hire'), true, 2, 1300)->>'status', 'accepted', 'The pricer accepts the scaffold with her own quantity and rate');
select ok(exists (select 1 from public.pricing_file_extras x join public.pricing_extras_catalog c on c.id = x.catalog_id
                   where c.code = 'scaffold_hire' and x.status = 'accepted' and x.quantity = 2 and x.rate = 1300
                     and x.decided_by = '5d000000-0000-0000-0000-000000000003'),
  'Accepting stores the quantity, rate and decider');
select is(public.pricing_file_open_suggestions('5d600000-0000-0000-0000-000000000001'), 1, 'One suggestion is still open');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.extra_decided'
                    and after_value->>'status' = 'accepted' and entity_id = '5d200000-0000-0000-0000-000000000001'),
  'Deciding an extra is audited');

-- Stale suggestions: the file moves to a new revision with a single 7 m ceiling line.
update public.boq_revisions set is_current = false where id = '5d500000-0000-0000-0000-000000000001';
insert into public.boq_revisions (id, boq_id, revision_number) values ('5d500000-0000-0000-0000-000000000002','5d400000-0000-0000-0000-000000000001',2);
insert into public.boq_lines (id, revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('5d510000-0000-0000-0000-000000000001','5d500000-0000-0000-0000-000000000002','Ceiling C2',1,'ceiling',7);
update public.pricing_files set boq_revision_id = '5d500000-0000-0000-0000-000000000002' where id = '5d600000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 0, 'Re-suggesting on the new revision adds nothing new');
select is((select count(*)::int from public.pricing_file_extras x join public.pricing_extras_catalog c on c.id = x.catalog_id where c.code = 'concrete_base'), 0,
  'The undecided pylon suggestion from the old revision is gone');
select is((select count(*)::int from public.pricing_file_extras x join public.pricing_extras_catalog c on c.id = x.catalog_id where c.code = 'scaffold_hire' and x.status = 'accepted'), 1,
  'A decided extra stays');

-- The GM builds the price, so the GM may suggest and decide extras too.
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001'), 0, 'The GM may ask for suggestions');
reset role;
insert into public.pricing_file_extras (id, file_id, catalog_id, rate, source_line_id)
select '5d700000-0000-0000-0000-000000000001', '5d600000-0000-0000-0000-000000000001', c.id, c.default_rate, '5d510000-0000-0000-0000-000000000001'
  from public.pricing_extras_catalog c where c.code = 'crane_hire';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_decide_extra('5d700000-0000-0000-0000-000000000001', false, null, null, 'Client supplies the crane')->>'status', 'dismissed',
  'The GM can decide an extra in selling_build');
reset role;
select is((select after_value->>'dismiss_reason' from public.audit_log where action = 'pricing_file.extra_decided' and after_value->>'status' = 'dismissed'),
  'Client supplies the crane', 'The audit payload carries the dismiss reason');

-- Once the price is under review the extras are locked.
update public.pricing_files set state = 'price_review' where id = '5d600000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"5d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.pricing_decide_extra('5d700000-0000-0000-0000-000000000001', true)$$, 'P0001', null, 'Deciding is locked in price_review');
select throws_ok($$select public.pricing_suggest_extras('5d600000-0000-0000-0000-000000000001')$$, 'P0001', null, 'Suggesting is locked in price_review');
reset role;
select * from finish();
rollback;
