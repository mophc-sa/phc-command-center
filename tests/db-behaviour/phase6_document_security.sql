-- =============================================================================
-- Phase 6 — document access, adversarially.
--
-- The read-isolation suite proves the happy paths and the role tightenings.
-- This one goes after the ways the registry could be turned into an escalation
-- path, because a link table is exactly the sort of thing that grants access by
-- accident: attach someone else's file to your own record and read it.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  s1 UUID; s2 UUID; bd UUID; vw UUID; adm UUID; sus UUID; vw2 UUID; est UUID; fin UUID;
  o1 UUID; o2 UUID; p1 UUID; k1 UUID;
  d_theirs UUID; d_mine UUID; d_project UUID; d_contract UUID;
BEGIN
  INSERT INTO auth.users (email) VALUES
    ('p6s1@phc-sa.com'),('p6s2@phc-sa.com'),('p6bd@phc-sa.com'),
    ('p6vw@phc-sa.com'),('p6adm@phc-sa.com'),('p6sus@phc-sa.com'),('p6vw2@phc-sa.com'),
    ('p6est@phc-sa.com'),('p6fin@phc-sa.com');
  SELECT id INTO s1  FROM auth.users WHERE email='p6s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='p6s2@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='p6bd@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='p6vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='p6adm@phc-sa.com';
  SELECT id INTO sus FROM auth.users WHERE email='p6sus@phc-sa.com';
  SELECT id INTO vw2 FROM auth.users WHERE email='p6vw2@phc-sa.com';
  SELECT id INTO est FROM auth.users WHERE email='p6est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='p6fin@phc-sa.com';
  UPDATE public.profiles SET status='active'    WHERE id IN (s1,s2,bd,vw,adm,vw2,est,fin);
  -- A suspended account that WOULD otherwise qualify: same role as bd.
  UPDATE public.profiles SET status='suspended' WHERE id = sus;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (s1,'salesperson'),(s2,'salesperson'),(bd,'bd_manager'),
    (vw,'viewer'),(adm,'system_admin'),(sus,'bd_manager'),
    -- the same person holding a read-only role AND a document role
    (vw2,'viewer'),(vw2,'finance_manager'),
    -- In D24's attachment list but NOT in the contract read set — the exact
    -- mismatch checks 17-23 exist to close.
    (est,'estimation_manager'),
    -- In both, so it must reach the contract's documents.
    (fin,'finance_manager');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('P6 mine', s1)   RETURNING id INTO o1;
  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('P6 theirs', s2) RETURNING id INTO o2;
  INSERT INTO public.projects (name) VALUES ('P6 site') RETURNING id INTO p1;

  INSERT INTO storage.buckets (id,name,public) VALUES ('attachments','attachments',false)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.objects (bucket_id,name,owner) VALUES
    ('attachments','p6/theirs.pdf', bd),
    ('attachments','p6/mine.pdf',   bd),
    ('attachments','p6/project.pdf',bd),
    ('attachments','p6/contract.pdf',bd);

  INSERT INTO public.documents (storage_path, original_filename, uploaded_by)
    VALUES ('p6/theirs.pdf','theirs.pdf',bd) RETURNING id INTO d_theirs;
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by)
    VALUES ('p6/mine.pdf','mine.pdf',bd)     RETURNING id INTO d_mine;
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by)
    VALUES ('p6/project.pdf','project.pdf',bd) RETURNING id INTO d_project;

  INSERT INTO public.documents (storage_path, original_filename, uploaded_by)
    VALUES ('p6/contract.pdf','contract.pdf',bd) RETURNING id INTO d_contract;

  -- A contract on s1's deal, with a document attached to it. This is the case
  -- where document access must agree with contract-record access.
  INSERT INTO public.contracts (opportunity_id, contract_name, created_by)
    VALUES (o1, 'P6 contract', bd) RETURNING id INTO k1;

  INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by) VALUES
    (d_theirs,  'opportunity', o2, bd),
    (d_mine,    'opportunity', o1, bd),
    (d_project, 'project',     p1, bd),
    (d_contract,'contract',    k1, bd);
END $$;

CREATE TEMP TABLE p6 AS SELECT
  (SELECT id FROM public.documents   WHERE storage_path='p6/theirs.pdf')  AS d_theirs,
  (SELECT id FROM public.documents   WHERE storage_path='p6/mine.pdf')    AS d_mine,
  (SELECT id FROM public.documents   WHERE storage_path='p6/project.pdf') AS d_project,
  (SELECT id FROM public.opportunities WHERE project_name='P6 mine')      AS o1,
  (SELECT id FROM public.opportunities WHERE project_name='P6 theirs')    AS o2,
  (SELECT id FROM public.projects    WHERE name='P6 site')                AS p1,
  (SELECT id FROM public.contracts   WHERE contract_name='P6 contract')    AS k1,
  (SELECT id FROM public.documents   WHERE storage_path='p6/contract.pdf') AS d_contract;
GRANT SELECT ON p6 TO rls_tester;

SET ROLE rls_tester;

DO $$
DECLARE
  n INT; s1 UUID; s2 UUID; bd UUID; vw UUID; adm UUID; sus UUID; vw2 UUID;
  -- Prefixed: plpgsql resolves a bare name to the COLUMN when a variable and a
  -- column of the temp table share it, and the error says only "ambiguous".
  v_theirs UUID; v_mine UUID; v_project UUID; v_o1 UUID; v_o2 UUID; v_p1 UUID;
  v_k1 UUID; v_dk UUID; est UUID; fin UUID;
BEGIN
  SELECT id INTO s1  FROM auth.users WHERE email='p6s1@phc-sa.com';
  SELECT id INTO s2  FROM auth.users WHERE email='p6s2@phc-sa.com';
  SELECT id INTO bd  FROM auth.users WHERE email='p6bd@phc-sa.com';
  SELECT id INTO vw  FROM auth.users WHERE email='p6vw@phc-sa.com';
  SELECT id INTO adm FROM auth.users WHERE email='p6adm@phc-sa.com';
  SELECT id INTO sus FROM auth.users WHERE email='p6sus@phc-sa.com';
  SELECT id INTO vw2 FROM auth.users WHERE email='p6vw2@phc-sa.com';
  SELECT d_theirs, d_mine, d_project, o1, o2, p1, k1, d_contract
    INTO v_theirs, v_mine, v_project, v_o1, v_o2, v_p1, v_k1, v_dk FROM p6;
  SELECT id INTO est FROM auth.users WHERE email='p6est@phc-sa.com';
  SELECT id INTO fin FROM auth.users WHERE email='p6fin@phc-sa.com';

  -- ===== 1. the escalation the link table invites =====
  -- s1 owns v_o1. If they may attach someone else's document to their own
  -- opportunity, the registry becomes a read primitive for the whole bucket.
  PERFORM set_config('test.uid', s1::text, false);
  BEGIN
    INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
    VALUES (v_theirs, 'opportunity', v_o1, s1);
    RAISE NOTICE 'FAIL  1. a salesperson attached a document they cannot read to their own deal';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'PASS  1. cannot link a document you cannot already read (escalation refused)';
  END;

  -- ===== 2. …and not the mirror image either =====
  -- Linking a document you CAN read to an entity you cannot reach would leak
  -- the entity's document list rather than the file, but it is still a forgery.
  BEGIN
    INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
    VALUES (v_mine, 'opportunity', v_o2, s1);
    RAISE NOTICE 'FAIL  2. a salesperson linked into an opportunity they cannot reach';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'PASS  2. cannot link into a record you cannot reach';
  END;

  -- ===== 3. linking as somebody else =====
  BEGIN
    INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
    VALUES (v_mine, 'project', v_p1, bd);
    RAISE NOTICE 'FAIL  3. linked_by could be forged';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'PASS  3. linked_by must be you';
  END;

  -- ===== 4. repointing a row at someone else's object =====
  -- The nastiest one: own a document row, change its path. The trigger, not the
  -- policy, is what stops this.
  PERFORM set_config('test.uid', bd::text, false);
  BEGIN
    UPDATE public.documents SET storage_path='p6/theirs.pdf' WHERE id=v_mine;
    RAISE NOTICE 'FAIL  4. a document row was repointed at a different object';
  EXCEPTION WHEN raise_exception OR unique_violation THEN
    RAISE NOTICE 'PASS  4. storage_path is immutable — a row cannot be repointed';
  END;

  -- ===== 5. rewriting provenance =====
  BEGIN
    UPDATE public.documents SET uploaded_by=s1 WHERE id=v_mine;
    RAISE NOTICE 'FAIL  5. uploaded_by could be rewritten';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS  5. uploaded_by is immutable';
  END;

  -- ===== 6. physical delete must be impossible =====
  BEGIN
    DELETE FROM public.documents WHERE id=v_mine;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '%  6. no DELETE policy on documents — a delete removes nothing (rows=%)',
      CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  6. physical delete on documents is refused outright';
  END;

  BEGIN
    DELETE FROM public.document_links WHERE document_id=v_mine;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '%  7. no DELETE policy on document_links either (rows=%)',
      CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  7. physical delete on document_links is refused outright';
  END;

  -- ===== 8. a link pointing at nothing =====
  RAISE NOTICE '%  8. a link to a non-existent record grants nothing',
    CASE WHEN public.document_entity_grants('opportunity', gen_random_uuid(), bd) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== 9. suspended account =====
  RAISE NOTICE '%  9. a suspended bd_manager reaches nothing',
    CASE WHEN public.document_entity_grants('opportunity', v_o1, sus) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== 10. anon =====
  RAISE NOTICE '% 10. a null user reaches nothing',
    CASE WHEN public.document_entity_grants('opportunity', v_o1, NULL) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== 11. viewer and system_admin, on a record they can plainly see =====
  -- projects is readable by every active user, so this is precisely the case
  -- where deriving from the entity's own RLS would have leaked.
  RAISE NOTICE '% 11. viewer reaches no project documents despite projects being world-readable',
    CASE WHEN public.document_entity_grants('project', v_p1, vw) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 12. system_admin alone reaches no project documents either',
    CASE WHEN public.document_entity_grants('project', v_p1, adm) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 13. …but a document role does',
    CASE WHEN public.document_entity_grants('project', v_p1, bd) THEN 'PASS' ELSE 'FAIL' END;

  -- ===== 14. cross-entity isolation =====
  -- s1's stake in v_o1 must not reach a document linked only to v_o2.
  PERFORM set_config('test.uid', s1::text, false);
  SELECT count(*) INTO n FROM public.documents WHERE id=v_theirs;
  RAISE NOTICE '% 14. cross-entity isolation: the other deal''s document is invisible (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.document_links WHERE entity_id=v_o2;
  RAISE NOTICE '% 15. …and so is the fact that it is linked there (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== 16. multi-role is additive, never subtractive =====
  -- The same question from both sides. `vw` holds viewer alone and reaches
  -- nothing (check 11). `vw2` holds viewer AND finance_manager. If roles were
  -- resolved by precedence rather than union, the read-only role would cancel
  -- the other and this would fail.
  RAISE NOTICE '% 16. multi-role is additive: viewer + finance_manager reaches project documents',
    CASE WHEN public.document_entity_grants('project', v_p1, vw2) THEN 'PASS' ELSE 'FAIL' END;

  -- ===== 17-22. contract documents follow contract-record access =====
  -- The mismatch this closes: estimation_manager is in D24's attachment list
  -- but deliberately not in the contract read set, so without the early return
  -- in document_entity_grants they could open a file whose whole content is the
  -- commercial terms they are refused.
  -- The `has_role` half matters: without it this would also pass for a user
  -- who simply holds no roles, which is how it first passed for the wrong
  -- reason when the fixture insert silently missed.
  RAISE NOTICE '% 17. estimation_manager cannot reach a contract''s documents, matching the contract record',
    CASE WHEN public.has_role(est,'estimation_manager'::public.app_role)
          AND public.can_read_attachments(est)
          AND public.document_entity_grants('contract', v_k1, est) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 18. …and can_read_contract agrees, so the two are not merely both false by accident',
    CASE WHEN public.can_read_contract(v_o1, NULL, NULL, est) = FALSE THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 19. finance_manager reaches them, matching its contract read right',
    CASE WHEN public.document_entity_grants('contract', v_k1, fin) THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 20. the deal owner reaches them',
    CASE WHEN public.document_entity_grants('contract', v_k1, s1) THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 21. viewer and system_admin reach neither',
    CASE WHEN public.document_entity_grants('contract', v_k1, vw) = FALSE
          AND public.document_entity_grants('contract', v_k1, adm) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;

  -- End to end: the storage object itself, not just the predicate.
  PERFORM set_config('test.uid', est::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='p6/contract.pdf';
  RAISE NOTICE '% 22. end to end: estimation_manager cannot read the contract file object (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  PERFORM set_config('test.uid', fin::text, false);
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='p6/contract.pdf';
  RAISE NOTICE '% 23. …and finance_manager can (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  RESET ROLE;
  RAISE NOTICE '--- phase 6 document security: done ---';
END $$;
