begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

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

select * from finish();

rollback;
