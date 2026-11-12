-- PR 4, part 3: a client change opens the next round on a fresh copy of the BOQ.
-- Fixture: PR 2's worked example, approved and quoted (Rev 0 issued).
-- Users: 1 rep, 2 estimation + finance (Zayed), 3 GM (Kalas), 4 BD manager (Marie).
-- Test user UUIDs use the 8c… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8c000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','pc-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,4) n;
update public.profiles set status = 'active' where id::text like '8c000000-%';
insert into public.user_roles (user_id, role) values
  ('8c000000-0000-0000-0000-000000000001','salesperson'),
  ('8c000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8c000000-0000-0000-0000-000000000002','finance_manager'),
  ('8c000000-0000-0000-0000-000000000003','general_manager'),
  ('8c000000-0000-0000-0000-000000000004','bd_manager');

update public.logistics_rates set value = 12000 where key = 'container_rate';
update public.logistics_rates set value = 5     where key = 'customs_pct';
update public.logistics_rates set value = 500   where key = 'clearing_fee';
update public.logistics_rates set value = 5000  where key = 'delivery_riyadh';
update public.logistics_rates set value = 10    where key = 'install_fallback_pct';
update public.logistics_rates set value = 25    where key = 'default_margin_pct';
insert into public.installation_rates (install_type, base_rate, effective_from) values ('pylon', 1000, current_date - 1);
insert into public.vendors (id, name) values ('8c100000-0000-0000-0000-000000000001','pc-vendor');

-- Deal 1: the worked example, in the selling build. Deal 2: in package review (for needs_info).
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pc-deal-' || n,
       '8c000000-0000-0000-0000-000000000001','8c000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8c40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8c20000' || n || '-0000-0000-0000-000000000001')::uuid, 'pc-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8c50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8c40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity, install_type, has_screen) values
  ('8c510001-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001',1,'Pylon P1',2,'pylon',false),
  ('8c510002-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001',2,'Ceiling C1',4,'ceiling',true);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency, status) values
  ('8c520001-0000-0000-0000-000000000001','8c500001-0000-0000-0000-000000000001','8c100000-0000-0000-0000-000000000001','SAR','responses_received');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, unit_cost, quantity, line_cost, unit_cost_with_screen) values
  ('8c520001-0000-0000-0000-000000000001','8c510001-0000-0000-0000-000000000001',5000,2,10000,null),
  ('8c520001-0000-0000-0000-000000000001','8c510002-0000-0000-0000-000000000001',1000,4,4000,1500);
update public.boq_revisions set frozen_at = now(), frozen_by = '8c000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '8c500001-0000-0000-0000-000000000001';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8c600001-0000-0000-0000-000000000001','8c200001-0000-0000-0000-000000000001','selling_build','8c500001-0000-0000-0000-000000000001'),
  ('8c600002-0000-0000-0000-000000000001','8c200002-0000-0000-0000-000000000001','package_review','8c500002-0000-0000-0000-000000000001');
insert into public.pricing_file_inputs (file_id, containers, delivery, clearing, overhead_pct)
values ('8c600001-0000-0000-0000-000000000001', 1, 'riyadh', true, 0);
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate) values
  ('8c900001-0000-0000-0000-000000000001','pc_crane','Crane','رافعة','lump',3000);
insert into public.pricing_file_extras (file_id, catalog_id, quantity, rate, status, decided_at)
values ('8c600001-0000-0000-0000-000000000001','8c900001-0000-0000-0000-000000000001',1,3000,'accepted',now());

-- Kalas builds and proposes.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_build_price('8c600001-0000-0000-0000-000000000001');
select public.pricing_file_propose('8c600001-0000-0000-0000-000000000001', 53200, 39900);
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_review('8c600001-0000-0000-0000-000000000001','approve');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',true);
select public.pricing_issue_quotation('8c600001-0000-0000-0000-000000000001', current_date + 30, null, null, null);
reset role;
select is((select state::text from public.pricing_files where id = '8c600001-0000-0000-0000-000000000001'), 'quoted',
  'fixture: the file is quoted');

-- ===== Who, and what =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','Client cut 2 signs')$$,
  '42501', null, 'A rep cannot open a round');
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','   ')$$,
  '23514', null, 'A round needs what the client changed');
select throws_ok($$select public.pricing_file_move('8c600001-0000-0000-0000-000000000001','package_review')$$,
  'P0001', null, 'The round is not a plain move');
select throws_ok($$select public.pricing_file_client_round('8c600002-0000-0000-0000-000000000001','x')$$,
  'P0001', null, 'Only a quoted file opens a round');

-- ===== Open the round =====
select lives_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','Client cut 2 signs')$$,
  'A pricer opens the round');
reset role;
select is((select state::text from public.pricing_files where id = '8c600001-0000-0000-0000-000000000001'), 'package_review',
  'The file is back at package review');
select isnt((select boq_revision_id from public.pricing_files where id = '8c600001-0000-0000-0000-000000000001'),
  '8c500001-0000-0000-0000-000000000001'::uuid, 'On a new BOQ revision');
select is((select r.revision_number::text || '/' || (r.frozen_at is null)::text || '/' || r.is_current::text
             from public.boq_revisions r join public.pricing_files f on f.boq_revision_id = r.id
            where f.id = '8c600001-0000-0000-0000-000000000001'), '2/true/true', 'Revision 2, unfrozen, current');
select is((select superseded_by is not null and not is_current from public.boq_revisions
            where id = '8c500001-0000-0000-0000-000000000001'), true, 'Revision 1 is superseded');
select is((select string_agg(bl.sign_type || ':' || bl.quantity::int, ',' order by bl.line_number)
             from public.boq_lines bl join public.pricing_files f on f.boq_revision_id = bl.revision_id
            where f.id = '8c600001-0000-0000-0000-000000000001'), 'Pylon P1:2,Ceiling C1:4', 'With the same lines to start from');
select is((select status::text from public.quotation_revisions where pricing_file_id = '8c600001-0000-0000-0000-000000000001'
            and is_current), 'approved', 'The client''s quotation stays valid until the next one supersedes it');
select ok(exists (select 1 from public.pricing_file_events e where e.file_id = '8c600001-0000-0000-0000-000000000001'
                   and e.from_state = 'quoted' and e.to_state = 'package_review' and e.note = 'Client cut 2 signs'),
  'The round and the client''s change are on the file''s history');

-- ===== Edits now land on the new revision =====
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8c000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_client_round('8c600001-0000-0000-0000-000000000001','again')$$,
  'P0001', null, 'A second round waits for this one');
reset role;

select * from finish();
rollback;
