-- =========================================================
-- RLS Initialization Plan optimization (PERF)
--
-- Problem (Supabase Advisor: auth_rls_initplan):
--   Every RLS policy that calls auth.uid() re-evaluates it once
--   per row. PostgreSQL's query planner can hoist a function call
--   to a single InitPlan (once per statement) only when it is
--   wrapped in a scalar sub-select: (select auth.uid()).
--
-- Fix:
--   Re-create all affected policies replacing auth.uid() with
--   (select auth.uid()). The DO block below handles this
--   programmatically so future policies added via this pattern
--   can be identified and patched in a single place.
--
-- Safety:
--   • All changes are in a single transaction. If any policy
--     fails to recreate, the entire migration rolls back.
--   • Policy expressions come from pg_get_expr(), which returns
--     valid PostgreSQL syntax; the only substitution is the
--     literal string 'auth.uid()' → '(select auth.uid())'.
--   • Roles and command types are preserved from the live catalog.
-- =========================================================

DO $$
DECLARE
  r            record;
  new_qual     text;
  new_check    text;
  cmd_name     text;
  roles_clause text;
  create_sql   text;
BEGIN
  FOR r IN
    SELECT
      c.relname                                    AS tablename,
      p.polname                                    AS policyname,
      p.polcmd,
      pg_get_expr(p.polqual,      p.polrelid)      AS qual,
      pg_get_expr(p.polwithcheck, p.polrelid)      AS with_check,
      -- Resolve role OIDs to names; '{0}' means no role restriction
      CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
           ELSE (
             SELECT string_agg(pg_roles.rolname, ', ' ORDER BY pg_roles.rolname)
             FROM   pg_roles
             WHERE  pg_roles.oid = ANY(p.polroles)
           )
      END AS roles_str
    FROM   pg_policy   p
    JOIN   pg_class    c ON c.oid  = p.polrelid
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND (
        pg_get_expr(p.polqual,      p.polrelid) LIKE '%auth.uid()%'
        OR
        pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%auth.uid()%'
      )
    ORDER BY c.relname, p.polname
  LOOP
    -- Substitute auth.uid() → (select auth.uid()) in both clauses
    new_qual  := replace(r.qual,       'auth.uid()', '(select auth.uid())');
    new_check := replace(r.with_check, 'auth.uid()', '(select auth.uid())');

    -- Map polcmd internal char to SQL keyword
    cmd_name := CASE r.polcmd
      WHEN '*' THEN 'ALL'
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
    END;

    roles_clause := CASE
      WHEN r.roles_str IS NULL OR r.roles_str = 'PUBLIC' THEN ''
      ELSE ' TO ' || r.roles_str
    END;

    -- Drop then recreate
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);

    IF new_qual IS NOT NULL AND new_check IS NOT NULL THEN
      create_sql := format('CREATE POLICY %I ON public.%I FOR %s%s USING (%s) WITH CHECK (%s)',
                           r.policyname, r.tablename, cmd_name, roles_clause,
                           new_qual, new_check);
    ELSIF new_qual IS NOT NULL THEN
      create_sql := format('CREATE POLICY %I ON public.%I FOR %s%s USING (%s)',
                           r.policyname, r.tablename, cmd_name, roles_clause, new_qual);
    ELSE
      -- INSERT-only: no USING clause, only WITH CHECK
      create_sql := format('CREATE POLICY %I ON public.%I FOR %s%s WITH CHECK (%s)',
                           r.policyname, r.tablename, cmd_name, roles_clause, new_check);
    END IF;

    EXECUTE create_sql;
  END LOOP;
END;
$$;
