-- =============================================================================
-- Attachment read isolation — Phase 6 registry model (behavioural).
--
-- This suite began life against migration 109's staging policy, where access
-- came from a role plus whatever the object path happened to reveal. Phase 6
-- replaced that with the registry, so the mechanism under test changed. The
-- INTENTS did not, and they are the same numbered checks: a salesperson reaches
-- their own deal's files and nobody else's, viewer and system_admin reach
-- nothing by role alone, anon reaches nothing, and nothing leaks across buckets.
--
-- Runs as the non-superuser `rls_tester` so the storage policy is actually
-- enforced. Without the SET ROLE every check would pass vacuously.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  u_sales1 UUID; u_sales2 UUID; u_bd UUID; u_admin UUID; u_viewer UUID; u_fin UUID;
  o_mine UUID; o_theirs UUID;
  d_mine UUID; d_theirs UUID; d_inbox UUID; d_contract UUID; d_orphan UUID;
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
  INSERT INTO storage.buckets (id, name, public) VALUES ('imports','imports',false)
    ON CONFLICT (id) DO NOTHING;

  -- Five objects, uploaded by bd. Under Phase 6 the PATH no longer decides
  -- anything — the registry does — so these are deliberately flat names with no
  -- entity id embedded, to prove the link is what grants access.
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('attachments', 'ari/mine.pdf',     u_bd),
    ('attachments', 'ari/theirs.pdf',   u_bd),
    ('attachments', 'ari/inbox.xlsx',   u_bd),
    ('attachments', 'ari/contract.pdf', u_bd),
    ('attachments', 'ari/orphan.pdf',   u_bd);
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('imports', 'ari/other-bucket.csv', u_bd);

  INSERT INTO public.documents (storage_path, original_filename, uploaded_by) VALUES
    ('ari/mine.pdf','mine.pdf',u_bd)     RETURNING id INTO d_mine;
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by) VALUES
    ('ari/theirs.pdf','theirs.pdf',u_bd) RETURNING id INTO d_theirs;
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by) VALUES
    ('ari/inbox.xlsx','inbox.xlsx',u_bd) RETURNING id INTO d_inbox;
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by) VALUES
    ('ari/contract.pdf','contract.pdf',u_bd) RETURNING id INTO d_contract;
  -- Unlinked and NOT legacy: the fail-closed case.
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by) VALUES
    ('ari/orphan.pdf','orphan.pdf',u_bd) RETURNING id INTO d_orphan;

  INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by) VALUES
    (d_mine,   'opportunity', o_mine,   u_bd),
    (d_theirs, 'opportunity', o_theirs, u_bd);

  -- An inbox item and a contract, so the non-opportunity branches are exercised.
  INSERT INTO public.inbox_items (project_name, source_type, created_by)
    VALUES ('ARI intake','manual_rfq',u_bd);
  INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
  SELECT d_inbox, 'inbox_item', id, u_bd FROM public.inbox_items WHERE project_name='ARI intake';

  INSERT INTO public.contracts (opportunity_id, created_by) VALUES (o_mine, u_bd);
  INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
  SELECT d_contract, 'contract', id, u_bd FROM public.contracts WHERE opportunity_id=o_mine;
END $$;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; s1 UUID; s2 UUID; bd UUID; adm UUID; vw UUID; fin UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='s2@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='bd@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='adm@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='vw@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='fin@phc-sa.com';

  -- ===== salesperson 1 =====
  PERFORM set_config('test.uid', s1::text, false);

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='ari/mine.pdf';
  RAISE NOTICE '%  1. salesperson reads a file linked to an opportunity they OWN (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='ari/theirs.pdf';
  RAISE NOTICE '%  2. salesperson CANNOT read a file linked to an opportunity they do not own (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='ari/inbox.xlsx';
  RAISE NOTICE '%  3. salesperson cannot read an intake file they neither uploaded nor own (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The contract hangs off THEIR opportunity, so the contract branch must
  -- follow the same stake through to the deal.
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='ari/contract.pdf';
  RAISE NOTICE '%  4. salesperson reads a contract file on their own deal (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  5. salesperson sees ONLY those two (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the uploader always reads their own =====
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  6. bd_manager (uploader of all five) reads all 5 (got %)',
    CASE WHEN n=5 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== finance: linked documents yes, unlinked non-legacy no =====
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  7. finance_manager reads the 4 LINKED documents, not the unlinked one (expect 4, got %)',
    CASE WHEN n=4 THEN 'PASS' ELSE 'FAIL' END, n;

  -- This is the Phase 6 tightening that did not exist before: a document that
  -- is attached to nothing grants nothing by role.
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='ari/orphan.pdf';
  RAISE NOTICE '%  8. an unlinked, non-legacy document is invisible even to a document role (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the two tightenings carried over from migration 109 =====
  PERFORM set_config('test.uid', adm::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '%  9. system_admin ALONE reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  PERFORM set_config('test.uid', vw::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '% 10. viewer reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== anon =====
  PERFORM set_config('test.uid', '', false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments';
  RAISE NOTICE '% 11. unauthenticated reads nothing (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the policy must not leak across buckets =====
  PERFORM set_config('test.uid', bd::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='imports' AND name='ari/other-bucket.csv';
  RAISE NOTICE '% 12. the attachments policy grants nothing in other buckets (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the helper must not quietly readmit system_admin =====
  RAISE NOTICE '% 13. can_read_attachments excludes system_admin and viewer',
    CASE WHEN public.can_read_attachments(adm) = false AND public.can_read_attachments(vw) = false
         THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 14. can_read_attachments admits the commercial + finance roles',
    CASE WHEN public.can_read_attachments(bd) AND public.can_read_attachments(fin)
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== the staging helper is gone, not merely unused =====
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='attachment_entity_visible';
  RAISE NOTICE '% 15. the migration-109 path-parsing helper was dropped, not left wired-in (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  RESET ROLE;
  RAISE NOTICE '--- attachment read isolation (Phase 6 registry): done ---';
END $$;
