-- document_backfill_status and the two other owner-run views run as the caller
-- and are not readable by anon (20261109100000).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(coalesce('security_invoker=true' = any(c.reloptions), false),
          c.relname || ' runs as the caller')
  from pg_class c
 where c.oid in ('public.document_backfill_status'::regclass,
                 'public.automation_health'::regclass,
                 'public.vendor_duplicate_candidates'::regclass)
 order by c.relname;

select ok(not has_table_privilege('anon', v, 'SELECT'), v::text || ' is not readable by anon')
  from unnest(array['public.document_backfill_status'::regclass,
                    'public.automation_health'::regclass,
                    'public.vendor_duplicate_candidates'::regclass]) as v
 order by v::text;

select * from finish();
rollback;
