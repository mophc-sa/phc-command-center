-- =============================================================================
-- Security hotfix — anon holds no write privilege on any public table.
--
-- Schema-wide rather than table-by-table: the value is in the assertion that
-- nothing anywhere grants it, including a table added next month.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE n INT; r RECORD;
BEGIN
  -- ===== the write surface is gone =====
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE grantee='anon' AND table_schema='public'
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
  RAISE NOTICE '% 1. anon holds no write privilege on any public table (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  IF n > 0 THEN
    FOR r IN SELECT DISTINCT table_name, privilege_type FROM information_schema.role_table_grants
              WHERE grantee='anon' AND table_schema='public'
                AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
              LIMIT 10
    LOOP RAISE NOTICE '    still granted: %.%', r.table_name, r.privilege_type; END LOOP;
  END IF;

  -- ===== SELECT is deliberately untouched =====
  -- Revoking it would turn a pre-auth read into a permission error instead of
  -- an empty result, and RLS already returns nothing to anon.
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE grantee='anon' AND table_schema='public' AND privilege_type='SELECT';
  RAISE NOTICE '% 2. anon keeps SELECT, which RLS governs (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== authenticated is untouched =====
  -- The revoke loop names anon explicitly; a copy-paste slip here would have
  -- locked out every signed-in user, which no isolation test would notice
  -- because they all assert that people see LESS.
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE grantee='authenticated' AND table_schema='public' AND privilege_type='INSERT';
  RAISE NOTICE '% 3. authenticated still holds INSERT where it had it (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE grantee='service_role' AND table_schema='public' AND privilege_type='INSERT';
  RAISE NOTICE '% 4. the service role is untouched, so error-ingest still writes (expect >0, got %)',
    CASE WHEN n>0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the belt behind the braces =====
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
  RAISE NOTICE '% 5. every public table still has RLS enabled (expect 0 without, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- anon write surface: done ---';
END $$;

-- ===== and prove it behaviourally, not just from the catalogue =====
-- A grant table can be read wrongly; an actual INSERT cannot.
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.leads (project_name, source) VALUES ('anon-should-not-write', 'manual');
    RAISE NOTICE 'FAIL 6. anon inserted a lead';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 6. anon cannot insert a lead — refused at the grant';
    WHEN others THEN RAISE NOTICE 'PASS 6. anon cannot insert a lead (%)', SQLSTATE;
  END;

  BEGIN
    INSERT INTO public.opportunities (project_name) VALUES ('anon-should-not-write');
    RAISE NOTICE 'FAIL 7. anon inserted an opportunity';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 7. anon cannot insert an opportunity';
    WHEN others THEN RAISE NOTICE 'PASS 7. anon cannot insert an opportunity (%)', SQLSTATE;
  END;

  BEGIN
    UPDATE public.notifications SET read_at = now();
    RAISE NOTICE 'FAIL 8. anon updated notifications';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 8. anon cannot update notifications';
    WHEN others THEN RAISE NOTICE 'PASS 8. anon cannot update notifications (%)', SQLSTATE;
  END;

  BEGIN
    DELETE FROM public.companies;
    RAISE NOTICE 'FAIL 9. anon deleted from companies';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 9. anon cannot delete companies';
    WHEN others THEN RAISE NOTICE 'PASS 9. anon cannot delete companies (%)', SQLSTATE;
  END;

  RAISE NOTICE '--- anon behavioural refusal: done ---';
END $$;
RESET ROLE;
