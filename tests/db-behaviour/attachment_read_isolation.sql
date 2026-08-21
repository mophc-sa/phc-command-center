-- =============================================================================
-- SECURITY HOTFIX — attachment read isolation (behavioural).
--
-- Runs as the non-superuser `rls_tester` so the storage policy is actually
-- enforced. Without the SET ROLE every check would pass vacuously.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- Fixtures created as owner (RLS does not apply), then read back as each role.
DO $$
DECLARE
  u_sales1 UUID; u_sales2 UUID; u_bd UUID; u_admin UUID; u_viewer UUID; u_fin UUID;
  o_mine UUID; o_theirs UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('s1@phc-sa.com'),('s2@phc-sa.com'),('bd@phc-sa.com'),
    ('adm@phc-sa.com'),('vw@phc-sa.com'),('fin@phc-sa.com');
  SELECT id INTO u_sales1 FROM auth.users WHERE email='s1@phc-sa.com';
  SELECT id INTO u_sales2 FROM auth.users WHERE email='s2@phc-sa.com';
  SELECT id INTO u_bd     FROM auth.users WHERE email='bd@phc-sa.com';
  SELECT id INTO u_admin  FROM auth.users WHERE email='adm@phc-sa.com';
  SELECT id INTO u_viewer FROM auth.users WHERE email='vw@phc-sa.com';
  SELECT id INTO u_fin    FROM auth.users WHERE email='fin@phc-sa.com';
  UPDATE public.profiles SET status='active'
   WHERE id IN (u_sales1,u_sales2,u_bd,u_admin,u_viewer,u_fin);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_sales1,'salesperson'), (u_sales2,'salesperson'), (u_bd,'bd_manager'),
    (u_admin,'system_admin'), (u_viewer,'viewer'), (u_fin,'finance_manager');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('S1 deal', u_sales1) RETURNING id INTO o_mine;
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('S2 deal', u_sales2) RETURNING id INTO o_theirs;

  INSERT INTO storage.buckets (id, name, public) VALUES ('attachments','attachments',false)
    ON CONFLICT (id) DO NOTHING;

  -- The static-folder shapes that exist in production today…
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('attachments', 'inbox/1785659980582-BOQ.xlsx',      u_bd),
    ('attachments', 'rfq/1784812295891-Overall_BOQ.xlsx', u_bd),
    ('attachments', 'contracts/1790000000000-signed.pdf', u_bd);

  -- …and the two shapes that DO carry an entity id.
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('attachments', 'evidence/'||o_mine::text||'/award-letter.pdf',   u_bd),
    ('attachments', 'evidence/'||o_theirs::text||'/their-letter.pdf', u_bd);
END $$;

SELECT id AS s1  FROM auth.users WHERE email='s1@phc-sa.com'  \gset
SELECT id AS s2  FROM auth.users WHERE email='s2@phc-sa.com'  \gset
SELECT id AS bd  FROM auth.users WHERE email='bd@phc-sa.com'  \gset
SELECT id AS adm FROM auth.users WHERE email='adm@phc-sa.com' \gset
SELECT id AS vw  FROM auth.users WHERE email='vw@phc-sa.com'  \gset
-- Resolved as owner into a temp table: after SET ROLE, opportunities RLS hides
-- these rows until a test.uid is set, and psql variables are not expanded
-- inside a dollar-quoted DO body.
CREATE TEMP TABLE probe_paths AS
SELECT
  (SELECT 'evidence/'||id::text||'/award-letter.pdf' FROM public.opportunities WHERE project_name='S1 deal') AS pmine,
  (SELECT 'evidence/'||id::text||'/their-letter.pdf' FROM public.opportunities WHERE project_name='S2 deal') AS ptheirs;
GRANT SELECT ON probe_paths TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; s1 UUID; s2 UUID; bd UUID; adm UUID; vw UUID; fin UUID; mine TEXT; theirs TEXT;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='s2@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='bd@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='adm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='vw@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='fin@phc-sa.com';
  SELECT pmine, ptheirs INTO mine, theirs FROM probe_paths;

  -- ===== salesperson 1 =====
  PERFORM set_config('test.uid', s1::text, false);

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name=mine;
  RAISE NOTICE '%  1. salesperson reads a file on an opportunity they OWN (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name=theirs;
  RAISE NOTICE '%  2. salesperson CANNOT read a file on an opportunity they do not own (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name LIKE 'inbox/%';
  RAISE NOTICE '%  3. salesperson cannot read a static-folder file they did not upload (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  4. salesperson sees ONLY their own entity file (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the uploader always reads their own =====
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  5. bd_manager (uploader + pipeline role) reads all 5 (got %)',
    CASE WHEN n=5 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== finance: contracts are their work =====
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  6. finance_manager retains access (expect 5, got %)',
    CASE WHEN n=5 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the two tightenings =====
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  7. system_admin ALONE reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  8. viewer reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== anon =====
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  9. unauthenticated reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the policy must not leak across buckets =====
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='imports';
  RAISE NOTICE '% 10. the attachments policy grants nothing in other buckets (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== fails closed on a malformed path =====
  RAISE NOTICE '% 11. a non-uuid entity segment grants nothing',
    CASE WHEN public.attachment_entity_visible('evidence/not-a-uuid/x.pdf', s1) = false THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 12. an unrecognised folder grants nothing',
    CASE WHEN public.attachment_entity_visible('random/whatever.pdf', s1) = false THEN 'PASS' ELSE 'FAIL' END;

  -- ===== the helper must not quietly readmit system_admin =====
  RAISE NOTICE '% 13. can_read_attachments excludes system_admin and viewer',
    CASE WHEN public.can_read_attachments(adm) = false AND public.can_read_attachments(vw) = false
         THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 14. can_read_attachments admits the commercial + finance roles',
    CASE WHEN public.can_read_attachments(bd) AND public.can_read_attachments(fin)
         THEN 'PASS' ELSE 'FAIL' END;

  RESET ROLE;
  RAISE NOTICE '--- attachment read isolation: done ---';
END $$;
