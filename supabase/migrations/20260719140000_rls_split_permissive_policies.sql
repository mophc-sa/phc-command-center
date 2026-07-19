-- =========================================================
-- RLS Multiple Permissive Policies fix (PERF)
--
-- Problem (Supabase Advisor: multiple_permissive_policies):
--   18 tables have a FOR ALL write policy alongside a FOR SELECT
--   read policy. PostgreSQL evaluates all permissive policies
--   matching the command and ORs them together, so SELECT on
--   these tables always evaluates both USING expressions even
--   when the read policy already returns true.
--
-- Fix:
--   Convert each FOR ALL write policy into three distinct
--   policies: FOR INSERT (WITH CHECK only), FOR UPDATE (USING +
--   WITH CHECK), FOR DELETE (USING only). The FOR SELECT read
--   policy remains unchanged and becomes the sole policy for
--   SELECT queries.
--
-- Safety:
--   • The DO block reads live catalog data, so policy names and
--     expressions are never hard-coded here — rename-safe.
--   • INSERT-only policies have no USING clause (qual IS NULL).
--   • DELETE policies have no WITH CHECK clause.
--   • UPDATE policies carry both clauses.
--   • Each spawned sub-policy gets the suffix " — insert",
--     " — update", " — delete" appended to the original name.
-- =========================================================

DO $$
DECLARE
  r            record;
  qual_expr    text;
  check_expr   text;
  roles_clause text;
BEGIN
  FOR r IN
    SELECT
      c.relname                                    AS tablename,
      p.polname                                    AS policyname,
      pg_get_expr(p.polqual,      p.polrelid)      AS qual,
      pg_get_expr(p.polwithcheck, p.polrelid)      AS with_check,
      CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
           ELSE (
             SELECT string_agg(r2.rolname, ', ' ORDER BY r2.rolname)
             FROM   pg_roles r2
             WHERE  r2.oid = ANY(p.polroles)
           )
      END AS roles_str
    FROM   pg_policy   p
    JOIN   pg_class    c ON c.oid  = p.polrelid
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public'
      AND  p.polcmd = '*'   -- FOR ALL
      AND  EXISTS (         -- …and a FOR SELECT policy also exists on same table
             SELECT 1 FROM pg_policy p2
             WHERE  p2.polrelid = p.polrelid
               AND  p2.polcmd   = 'r'
           )
    ORDER  BY c.relname, p.polname
  LOOP
    qual_expr  := r.qual;
    check_expr := r.with_check;

    roles_clause := CASE
      WHEN r.roles_str IS NULL OR r.roles_str = 'PUBLIC' THEN ''
      ELSE ' TO ' || r.roles_str
    END;

    -- Drop the FOR ALL policy
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);

    -- Recreate as INSERT (WITH CHECK only — no USING for INSERT)
    -- Use qual_expr as the check if with_check is null (symmetric policies)
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT%s WITH CHECK (%s)',
      r.policyname || ' — insert',
      r.tablename,
      roles_clause,
      coalesce(check_expr, qual_expr)
    );

    -- Recreate as UPDATE (needs both USING and WITH CHECK)
    IF qual_expr IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE%s USING (%s) WITH CHECK (%s)',
        r.policyname || ' — update',
        r.tablename,
        roles_clause,
        qual_expr,
        coalesce(check_expr, qual_expr)
      );
    END IF;

    -- Recreate as DELETE (USING only — no WITH CHECK for DELETE)
    IF qual_expr IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE%s USING (%s)',
        r.policyname || ' — delete',
        r.tablename,
        roles_clause,
        qual_expr
      );
    END IF;
  END LOOP;
END;
$$;
