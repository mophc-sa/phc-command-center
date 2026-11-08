-- PR 3 Task 5: a supplier sees its own request and nothing else in the schema.
-- A sweep over every table and view, the storage objects, the SECURITY DEFINER
-- functions a client can call, and the views that bypass row security.
-- Test user UUIDs use the 8f prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('8f000000-0000-0000-0000-00000000000' || n)::uuid,
       'authenticated','authenticated', r || '+test@phc-sa.com', now(),
       '{"provider":"email","providers":["email"]}','{}', now(), now()
  from (values (1,'sw-rep'),(2,'sw-pricer'),(3,'sw-supplier-a'),(4,'sw-supplier-b')) v(n, r);
update public.profiles set status = 'active' where id::text like '8f000000-%';
insert into public.user_roles (user_id, role) values
  ('8f000000-0000-0000-0000-000000000001','salesperson'),
  ('8f000000-0000-0000-0000-000000000002','estimation_manager'),
  ('8f000000-0000-0000-0000-000000000002','finance_manager');
-- Two vendors whose names normalise alike, so the duplicates view has a row to leak.
insert into public.vendors (id, name) values
  ('8f100001-0000-0000-0000-000000000001','Sweep Signs Co'),
  ('8f100002-0000-0000-0000-000000000001','SWEEP SIGNS co.');
set local session_replication_role = replica;
update public.profiles set vendor_id = '8f100001-0000-0000-0000-000000000001' where id = '8f000000-0000-0000-0000-000000000003';
update public.profiles set vendor_id = '8f100002-0000-0000-0000-000000000001' where id = '8f000000-0000-0000-0000-000000000004';
insert into public.user_roles (user_id, role) values
  ('8f000000-0000-0000-0000-000000000003','supplier'), ('8f000000-0000-0000-0000-000000000004','supplier');
set local session_replication_role = origin;
insert into public.automation_runs (trigger) values ('sw-probe');
insert into public.margin_policies (min_margin_pct, effective_from, rationale) values (15, now() - interval '1 day', 'sw-floor');
insert into public.opportunities (id, project_name, owner_id, created_by, sales_stage)
select ('8f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'sw-deal-' || n,
       '8f000000-0000-0000-0000-000000000001','8f000000-0000-0000-0000-000000000001','rfq_received'
  from generate_series(1,2) n;
insert into public.boqs (id, related_opportunity_id, title)
select ('8f40000' || n || '-0000-0000-0000-000000000001')::uuid, ('8f20000' || n || '-0000-0000-0000-000000000001')::uuid, 'sw-boq-' || n
  from generate_series(1,2) n;
insert into public.boq_revisions (id, boq_id, revision_number)
select ('8f50000' || n || '-0000-0000-0000-000000000001')::uuid, ('8f40000' || n || '-0000-0000-0000-000000000001')::uuid, 1
  from generate_series(1,2) n;
insert into public.boq_lines (id, revision_id, line_number, sign_type, quantity) values
  ('8f510001-0000-0000-0000-000000000001','8f500001-0000-0000-0000-000000000001',1,'Pylon P1',2),
  ('8f510002-0000-0000-0000-000000000001','8f500002-0000-0000-0000-000000000001',1,'Wall W1',1);
insert into public.supplier_quotes (id, boq_revision_id, vendor_id, currency) values
  ('8f800001-0000-0000-0000-000000000001','8f500001-0000-0000-0000-000000000001','8f100001-0000-0000-0000-000000000001','SAR');
insert into public.supplier_quote_lines (supplier_quote_id, boq_line_id, quantity, unit_cost) values
  ('8f800001-0000-0000-0000-000000000001','8f510001-0000-0000-0000-000000000001',2,100);
update public.boq_revisions set frozen_at = now(), frozen_by = '8f000000-0000-0000-0000-000000000002', status = 'verified'
 where id::text like '8f50000%';
insert into public.pricing_files (id, opportunity_id, state, boq_revision_id) values
  ('8f600001-0000-0000-0000-000000000001','8f200001-0000-0000-0000-000000000001','boq_frozen','8f500001-0000-0000-0000-000000000001'),
  ('8f600002-0000-0000-0000-000000000001','8f200002-0000-0000-0000-000000000001','boq_frozen','8f500002-0000-0000-0000-000000000001');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by)
select ('8f70000' || n || '-0000-0000-0000-000000000001')::uuid, 'attachments', 'opportunity/8f' || n || '/a.pdf', 'a.pdf', 'application/pdf',
       1000, repeat('a',64), 'drawing', '8f000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into public.document_links (document_id, entity_type, entity_id, linked_by)
select ('8f70000' || n || '-0000-0000-0000-000000000001')::uuid, 'opportunity', ('8f20000' || n || '-0000-0000-0000-000000000001')::uuid,
       '8f000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into storage.objects (bucket_id, name, owner, version)
select 'attachments', 'opportunity/8f' || n || '/a.pdf', '8f000000-0000-0000-0000-000000000001', 'v1' from generate_series(1,2) n;
-- The pricer sends file 1 to supplier A and file 2 to supplier B; a notification and an audit row exist.
create temp table sw_ref (k text, v text);
grant all on sw_ref to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8f000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into sw_ref select 'inv_a', public.pricing_send_to_supplier('8f600001-0000-0000-0000-000000000001','8f100001-0000-0000-0000-000000000001',
  current_date + 7, array['8f700001-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
insert into sw_ref select 'inv_b', public.pricing_send_to_supplier('8f600002-0000-0000-0000-000000000001','8f100002-0000-0000-0000-000000000001',
  current_date + 7, array['8f700002-0000-0000-0000-000000000001']::uuid[])->>'invitation_id';
reset role;
insert into sw_ref select 'code_a', project_code from public.opportunities where id = '8f200001-0000-0000-0000-000000000001';
-- Inserted directly: emit_notification skips supplier accounts (Task 1 fix round 1).
insert into public.notifications (recipient_user_id, notification_type, entity_type, entity_id, title, body, severity, source_event, dedupe_key)
values ('8f000000-0000-0000-0000-000000000003', 'mention', 'opportunity', '8f200001-0000-0000-0000-000000000001',
        'sw-title', 'sw-body', 'info', 'sw', 'sw-1');

-- 1. Every table and view, as supplier A: nothing but its own profile and the static state map.
create temp table sw_seen (rel text, n bigint);
create temp table sw_cov (what text, n integer);
create temp table sw_fn (fn text, name text, verdict text);
-- Candidate ids for the function sweep: the other supplier's request, file, deal, line, document and vendor,
-- and this supplier's own. Captured as the owner, because the supplier cannot read them.
create temp table sw_ids (id uuid);
grant all on sw_seen, sw_cov, sw_fn, sw_ids to authenticated;
insert into sw_ids values
  ((select v::uuid from sw_ref where k = 'inv_a')), ((select v::uuid from sw_ref where k = 'inv_b')),
  ('8f600001-0000-0000-0000-000000000001'), ('8f600002-0000-0000-0000-000000000001'),
  ('8f200001-0000-0000-0000-000000000001'), ('8f200002-0000-0000-0000-000000000001'),
  ('8f510001-0000-0000-0000-000000000001'), ('8f510002-0000-0000-0000-000000000001'),
  ('8f700001-0000-0000-0000-000000000001'), ('8f700002-0000-0000-0000-000000000001'),
  ('8f100001-0000-0000-0000-000000000001'), ('8f100002-0000-0000-0000-000000000001'),
  ('8f000000-0000-0000-0000-000000000003'), ('8f000000-0000-0000-0000-000000000004'),
  ('8f800001-0000-0000-0000-000000000001'), ('8f000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
do $$ declare r record; c bigint; k integer := 0; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','v','m','p') order by 1 loop
    k := k + 1;
    begin
      execute format('select count(*) from public.%I', r.relname) into c;
    exception when insufficient_privilege then c := 0;  -- no grant, or a view that fails closed: nothing to read
    end;
    if c > 0 then insert into sw_seen values (r.relname, c); end if;
  end loop;
  insert into sw_cov values ('tables and views', k);
end $$;
select is((select array_agg(rel || '=' || n order by rel) from sw_seen), array['pricing_file_transitions=14','profiles=1','user_roles=1'],
  'A supplier reads only its own profile and role, and the static state map, in every table and view');
select is((select count(*)::int from storage.objects), 0, 'A supplier reads no stored file');

-- 1b. Every function in public that a client can call, as supplier A. Each is called with null arguments and with
-- every candidate id in every uuid position (other types get a plain value). It must raise, or return nothing
-- (no row, null, false, empty), unless it is the supplier portal's own API (named in the query below) or on the
-- reviewed list in the assertion.
do $$ declare f record; call text; args text; cand uuid; res text; k integer := 0; tried integer := 0; verdict text; begin
  for f in
    select p.oid, p.proname, p.proretset, p.proargtypes::oid[] as argt, pg_get_function_identity_arguments(p.oid) as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f','p') and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and p.proname !~ '^supplier_portal_(invitations?|submit|file)$'
     order by p.proname, p.oid
  loop
    k := k + 1; verdict := 'denied';
    for cand in select null::uuid union all select id from sw_ids loop
      select coalesce(string_agg(
               case when t.oid = 'uuid'::regtype then coalesce(format('%L::uuid', cand), 'null::uuid')
                    when t.oid = 'uuid[]'::regtype then coalesce(format('array[%L]::uuid[]', cand), 'null::uuid[]')
                    when cand is null then format('null::%s', format_type(t.oid, null))
                    when t.typname in ('text','varchar') then quote_literal('x')
                    when t.typname in ('int2','int4','int8','numeric','float4','float8') then format('1::%s', format_type(t.oid, null))
                    when t.typname = 'bool' then 'true'
                    when t.typname = 'date' then 'current_date'
                    when t.typname = 'timestamptz' then 'now()'
                    when t.typname = 'timestamp' then 'now()::timestamp'
                    when t.typname = 'jsonb' then quote_literal('{}') || '::jsonb'
                    when t.typname = '_text' then 'array[' || quote_literal('x') || ']::text[]'
                    when t.typtype = 'e' then format('(enum_range(null::%s))[1]', format_type(t.oid, null))
                    else format('null::%s', format_type(t.oid, null)) end, ', ' order by a.ord), '')
        into args from unnest(f.argt) with ordinality a(oid, ord) join pg_type t on t.oid = a.oid;
      call := format('public.%I(%s)', f.proname, args);
      tried := tried + 1;
      begin
        if f.proretset then
          execute format('select count(*)::text from %s', call) into res;
          if res <> '0' then verdict := 'leak'; end if;
        else
          execute format('select (%s)::text', call) into res;
          if res is not null and res not in ('false', '{}', '[]', 'null') then verdict := 'leak'; end if;
        end if;
      exception when others then null;   -- refused, or invalid for these arguments: nothing returned
      end;
      exit when verdict = 'leak';
    end loop;
    insert into sw_fn values (f.proname || '(' || f.sig || ')', f.proname, verdict);
  end loop;
  insert into sw_cov values ('functions', k), ('function calls', tried);
end $$;
-- The reviewed list: what each returns a supplier is a function of its own arguments (pure helpers), a bare
-- boolean or label keyed by an id nobody can guess (ownership, collision class), or the caller's own rights.
select is((select coalesce(array_agg(fn order by fn), '{}') from sw_fn where verdict = 'leak' and name <> all(array[
    'add_business_days','historical_identity_text','historical_opportunity_identity','normalize_lead_key','normalize_vendor_name',
    'opportunity_value','opportunity_win_weight','parse_historical_sales_code','project_number_denied_message','riyadh_date',
    'ai_output_entity_still_owned','historical_collision_class','next_sales_code','pricing_my_rights']::text[])),
  array[]::text[], 'Every callable function either refuses a supplier or returns it nothing, apart from the reviewed list');
select is((select array_agg(p.proname::text order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'supplier\_portal\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array['supplier_portal_confirmation','supplier_portal_file','supplier_portal_invitation','supplier_portal_invitations','supplier_portal_submit'],
  'The supplier portal API is exactly these five functions; a new supplier_portal_ function must be reviewed here');
select diag(format('Sweep coverage: %s tables and views, %s functions (%s calls)',
  (select n from sw_cov where what = 'tables and views'), (select n from sw_cov where what = 'functions'), (select n from sw_cov where what = 'function calls')));
select cmp_ok((select n from sw_cov where what = 'functions'), '>=', 100, 'The function sweep found the catalog (not an empty list)');
select cmp_ok((select n from sw_cov where what = 'tables and views'), '>=', 150, 'The table sweep found the catalog (not an empty list)');

select throws_ok($$insert into public.supplier_quotes (boq_revision_id, vendor_id, currency)
  values ('8f500001-0000-0000-0000-000000000001','8f100001-0000-0000-0000-000000000001','SAR')$$, '42501', null,
  'A supplier cannot write a quote directly');
select throws_ok($$insert into public.documents (storage_bucket, storage_path, original_filename, doc_type, uploaded_by)
  values ('attachments','x/y.pdf','y.pdf','other','8f000000-0000-0000-0000-000000000003')$$, '42501', null,
  'A supplier cannot register a document');
select is((select array_agg(project_code) from public.supplier_portal_invitations()),
  array[(select v from sw_ref where k = 'code_a')], 'Through the portal it sees its own request only');
select throws_ok(format($$select public.supplier_portal_invitation('%s')$$, (select v from sw_ref where k = 'inv_b')), '42501', null,
  'And not the other supplier''s');
select is(public.pricing_my_rights(), '{"is_gm": false, "is_pricer": false, "can_read_cost": false, "can_set_margins": false}'::jsonb,
  'The pricing rights call grants a supplier nothing');
select is(public.current_margin_floor(), null::numeric, 'Nor the margin floor');

-- 2. Every SECURITY DEFINER function a client can call checks the caller, or is on this reviewed list.
reset role;
select is((select array_agg(distinct p.proname::text order by p.proname::text)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and p.prosrc !~* '(has_app_access|is_active_user|has_role|has_any_role|can_[a-z_]+\(|is_pricer|is_pipeline_operator|is_platform_admin|is_[a-z_]+_manager|_assert_|_supplier_session_vendor|_supplier_invitation_for_session|_supplier_account_manager|is_supplier_account)'),
  array['ai_knowledge_source_current','ai_output_entity_still_owned','boq_revision_is_frozen','current_sla_days',
        'has_app_access','historical_collision_class','historical_quote_number',
        'is_display_account','next_sales_code',
        'pricing_file_propose','project_has_valid_boq','source_is_approved_for_agents'],
  'Every SECURITY DEFINER function a client can call checks the caller, or is reviewed (id-keyed, own-data or a boolean)');

-- 3. Views that bypass row security filter on the caller, run as the invoker, or are reviewed.
select is((select array_agg(c.relname::text order by c.relname::text)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('v','m')
              and has_table_privilege('authenticated', c.oid, 'SELECT')
              and not coalesce('security_invoker=true' = any(c.reloptions), false)
              and pg_get_viewdef(c.oid) !~ '(auth\.uid|has_app_access|can_read|is_pricer|is_active_user|has_role|has_any_role)'),
  array['conversion_summary','loss_analysis','pricing_file_transitions','pricing_selling_totals','sales_forecast','team_performance'],
  'Owner-run views either filter on the caller or are reviewed (built on filtered views, or static)');

-- 4. Every public table: row security on, and the session boundary.
select is((select array_agg(c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity), null::text[],
  'Row security is on for every public table');
select is((select array_agg(c.relname::text order by c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('profiles','user_roles')
              and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                                and p.policyname = 'audit_session_boundary' and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL')),
  null::text[], 'Every public table carries the restrictive session boundary');

select * from finish();
rollback;
