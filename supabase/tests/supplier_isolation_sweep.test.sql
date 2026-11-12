-- PR 3 Task 5: a supplier sees its own request and nothing else in the schema.
-- A sweep over every table and view, the storage objects, the SECURITY DEFINER
-- functions a client can call, and the views that bypass row security.
-- Test user UUIDs use the 8f prefix.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

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
-- An SLA in force for the first subject (the sweep passes the first enum label).
insert into public.sla_policies (subject, threshold_days, rationale, effective_from)
values ((enum_range(null::public.sla_subject))[1], 5, 'sw-sla', now() - interval '1 day');
-- One archive row, so the archive helpers have something to answer about.
insert into public.historical_sales_batches (id, source_file) values ('8fa00001-0000-0000-0000-000000000001', 'sw-archive.xlsx');
insert into public.historical_sales_rows (id, batch_id, row_number, raw)
values ('8fa10001-0000-0000-0000-000000000001', '8fa00001-0000-0000-0000-000000000001', 3, '{"code":"SW26001"}');
insert into public.historical_sales_mapped (row_id, batch_id, sales_code_raw, base_code)
values ('8fa10001-0000-0000-0000-000000000001', '8fa00001-0000-0000-0000-000000000001', 'SW26001', 'SW26001');
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
insert into public.estimations (id, boq_revision_id, cost_total) values ('8f900001-0000-0000-0000-000000000001','8f500002-0000-0000-0000-000000000001', 1500);
insert into public.internal_prices (id, estimation_id, proposed_price, proposed_by)
values ('8f910001-0000-0000-0000-000000000001','8f900001-0000-0000-0000-000000000001', 2500, '8f000000-0000-0000-0000-000000000002');
insert into public.documents (id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checksum, doc_type, uploaded_by)
select ('8f70000' || n || '-0000-0000-0000-000000000001')::uuid, 'attachments', 'opportunity/8f' || n || '/a.pdf', 'a.pdf', 'application/pdf',
       1000, repeat('a',64), 'drawing', '8f000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into public.document_links (document_id, entity_type, entity_id, linked_by)
select ('8f70000' || n || '-0000-0000-0000-000000000001')::uuid, 'opportunity', ('8f20000' || n || '-0000-0000-0000-000000000001')::uuid,
       '8f000000-0000-0000-0000-000000000001'
  from generate_series(1,2) n;
insert into storage.objects (bucket_id, name, owner, version, metadata)
select 'attachments', 'opportunity/8f' || n || '/a.pdf', '8f000000-0000-0000-0000-000000000001', 'v1', '{"size": 1000}' from generate_series(1,2) n;
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
-- One row per swept function: its verdict, how many calls returned normally (with an answer or empty),
-- how many were refused with 42501, and the other error codes it raised.
create temp table sw_fn (fn regprocedure, verdict text, answered integer, empty integer, denied integer, codes text);
-- Candidate ids for the function sweep: the other supplier's request, file, deal, BOQ, revision, line,
-- document and vendor, this supplier's own, an estimation, an internal price, an archive row, both staff
-- users and an id that matches nothing. Captured as the owner, because the supplier cannot read them.
create temp table sw_ids (ord serial, id uuid);
grant all on sw_seen, sw_cov, sw_fn, sw_ids to authenticated;
insert into sw_ids (id) values
  ((select v::uuid from sw_ref where k = 'inv_a')), ((select v::uuid from sw_ref where k = 'inv_b')),
  ('8f600001-0000-0000-0000-000000000001'), ('8f600002-0000-0000-0000-000000000001'),
  ('8f200001-0000-0000-0000-000000000001'), ('8f200002-0000-0000-0000-000000000001'),
  ('8f400001-0000-0000-0000-000000000001'), ('8f400002-0000-0000-0000-000000000001'),
  ('8f500001-0000-0000-0000-000000000001'), ('8f500002-0000-0000-0000-000000000001'),
  ('8f510001-0000-0000-0000-000000000001'), ('8f510002-0000-0000-0000-000000000001'),
  ('8f700001-0000-0000-0000-000000000001'), ('8f700002-0000-0000-0000-000000000001'),
  ('8f100001-0000-0000-0000-000000000001'), ('8f100002-0000-0000-0000-000000000001'),
  ('8f000000-0000-0000-0000-000000000003'), ('8f000000-0000-0000-0000-000000000004'),
  ('8f000000-0000-0000-0000-000000000001'), ('8f000000-0000-0000-0000-000000000002'),
  ('8f800001-0000-0000-0000-000000000001'), ('8f900001-0000-0000-0000-000000000001'),
  ('8f910001-0000-0000-0000-000000000001'), ('8fa10001-0000-0000-0000-000000000001'),
  ('8f000000-0000-0000-0000-0000000000ff');
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
select is((select array_agg(rel || '=' || n order by rel) from sw_seen), array['pricing_file_transitions=15','profiles=1','user_roles=1'],
  'A supplier reads only its own profile and role, and the static state map, in every table and view');
select is((select count(*)::int from storage.objects), 0, 'A supplier reads no stored file');

-- 1b. Every function in public that a client can call, as supplier A, in 2N+1 rounds over the N candidate ids:
--   round 0: every argument null;
--   rounds 1..N: candidate r in every uuid position;
--   rounds N+1..2N: the candidates rotated across the uuid positions (so each candidate sits in each position
--   once, and two-id functions get different ids), with a staff user id in parameters named _user_id/_user/_uid.
-- Other types get a plain value (an enum's first label, an enum array's full range; text by parameter name).
-- A call that returns rows or a value other than null/false/empty "answered"; one that returns nothing is
-- "empty"; one that raises 42501 is "denied". Any other error proves nothing, so a function whose every call
-- raised another code is "inconclusive". Both "answered" and "inconclusive" must be on the reviewed list.
do $$ declare f record; call text; args text; res text; st text; r integer; n integer; c uuid[]; s uuid[];
          k integer := 0; tried integer := 0; ok integer := 0; a_n integer; e_n integer; d_n integer; codes text[]; begin
  select array_agg(id order by ord) into c from sw_ids;
  n := cardinality(c);
  s := array['8f000000-0000-0000-0000-000000000001','8f000000-0000-0000-0000-000000000002']::uuid[];
  for f in
    select p.oid, p.proname, p.proretset, p.proargtypes::oid[] as argt,
           (select array_agg(x.nm order by x.o) from unnest(p.proargnames, p.proargmodes) with ordinality x(nm, md, o)
             where coalesce(x.md, 'i') in ('i','b','v')) as argn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f','p') and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and p.proname !~ '^supplier_portal_(invitations?|submit|file)$'
     order by p.proname, p.oid
  loop
    k := k + 1; a_n := 0; e_n := 0; d_n := 0; codes := '{}';
    for r in 0 .. 2 * n loop
      select coalesce(string_agg(case
               when r = 0 then format('null::%s', format_type(a.oid, null))
               when a.oid in ('uuid'::regtype, 'uuid[]'::regtype) then
                 format(case when a.oid = 'uuid'::regtype then '%L::uuid' else 'array[%L]::uuid[]' end,
                        case when r <= n then c[r]
                             when coalesce(a.nm, '') ~ '^_(user_id|user|uid)$' then s[r % 2 + 1]
                             else c[(r - n - 1 + a.u - 1) % n + 1] end)
               when a.typname in ('text','varchar') then quote_literal(case
                 when a.nm = '_bucket' then 'attachments' when a.nm = '_path' then 'opportunity/8f1/a.pdf' when a.nm = '_action' then 'approve'
                 when coalesce(a.nm, '') ~ 'type$' then 'opportunity' else 'x' end)
               when a.typname in ('int2','int4','int8','numeric','float4','float8') then format('1::%s', format_type(a.oid, null))
               when a.typname = 'bool' then 'true'
               when a.typname = 'date' then 'current_date'
               when a.typname = 'timestamptz' then 'now()'
               when a.typname = 'timestamp' then 'now()::timestamp'
               when a.typname = 'jsonb' then quote_literal('{}') || '::jsonb'
               when a.typname = '_text' then 'array[' || quote_literal('x') || ']::text[]'
               when a.typtype = 'e' then format('(enum_range(null::%s))[1]', format_type(a.oid, null))
               when a.elemtype = 'e' then format('enum_range(null::%s)', format_type(a.typelem, null))
               else format('null::%s', format_type(a.oid, null)) end, ', ' order by a.ord), '')
        into args
        from (select x.oid, x.nm, x.ord, t.typname, t.typtype, t.typelem, et.typtype as elemtype,
                     count(*) filter (where x.oid in ('uuid'::regtype, 'uuid[]'::regtype)) over (order by x.ord) as u
                from unnest(f.argt, f.argn) with ordinality x(oid, nm, ord)
                join pg_type t on t.oid = x.oid left join pg_type et on et.oid = t.typelem) a;
      call := format('public.%I(%s)', f.proname, args);
      tried := tried + 1;
      begin
        if f.proretset then
          execute format('select count(*)::text from %s', call) into res;
          if res = '0' then res := null; end if;
        else
          execute format('select (%s)::text', call) into res;
        end if;
        ok := ok + 1;
        if res is null or res in ('', 'false', '{}', '[]', 'null') then e_n := e_n + 1; else a_n := a_n + 1; end if;
      exception when others then
        st := SQLSTATE;
        if st = '42501' then d_n := d_n + 1; elsif st <> all(codes) then codes := codes || st; end if;
      end;
    end loop;
    insert into sw_fn values (f.oid::regprocedure,
      case when a_n > 0 then 'answered' when d_n + e_n > 0 then 'refused' else 'inconclusive' end,
      a_n, e_n, d_n, array_to_string(codes, ','));
  end loop;
  insert into sw_cov values ('functions', k), ('function calls', tried), ('calls returned', ok), ('candidates', n);
end $$;
reset role;
-- The reviewed list, by signature. "answers": what it tells a supplier is a function of its own arguments (pure
-- helpers), the caller's own rights, or a yes/no keyed by uuids the portal never discloses (staff user ids,
-- deal, document, BOQ and revision ids); gating those would change the row security that calls them.
-- "inconclusive": raises a non-permission error on every argument the sweep can build (justified per row).
create temp table sw_allow (fn regprocedure primary key, kind text not null, why text not null);
insert into sw_allow (fn, why, kind) values
  -- Pure: the answer is computed from the arguments alone.
  ('public.add_business_days(date,integer)', 'Pure: a date from its arguments.', 'answers'),
  ('public.historical_identity_text(text)', 'Pure: normalises its text argument.', 'answers'),
  ('public.historical_opportunity_identity(text,text,text,numeric,text)', 'Pure: a key built from its arguments.', 'answers'),
  ('public.normalize_lead_key(text,text)', 'Pure: normalises its arguments.', 'answers'),
  ('public.normalize_vendor_name(text)', 'Pure: normalises its argument.', 'answers'),
  ('public.opportunity_value(numeric,numeric,numeric)', 'Pure: arithmetic on its arguments.', 'answers'),
  ('public.opportunity_win_weight(integer,win_confidence)', 'Pure: a weight from its arguments.', 'answers'),
  ('public.parse_historical_sales_code(text)', 'Pure: parses its argument.', 'answers'),
  ('public.project_number_denied_message()', 'Static: a fixed message.', 'answers'),
  ('public.riyadh_date(timestamp with time zone)', 'Pure: a date from its argument.', 'answers'),
  -- The caller's own data, or a company setting.
  ('public.pricing_my_rights()', 'The caller''s own pricing rights (all false for a supplier, asserted below).', 'answers'),
  ('public.current_sla_days(sla_subject)', 'An SLA threshold in days: a company setting, no record, client, cost or vendor data.', 'answers'),
  -- Yes/no keyed by ids the portal never discloses (staff user ids, deal, BOQ, revision, document ids).
  -- They back row security and other definer functions; gating them on the caller would change those rules.
  ('public.ai_output_entity_still_owned(text,uuid,uuid)', 'Yes/no: is this entity owned by this user (true for unknown types).', 'answers'),
  ('public.boq_revision_is_frozen(uuid)', 'Yes/no: is this BOQ revision frozen; revision ids are never shown to a supplier.', 'answers'),
  ('public.has_app_access(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.is_active_user(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.is_pricer(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.is_sales_contributor(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.has_role(uuid,app_role)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.has_any_role(uuid,app_role[])', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_edit_total_value(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_read_attachments(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_read_commercial_cost(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_read_historical_sales(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_read_sales_analytics(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_set_pricing_margins(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_view_all_sales_data(uuid)', 'Yes/no keyed by a staff user id the portal never discloses.', 'answers'),
  ('public.can_edit_project_budget(uuid,uuid)', 'Yes/no keyed by a project id and a staff user id.', 'answers'),
  ('public.can_read_activity(uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'Yes/no keyed by record ids and a staff user id.', 'answers'),
  ('public.can_read_ai_recommendation(text,uuid,uuid)', 'Yes/no keyed by an entity id and a staff user id.', 'answers'),
  ('public.can_read_approval(uuid,uuid,uuid,uuid)', 'Yes/no keyed by a deal id, user ids and a staff user id.', 'answers'),
  ('public.can_read_boq(uuid,uuid)', 'Yes/no keyed by a deal id and a staff user id.', 'answers'),
  ('public.can_read_boq_revision(uuid,uuid)', 'Yes/no keyed by a revision id and a staff user id.', 'answers'),
  ('public.can_read_contract(uuid,uuid,uuid,uuid)', 'Yes/no keyed by a deal id, user ids and a staff user id.', 'answers'),
  ('public.can_read_document(uuid,uuid)', 'Yes/no keyed by a document id and a staff user id.', 'answers'),
  ('public.can_read_opportunity_flag(text,uuid,uuid,uuid)', 'Yes/no keyed by a record id and a staff user id.', 'answers'),
  ('public.can_read_opportunity_record(uuid,uuid)', 'Yes/no keyed by a deal id and a staff user id.', 'answers'),
  ('public.document_entity_grants(document_entity_type,uuid,uuid)', 'Yes/no keyed by an entity id and a staff user id.', 'answers'),
  ('public.storage_object_readable(text,text,uuid)', 'Yes/no keyed by a storage path and a staff user id (backs the storage policy).', 'answers');
select diag(format('Sweep coverage: %s tables and views, %s functions, %s candidate ids, %s calls, %s returned normally',
  (select n from sw_cov where what = 'tables and views'), (select n from sw_cov where what = 'functions'),
  (select n from sw_cov where what = 'candidates'), (select n from sw_cov where what = 'function calls'),
  (select n from sw_cov where what = 'calls returned')));
select is((select coalesce(array_agg(f.fn::text order by f.fn::text), '{}') from sw_fn f
            where f.verdict = 'answered' and not exists (select 1 from sw_allow a where a.fn = f.fn and a.kind = 'answers')),
  array[]::text[], 'Every callable function refuses a supplier (42501) or returns it nothing, apart from the reviewed list');
select is((select coalesce(array_agg(f.fn::text || ' ' || f.codes order by f.fn::text), '{}') from sw_fn f
            where f.verdict = 'inconclusive' and not exists (select 1 from sw_allow a where a.fn = f.fn and a.kind = 'inconclusive')),
  array[]::text[], 'No function is inconclusive (every call raised something other than 42501)');
-- Positive checks: the argument builder reaches real answers, so "refused" above means refused.
select is((select array_agg(f.fn::text || '=' || f.verdict order by f.fn::text) from sw_fn f where f.fn in (
    'public.add_business_days(date,integer)'::regprocedure, 'public.pricing_my_rights()'::regprocedure,
    'public.is_active_user(uuid)'::regprocedure, 'public.boq_revision_is_frozen(uuid)'::regprocedure,
    'public.current_sla_days(sla_subject)'::regprocedure, 'public.has_any_role(uuid,app_role[])'::regprocedure,
    'public.historical_collision_class(uuid)'::regprocedure, 'public.historical_quote_number(uuid)'::regprocedure)),
  array['add_business_days(date,integer)=answered','boq_revision_is_frozen(uuid)=answered','current_sla_days(sla_subject)=answered',
        'has_any_role(uuid,app_role[])=answered','historical_collision_class(uuid)=refused','historical_quote_number(uuid)=refused',
        'is_active_user(uuid)=answered','pricing_my_rights()=answered'],
  'Known answers come back (pure helper, own rights, staff id, revision id, seeded SLA, enum array); the archive helpers refuse');
-- Floor: the 10 pure helpers, pricing_my_rights and current_sla_days return in every non-null round (12 x 2N),
-- and every refused-empty boolean helper returns in every round; a broken builder (every call raising) falls far below.
select cmp_ok((select n from sw_cov where what = 'calls returned'), '>=',
  (select 12 * 2 * n + 30 * (2 * n + 1) from sw_cov where what = 'candidates'),
  'Enough calls returned normally that the refusals are real');
select is((select n from sw_cov where what = 'candidates'), 25, 'All 25 candidate ids were swept');
select ok(not has_function_privilege('authenticated', 'public.next_sales_code(text,text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.next_sales_code(text,text)', 'EXECUTE'),
  'next_sales_code is closed to clients (only the definer trigger allocates codes)');
-- Staff and internal callers still get the archive answers.
select set_config('request.jwt.claims','',true);
select is(public.historical_quote_number('8fa10001-0000-0000-0000-000000000001') || '/' || public.historical_collision_class('8fa10001-0000-0000-0000-000000000001'),
  'SW26001/NO_COLLISION', 'With no user session the archive helpers answer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8f000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is(public.historical_quote_number('8fa10001-0000-0000-0000-000000000001') || '/' || public.historical_collision_class('8fa10001-0000-0000-0000-000000000001'),
  'SW26001/NO_COLLISION', 'An archive reader still gets them');
select set_config('request.jwt.claims','{"sub":"8f000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select array_agg(p.proname::text order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'supplier\_portal\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array['supplier_portal_confirmation','supplier_portal_file','supplier_portal_invitation','supplier_portal_invitations','supplier_portal_submit'],
  'The supplier portal API is exactly these five functions; a new supplier_portal_ function must be reviewed here');
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
select is(public.pricing_my_rights(), '{"is_gm": false, "is_pricer": false, "can_read_cost": false, "can_set_margins": false, "is_finance": false, "can_issue_quotation": false}'::jsonb,
  'The pricing rights call grants a supplier nothing');
select is(public.current_margin_floor(), null::numeric, 'Nor the margin floor');

-- 2. Every SECURITY DEFINER function a client can call checks the caller, or is on this reviewed list.
reset role;
-- Compared by signature, both ways: a new unchecked function and a stale entry both fail.
create temp table sw_sd_reviewed (fn regprocedure primary key, why text not null);
insert into sw_sd_reviewed values
  ('public.ai_knowledge_source_current(text,uuid,timestamp with time zone)', 'Yes/no keyed by a knowledge source id.'),
  ('public.ai_output_entity_still_owned(text,uuid,uuid)', 'Yes/no keyed by an entity id and a user id.'),
  ('public.boq_revision_is_frozen(uuid)', 'Yes/no keyed by a revision id.'),
  ('public.current_sla_days(sla_subject)', 'A company SLA setting.'),
  ('public.has_app_access(uuid)', 'The boundary predicate itself: yes/no keyed by a user id.'),
  ('public.is_display_account(uuid)', 'Yes/no keyed by a user id.'),
  ('public.pricing_file_propose(uuid,numeric,numeric,text)', 'Checks the caller through pricing_file_build_price.'),
  ('public.project_has_valid_boq(uuid)', 'Yes/no keyed by a project id.'),
  ('public.source_is_approved_for_agents(text)', 'Yes/no keyed by a source name.');
select is((select coalesce(array_agg(x order by x), '{}') from (
             (select '+' || p.oid::regprocedure::text as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
                 and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 and p.prosrc !~* '(has_app_access|is_active_user|has_role|has_any_role|can_[a-z_]+\(|is_pricer|is_pipeline_operator|is_platform_admin|is_[a-z_]+_manager|_assert_|_supplier_session_vendor|_supplier_invitation_for_session|_supplier_account_manager|is_supplier_account)'
              except select '+' || fn::text from sw_sd_reviewed)
             union all
             (select '-' || r.fn::text from sw_sd_reviewed r
               where not has_function_privilege('authenticated', r.fn, 'EXECUTE')
                  or (select p.prosrc ~* '(has_app_access|is_active_user|has_role|has_any_role|can_[a-z_]+\(|is_pricer|is_pipeline_operator|is_platform_admin|is_[a-z_]+_manager|_assert_|_supplier_session_vendor|_supplier_invitation_for_session|_supplier_account_manager|is_supplier_account)'
                        from pg_proc p where p.oid = r.fn))) d),
  array[]::text[],
  'Every SECURITY DEFINER function a client can call checks the caller, or is reviewed by signature (+ unreviewed, - stale)');

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
                                and p.policyname = 'audit_session_boundary' and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
                                and p.qual ~ 'has_app_access')),
  null::text[], 'Every public table carries the restrictive session boundary');

select * from finish();
rollback;
