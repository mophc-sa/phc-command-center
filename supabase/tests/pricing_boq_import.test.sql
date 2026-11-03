-- PR 2, part 2: BOQ lines entered in the pricing file (import or by hand), and the freeze.
-- Test user UUIDs use the 6b… prefix. Every session carries aal2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('6b000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated','bi-user' || n || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from generate_series(1,2) n;
update public.profiles set status = 'active' where id::text like '6b000000-%';
insert into public.user_roles (user_id, role) values
  ('6b000000-0000-0000-0000-000000000001','salesperson'),
  ('6b000000-0000-0000-0000-000000000002','estimation_manager'),
  ('6b000000-0000-0000-0000-000000000002','finance_manager');

-- X: no BOQ yet. Y: a frozen revision already attached. Z: a frozen revision attached, new lines coming.
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('6b20000' || n || '-0000-0000-0000-000000000001')::uuid, 'bi-deal-' || n,
       '6b000000-0000-0000-0000-000000000001','6b000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,3) n;
insert into public.boqs (id, related_opportunity_id, title) values
  ('6b400002-0000-0000-0000-000000000001','6b200002-0000-0000-0000-000000000001','bi-boq-y'),
  ('6b400003-0000-0000-0000-000000000001','6b200003-0000-0000-0000-000000000001','bi-boq-z');
-- Deal Z also has an older, empty BOQ: new lines must continue the file's own BOQ, not that one.
insert into public.boqs (id, related_opportunity_id, title, created_at) values
  ('6b400004-0000-0000-0000-000000000001','6b200003-0000-0000-0000-000000000001','bi-boq-z-older', now() - interval '30 days');
insert into public.boq_revisions (id, boq_id, revision_number) values
  ('6b500002-0000-0000-0000-000000000001','6b400002-0000-0000-0000-000000000001',1),
  ('6b500003-0000-0000-0000-000000000001','6b400003-0000-0000-0000-000000000001',1);
insert into public.boq_lines (revision_id, sign_type, quantity) values
  ('6b500002-0000-0000-0000-000000000001','Wall W1',1),
  ('6b500003-0000-0000-0000-000000000001','Wall W1',1);
update public.boq_revisions set frozen_at = '2026-11-01 10:00+03', frozen_by = '6b000000-0000-0000-0000-000000000002', status = 'verified'
 where id in ('6b500002-0000-0000-0000-000000000001','6b500003-0000-0000-0000-000000000001');
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('6b600001-0000-0000-0000-000000000001','6b200001-0000-0000-0000-000000000001','package_review', null),
  ('6b600002-0000-0000-0000-000000000001','6b200002-0000-0000-0000-000000000001','package_review','6b500002-0000-0000-0000-000000000001'),
  ('6b600003-0000-0000-0000-000000000001','6b200003-0000-0000-0000-000000000001','package_review','6b500003-0000-0000-0000-000000000001');
insert into public.pricing_extras_catalog (code, name_en, name_ar, unit, default_rate, suggest_for)
values ('bi_concrete_base','Concrete base','قاعدة خرسانية','item',1200, array['pylon']::public.install_type[]);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"P1","quantity":1}]')$$,
  '42501', null, 'A rep cannot enter BOQ lines');

select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[]')$$,
  '23514', null, 'An empty list is refused');
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"P1","quantity":1,"install_type":"roof"}]')$$,
  '23514', 'Line 1 is not valid: unknown install type. | السطر 1 غير صالح: نوع تركيب غير معروف.', 'An unknown install type names the line');
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"P1","quantity":1},{"sign_type":"P2","quantity":0}]')$$,
  '23514', null, 'A quantity of zero is refused');
select is((public.pricing_boq_import('6b600001-0000-0000-0000-000000000001',
  '[{"sign_type":"Pylon P1","quantity":2,"install_type":"pylon","width_mm":1200,"height_mm":3000,"has_screen":true,"material":"Aluminium"},
    {"sign_type":"Wall W2","quantity":4,"unit":"no.","description":null}]'))->>'inserted',
  '2', 'Two lines are imported');
select isnt((select boq_revision_id from public.pricing_files where id = '6b600001-0000-0000-0000-000000000001'), null,
  'The file now has a revision');
select is((select count(*)::int from public.boqs where related_opportunity_id = '6b200001-0000-0000-0000-000000000001'), 1,
  'The deal got its BOQ');
select is((select r.revision_number || '/' || r.status::text || '/' || (r.frozen_at is null)::text
             from public.boq_revisions r join public.pricing_files f on f.boq_revision_id = r.id
            where f.id = '6b600001-0000-0000-0000-000000000001'),
  '1/draft/true', 'It is draft revision 1');
select is((select l.install_type::text || '/' || l.width_mm::text || '/' || l.has_screen::text
             from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
            where f.id = '6b600001-0000-0000-0000-000000000001' and l.sign_type = 'Pylon P1'),
  'pylon/1200.0/true', 'Structured attributes are stored');
select is((public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"Totem T1","quantity":1}]'))->>'inserted',
  '1', 'A line added by hand is appended');
select is((select l.line_number from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
            where f.id = '6b600001-0000-0000-0000-000000000001' and l.sign_type = 'Totem T1'), 3,
  'It takes the next line number');
select is((public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"Only","quantity":1}]', true))->>'inserted',
  '1', 'Replace keeps only the new lines');
select is((select count(*)::int from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
            where f.id = '6b600001-0000-0000-0000-000000000001'), 1, '... one line left');

select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_boq_line_delete('6b600001-0000-0000-0000-000000000001',
    (select l.id from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
      where f.id = '6b600001-0000-0000-0000-000000000001' limit 1))$$,
  '42501', null, 'A rep cannot delete a line');
select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.pricing_boq_line_delete('6b600001-0000-0000-0000-000000000001',
    (select l.id from public.boq_lines l join public.pricing_files f on f.boq_revision_id = l.revision_id
      where f.id = '6b600001-0000-0000-0000-000000000001' limit 1))$$,
  'Zayed deletes a line from the draft');
select throws_ok($$select public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001')$$,
  'P0001', null, 'A revision with no lines cannot freeze');
select lives_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001',
  '[{"sign_type":"Pylon P1","quantity":2,"install_type":"pylon"},{"sign_type":"Wall W2","quantity":4}]')$$,
  'Lines are entered again');

select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001')$$,
  '42501', null, 'A rep cannot freeze the BOQ');
select set_config('request.jwt.claims','{"sub":"6b000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001','superseded')$$,
  '23514', null, 'Freezing takes verified or partially verified only');
select is((public.pricing_file_freeze_boq('6b600001-0000-0000-0000-000000000001','verified','Checked against drawings and location plan'))->>'state',
  'boq_frozen', 'The BOQ freezes and the file moves on');
select is((select r.status::text || '/' || r.frozen_by::text from public.boq_revisions r join public.pricing_files f on f.boq_revision_id = r.id
            where f.id = '6b600001-0000-0000-0000-000000000001'),
  'verified/6b000000-0000-0000-0000-000000000002', 'The freeze is stamped from the session');
select is((select note from public.pricing_file_events where file_id = '6b600001-0000-0000-0000-000000000001' and to_state = 'boq_frozen'),
  'Checked against drawings and location plan', 'The checklist note is on the move');
select is((select count(*)::int from public.pricing_file_extras where file_id = '6b600001-0000-0000-0000-000000000001'), 1,
  'Freezing runs the extras suggestions (the pylon suggests a base)');
select throws_ok($$select public.pricing_boq_import('6b600001-0000-0000-0000-000000000001','[{"sign_type":"Late","quantity":1}]')$$,
  'P0001', null, 'Lines cannot be entered after the freeze');

-- Y: the attached revision is already frozen; the freeze only moves the file.
select is((public.pricing_file_freeze_boq('6b600002-0000-0000-0000-000000000001'))->>'state', 'boq_frozen',
  'An already-frozen revision moves the file without a second freeze');

-- Z: lines entered on a file whose revision is frozen open the next revision.
select is((public.pricing_boq_import('6b600003-0000-0000-0000-000000000001','[{"sign_type":"Wall W1","quantity":2}]'))->>'revision_number',
  '2', 'New lines on a frozen revision open revision 2, which replaces revision 1');
reset role;
select * from finish();
rollback;
