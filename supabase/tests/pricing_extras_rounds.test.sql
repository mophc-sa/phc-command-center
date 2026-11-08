-- PR 2, part 4: extras belong to a BOQ revision (a round); the suggest/propose
-- race is closed by the file lock; cinema projects suggest acoustic; extras
-- can be added from the catalog. Test user UUIDs use the 6d… prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6d000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','er-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,3) n;
update public.profiles set status = 'active' where id::text like '6d000000-%';
insert into public.user_roles (user_id, role) values
  ('6d000000-0000-0000-0000-000000000001','salesperson'),
  ('6d000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6d000000-0000-0000-0000-000000000002','finance_manager'),
  ('6d000000-0000-0000-0000-000000000003','general_manager');
insert into public.pricing_extras_catalog (id, code, name_en, name_ar, unit, default_rate, suggest_for, suggest_min_height_m, suggest_if_cinema) values
  ('6d900001-0000-0000-0000-000000000001','er_concrete','Concrete base','قاعدة خرسانية','item',1200, array['pylon']::public.install_type[], null, false),
  ('6d900002-0000-0000-0000-000000000001','er_scaffold','Scaffold','سقالة','lump',800, '{}', 6, false),
  ('6d900003-0000-0000-0000-000000000001','er_acoustic','Acoustic insulation','عزل صوتي','m2',150, '{}', null, true),
  ('6d900004-0000-0000-0000-000000000001','er_crane','Crane','رافعة','lump',2000, '{}', null, false);
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('6d200001-0000-0000-0000-000000000001','er-deal','6d000000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('6d400001-0000-0000-0000-000000000001','6d200001-0000-0000-0000-000000000001','er-boq');
insert into public.boq_revisions (id, boq_id, revision_number) values ('6d500001-0000-0000-0000-000000000001','6d400001-0000-0000-0000-000000000001',1);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('6d500001-0000-0000-0000-000000000001','Pylon P1',1,'pylon',null),
  ('6d500001-0000-0000-0000-000000000001','Ceiling C1',2,'ceiling',7);
update public.boq_revisions set frozen_at = now(), frozen_by = '6d000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '6d500001-0000-0000-0000-000000000001';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
values ('6d600001-0000-0000-0000-000000000001','6d200001-0000-0000-0000-000000000001','selling_build','6d500001-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_suggest_extras('6d600001-0000-0000-0000-000000000001'), 2, 'Round 1: a base for the pylon, a scaffold for the 7 m ceiling');
select is((select count(*)::int from public.pricing_file_extras where boq_revision_id = '6d500001-0000-0000-0000-000000000001'), 2,
  'Both belong to revision 1');
select lives_ok($$select public.pricing_decide_extra(x.id, x.catalog_id = '6d900001-0000-0000-0000-000000000001', null, null, 'Not needed this time')
                    from public.pricing_file_extras x where x.file_id = '6d600001-0000-0000-0000-000000000001'$$,
  'Round 1 decided: base accepted, scaffold dismissed');

-- A client revision: revision 2 with the same kinds of signs.
reset role;
update public.boq_revisions set is_current = false where id = '6d500001-0000-0000-0000-000000000001';
insert into public.boq_revisions (id, boq_id, revision_number) values ('6d500002-0000-0000-0000-000000000001','6d400001-0000-0000-0000-000000000001',2);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('6d500002-0000-0000-0000-000000000001','Pylon P1',2,'pylon',null),
  ('6d500002-0000-0000-0000-000000000001','Ceiling C1',2,'ceiling',7);
update public.boq_revisions set frozen_at = now(), frozen_by = '6d000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '6d500002-0000-0000-0000-000000000001';
update public.pricing_files set boq_revision_id = '6d500002-0000-0000-0000-000000000001' where id = '6d600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_suggest_extras('6d600001-0000-0000-0000-000000000001'), 2,
  'Round 2 suggests both again: round 1''s decisions do not suppress them');
select is(public.pricing_file_open_suggestions('6d600001-0000-0000-0000-000000000001'), 2, 'Two open, all in round 2');
select is((select string_agg(status::text, ',' order by status::text) from public.pricing_file_extras
            where file_id = '6d600001-0000-0000-0000-000000000001' and boq_revision_id = '6d500001-0000-0000-0000-000000000001'),
  'accepted,dismissed', 'Round 1''s decisions are kept as they were (PR 1 would have left round 2 with nothing to suggest)');

-- The propose check counts the current round only, and locks the file.
reset role;
insert into public.estimations (id, boq_revision_id, cost_total) values ('6d700001-0000-0000-0000-000000000001','6d500002-0000-0000-0000-000000000001',1000);
insert into public.internal_prices (id, estimation_id, proposed_price, status)
values ('6d800001-0000-0000-0000-000000000001','6d700001-0000-0000-0000-000000000001',2000,'internal_price_proposed');
update public.pricing_files set estimation_id = '6d700001-0000-0000-0000-000000000001', internal_price_id = '6d800001-0000-0000-0000-000000000001'
 where id = '6d600001-0000-0000-0000-000000000001';
select ok(public._pricing_price_has_open_extras('6d800001-0000-0000-0000-000000000001'), 'Open suggestions in round 2 block Propose');
update public.pricing_file_extras set status = 'accepted', decided_at = now()
 where boq_revision_id = '6d500002-0000-0000-0000-000000000001';
insert into public.pricing_file_extras (file_id, boq_revision_id, catalog_id, rate)
values ('6d600001-0000-0000-0000-000000000001','6d500001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',2000);
select ok(not public._pricing_price_has_open_extras('6d800001-0000-0000-0000-000000000001'),
  'An undecided suggestion of an older round does not block Propose');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_suggest_extras('6d600001-0000-0000-0000-000000000001'), 0, 'Suggesting again adds nothing, and drops the older round''s undecided crane');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.extras_old_round_purged'
                   and entity_id = '6d200001-0000-0000-0000-000000000001'), 'The purge of an older round''s suggestion is audited');
insert into public.pricing_file_extras (file_id, catalog_id, rate, status, decided_at)
values ('6d600001-0000-0000-0000-000000000001','6d900003-0000-0000-0000-000000000001',150,'accepted',now());
select is((select boq_revision_id::text from public.pricing_file_extras
            where file_id = '6d600001-0000-0000-0000-000000000001' and catalog_id = '6d900003-0000-0000-0000-000000000001'),
  '6d500002-0000-0000-0000-000000000001', 'An extra inserted without a round takes the file''s current revision');
delete from public.pricing_file_extras where catalog_id = '6d900003-0000-0000-0000-000000000001';
select is((select provolatile::text from pg_proc where oid = 'public._pricing_price_has_open_extras(uuid)'::regprocedure), 'v',
  'The open-extras check is volatile, so it can take the file lock and see a suggestion committed meanwhile');
select ok(pg_get_functiondef('public._pricing_price_has_open_extras(uuid)'::regprocedure) ~ 'FOR UPDATE',
  'The open-extras check locks the file');
select ok(pg_get_functiondef('public.pricing_suggest_extras(uuid)'::regprocedure) ~ 'FOR UPDATE',
  'Suggesting locks the file');

-- Cinema.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_set_inputs('6d600001-0000-0000-0000-000000000001','{"is_cinema":true}')$$,
  'Zayed marks the project a cinema');
select ok(exists (select 1 from public.pricing_file_extras where catalog_id = '6d900003-0000-0000-0000-000000000001'
                   and status = 'suggested' and source_line_id is null),
  'A cinema suggests acoustic insulation');
select lives_ok($$select public.pricing_file_set_inputs('6d600001-0000-0000-0000-000000000001','{"is_cinema":false}')$$,
  'Zayed unmarks it');
select is((select count(*)::int from public.pricing_file_extras where catalog_id = '6d900003-0000-0000-0000-000000000001'), 0,
  'The undecided acoustic suggestion goes with it');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.extras_cinema_withdrawn'
                   and entity_id = '6d200001-0000-0000-0000-000000000001'), 'The cinema withdrawal is audited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_set_inputs('6d600001-0000-0000-0000-000000000001','{"is_cinema":true}');
select public.pricing_decide_extra(x.id, true, 1, null, null) from public.pricing_file_extras x
 where x.file_id = '6d600001-0000-0000-0000-000000000001' and x.catalog_id = '6d900003-0000-0000-0000-000000000001';
select public.pricing_file_set_inputs('6d600001-0000-0000-0000-000000000001','{"is_cinema":false}');
select is((select status::text from public.pricing_file_extras
            where file_id = '6d600001-0000-0000-0000-000000000001' and catalog_id = '6d900003-0000-0000-0000-000000000001'),
  'accepted', 'A decided acoustic extra survives turning cinema off');
reset role;
delete from public.pricing_file_extras where catalog_id = '6d900003-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.pricing_file_set_inputs('6d600001-0000-0000-0000-000000000001','{"is_cinema":true}');

-- Adding from the catalog.
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900003-0000-0000-0000-000000000001',3))->>'status', 'accepted',
  'Adding an item already suggested this round accepts it');
select is((select count(*)::int from public.pricing_file_extras where file_id = '6d600001-0000-0000-0000-000000000001'
             and catalog_id = '6d900003-0000-0000-0000-000000000001'), 1, 'It is the same row, not a second one');
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1e11)$$,
  '23514', null, 'A quantity beyond the column is refused as 23514, not an overflow');
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1,1e12)$$,
  '23514', null, 'A rate beyond the column is refused as 23514');
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1)$$,
  '42501', null, 'A rep cannot add extras');
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',0)$$,
  '23514', null, 'A quantity of zero is refused');
select is((public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1))->>'rate',
  '2000.00', 'Kalas adds a crane at the catalog rate');
select is((public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',2,2500))->>'quantity',
  '2.000', 'Adding it again updates the quantity and rate');
reset role;
update public.pricing_files set state = 'boq_frozen' where id = '6d600001-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_add_extra('6d600001-0000-0000-0000-000000000001','6d900004-0000-0000-0000-000000000001',1)$$,
  'P0001', null, 'Extras are added once the supplier has priced');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'pricing_file.extra_added'
                   and after_value->>'catalog_id' = '6d900003-0000-0000-0000-000000000001' and after_value->>'quantity' = '3.000'),
  'Adding is audited, also when it accepts a suggestion');

-- ===== Propose must not depend on suggest having run =====
-- A frozen revision with a pylon line, moved with pricing_file_move straight to
-- boq_frozen (no suggest), then on to the selling build.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('6d200002-0000-0000-0000-000000000001','er-deal-2','6d000000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('6d400002-0000-0000-0000-000000000001','6d200002-0000-0000-0000-000000000001','er-boq-2');
insert into public.boq_revisions (id, boq_id, revision_number) values ('6d500003-0000-0000-0000-000000000001','6d400002-0000-0000-0000-000000000001',1);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('6d500003-0000-0000-0000-000000000001','Pylon P9',1,'pylon',null);
update public.boq_revisions set frozen_at = now(), frozen_by = '6d000000-0000-0000-0000-000000000002', status = 'verified'
 where id = '6d500003-0000-0000-0000-000000000001';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
values ('6d600002-0000-0000-0000-000000000001','6d200002-0000-0000-0000-000000000001','package_review','6d500003-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_file_move('6d600002-0000-0000-0000-000000000001','boq_frozen')$$, 'Moved to boq_frozen without suggesting');
reset role;
update public.pricing_files set state = 'selling_build' where id = '6d600002-0000-0000-0000-000000000001';
insert into public.estimations (id, boq_revision_id, cost_total) values ('6d700002-0000-0000-0000-000000000001','6d500003-0000-0000-0000-000000000001',1000);
insert into public.internal_prices (id, estimation_id, proposed_price, status, proposed_by)
values ('6d800002-0000-0000-0000-000000000001','6d700002-0000-0000-0000-000000000001',2000,'internal_price_proposed','6d000000-0000-0000-0000-000000000003');
update public.pricing_files set estimation_id = '6d700002-0000-0000-0000-000000000001', internal_price_id = '6d800002-0000-0000-0000-000000000001'
 where id = '6d600002-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '6d800002-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Propose is refused: the pylon''s concrete base was never suggested');
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(public.pricing_file_open_suggestions('6d600002-0000-0000-0000-000000000001'), 1,
  'The open count includes an expected extra that has no row yet');
select is(public.pricing_suggest_extras('6d600002-0000-0000-0000-000000000001'), 1, 'Suggesting now finds the base');
select is(public.pricing_file_open_suggestions('6d600002-0000-0000-0000-000000000001'), 1,
  'After suggesting, the same item is still one open');
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '6d800002-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Still refused while the suggestion is undecided');
select public.pricing_decide_extra(x.id, true, 1, null, null) from public.pricing_file_extras x where x.file_id = '6d600002-0000-0000-0000-000000000001';
select lives_ok($$update public.internal_prices set status = 'gm_pending' where id = '6d800002-0000-0000-0000-000000000001'$$,
  'Propose passes once every expected extra is decided');
select is(public.pricing_file_open_suggestions('6d600002-0000-0000-0000-000000000001'), 0, 'Once decided, nothing is open');
reset role;

-- ===== An old round's row does not satisfy this round; a dismissal does =====
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('6d200003-0000-0000-0000-000000000001','er-deal-3','6d000000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-000000000001','rfq_received');
insert into public.boqs (id, related_opportunity_id, title) values ('6d400003-0000-0000-0000-000000000001','6d200003-0000-0000-0000-000000000001','er-boq-3');
insert into public.boqs (id, related_opportunity_id, title) values ('6d400004-0000-0000-0000-000000000001','6d200003-0000-0000-0000-000000000001','er-boq-3-old');
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6d500004-0000-0000-0000-000000000001','6d400004-0000-0000-0000-000000000001',1),
  ('6d500005-0000-0000-0000-000000000001','6d400003-0000-0000-0000-000000000001',2);
insert into public.boq_lines (revision_id, sign_type, quantity, install_type, mount_height_m) values
  ('6d500005-0000-0000-0000-000000000001','Pylon P3',1,'pylon',null);
update public.boq_revisions set frozen_at = now(), frozen_by = '6d000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('6d500004-0000-0000-0000-000000000001','6d500005-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id)
values ('6d600003-0000-0000-0000-000000000001','6d200003-0000-0000-0000-000000000001','selling_build','6d500005-0000-0000-0000-000000000001');
insert into public.pricing_file_extras (file_id, boq_revision_id, catalog_id, quantity, rate, status, decided_by, decided_at)
values ('6d600003-0000-0000-0000-000000000001','6d500004-0000-0000-0000-000000000001','6d900001-0000-0000-0000-000000000001',1,1200,'accepted','6d000000-0000-0000-0000-000000000002',now());
insert into public.estimations (id, boq_revision_id, cost_total) values ('6d700003-0000-0000-0000-000000000001','6d500005-0000-0000-0000-000000000001',1000);
insert into public.internal_prices (id, estimation_id, proposed_price, status, proposed_by)
values ('6d800003-0000-0000-0000-000000000001','6d700003-0000-0000-0000-000000000001',2000,'internal_price_proposed','6d000000-0000-0000-0000-000000000003');
update public.pricing_files set estimation_id = '6d700003-0000-0000-0000-000000000001', internal_price_id = '6d800003-0000-0000-0000-000000000001'
 where id = '6d600003-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$update public.internal_prices set status = 'gm_pending' where id = '6d800003-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Propose is refused: the only row for the pylon base is from an old round');
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select public.pricing_suggest_extras('6d600003-0000-0000-0000-000000000001');
select public.pricing_decide_extra(x.id, false, null, null, 'Not needed for this site')
  from public.pricing_file_extras x
 where x.file_id = '6d600003-0000-0000-0000-000000000001' and x.boq_revision_id = '6d500005-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"6d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$update public.internal_prices set status = 'gm_pending' where id = '6d800003-0000-0000-0000-000000000001'$$,
  'Propose passes when the expected item is dismissed this round');
reset role;

-- ===== Cinema hits need a revision =====
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
values ('6d200004-0000-0000-0000-000000000001','er-deal-4','6d000000-0000-0000-0000-000000000001','6d000000-0000-0000-0000-000000000001','rfq_received');
insert into public.pricing_files (id, opportunity_id, state) values ('6d600004-0000-0000-0000-000000000001','6d200004-0000-0000-0000-000000000001','package_review');
insert into public.pricing_file_inputs (file_id, is_cinema) values ('6d600004-0000-0000-0000-000000000001', true);
select is((select count(*)::int from public._pricing_expected_extras('6d600004-0000-0000-0000-000000000001')), 0,
  'A cinema flag alone suggests nothing while the file has no revision');
select ok(not has_function_privilege('authenticated', 'public._pricing_expected_extras(uuid)', 'execute'),
  'The expected-extras helper is not callable by users');
select * from finish();
rollback;
