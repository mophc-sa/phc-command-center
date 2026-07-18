begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname not in ('spatial_ref_sys')
      and not c.relrowsecurity
  ),
  'every public application table has row-level security enabled'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE')
      )
  ),
  'anon has no direct DML grants on public application tables'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ),
  'every public SECURITY DEFINER function pins search_path'
);

select ok(
  not has_function_privilege('anon', 'public.execute_approved_record_delete(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute the approved hard-delete RPC'
);

select ok(
  not has_function_privilege('authenticated', 'public.execute_approved_record_delete(uuid, uuid)', 'EXECUTE'),
  'authenticated users cannot execute the approved hard-delete RPC directly'
);

select ok(
  not has_table_privilege('anon', 'public.vendors_public', 'SELECT'),
  'anonymous users cannot read the signed-in vendor projection'
);

select ok(
  has_table_privilege('authenticated', 'public.vendors_public', 'SELECT'),
  'signed-in users retain access to the safe vendor projection'
);

select is(
  (
    select array_agg(a.attname::text order by a.attnum)
    from pg_attribute a
    where a.attrelid = 'public.vendors_public'::regclass
      and a.attnum > 0
      and not a.attisdropped
  ),
  array[
    'id', 'name', 'scope', 'materials', 'city', 'contact_name',
    'contact_phone', 'contact_email', 'lead_time', 'quality_level',
    'previous_projects', 'portal_url', 'created_at', 'updated_at'
  ]::text[],
  'vendor projection exposes only the reviewed safe columns'
);

select ok(
  not has_function_privilege('anon', 'public.match_knowledge(extensions.vector, integer, text)', 'EXECUTE'),
  'anonymous users cannot execute semantic knowledge search'
);

select ok(
  has_function_privilege('authenticated', 'public.match_knowledge(extensions.vector, integer, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.match_knowledge(extensions.vector, integer, text)', 'EXECUTE'),
  'authorized roles retain semantic knowledge search'
);

select ok(
  not has_function_privilege('anon', 'public.protect_commercial_stage()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.protect_company_owner()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.protect_opportunity_owner()', 'EXECUTE'),
  'anonymous users cannot invoke commercial protection trigger functions directly'
);

select ok(
  not has_function_privilege('authenticated', 'public.protect_commercial_stage()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.protect_company_owner()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.protect_opportunity_owner()', 'EXECUTE'),
  'signed-in users cannot invoke commercial protection trigger functions directly'
);

select ok(
  case
    when to_regprocedure('public.rls_auto_enable()') is null then true
    else not has_function_privilege('anon', to_regprocedure('public.rls_auto_enable()'), 'EXECUTE')
  end,
  'anonymous users cannot invoke the RLS event-trigger function directly'
);

select ok(
  case
    when to_regprocedure('public.rls_auto_enable()') is null then true
    else not has_function_privilege('authenticated', to_regprocedure('public.rls_auto_enable()'), 'EXECUTE')
  end,
  'signed-in users cannot invoke the RLS event-trigger function directly'
);

select ok(
  not exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'f'
      and a.privilege_type = 'EXECUTE'
      and (
        a.grantee = 0
        or a.grantee in (
          'anon'::regrole,
          'authenticated'::regrole,
          'service_role'::regrole
        )
      )
  ),
  'postgres-created public functions require an explicit execute grant'
);

select * from finish();

rollback;
