-- Installation by type with modifiers; suggested extras must be decided.
-- Test user UUIDs use the 5d… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','5d000000-0000-0000-0000-000000000003','authenticated','authenticated','pc-pricer+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','5d000000-0000-0000-0000-000000000001','authenticated','authenticated','pc-rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '5d000000-%';
insert into public.user_roles (user_id, role) values
  ('5d000000-0000-0000-0000-000000000003','estimation_manager'),
  ('5d000000-0000-0000-0000-000000000001','salesperson');

insert into public.installation_rates (install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over, height_threshold_m, floor_cut_add, scaffold_add)
values ('ceiling', 300, 5, 20, 50, 4, 0, 400), ('floor', 500, 0, null, 0, null, 250, 0), ('pylon', 900, 0, null, 0, null, 0, 0);
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
values ('concrete_base','Concrete base','قاعدة خرسانية','item',1200, array['pylon','floor']::public.install_type[]);
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_min_height_m)
values ('scaffold_hire','Scaffold hire','استئجار سقالة','lump',800, 6);

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
reset role;
select * from finish();
rollback;
