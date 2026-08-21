-- =============================================================================
-- Phase 6 — upload lifecycle: versions, soft delete, backfill, location.
--
-- The security suite proves who may read. This one proves the record survives
-- what happens to it: superseding keeps the history, deleting keeps the row,
-- and the legacy backfill refuses the same things migration 110 refused.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  bd UUID; s1 UUID; o1 UUID; r1 UUID; i1 UUID;
  d_v1 UUID; d_v2 UUID; d_del UUID; n INT; ok BOOLEAN; t TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (email) VALUES ('p6lbd@phc-sa.com'),('p6ls1@phc-sa.com');
  SELECT id INTO bd FROM auth.users WHERE email='p6lbd@phc-sa.com';
  SELECT id INTO s1 FROM auth.users WHERE email='p6ls1@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id IN (bd,s1);
  INSERT INTO public.user_roles (user_id, role) VALUES (bd,'bd_manager'),(s1,'salesperson');

  INSERT INTO public.opportunities (project_name, owner_id) VALUES ('P6L deal', s1) RETURNING id INTO o1;

  INSERT INTO storage.buckets (id,name,public) VALUES ('attachments','attachments',false)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.objects (bucket_id,name,owner,metadata) VALUES
    ('attachments','p6l/1790000000000-boq-rev1.xlsx', bd, '{"size":"1234","mimetype":"application/vnd.ms-excel"}'::jsonb),
    ('attachments','p6l/1790000000001-boq-rev2.xlsx', bd, '{"size":"2345","mimetype":"application/vnd.ms-excel"}'::jsonb),
    ('attachments','p6l/1790000000002-doomed.pdf',    bd, '{"size":"99","mimetype":"application/pdf"}'::jsonb);

  -- ===== versions =====
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by, doc_type, size_bytes, checksum)
    VALUES ('p6l/1790000000000-boq-rev1.xlsx','boq-rev1.xlsx',bd,'boq',1234,'aaa') RETURNING id INTO d_v1;
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by, doc_type, size_bytes, checksum)
    VALUES ('p6l/1790000000001-boq-rev2.xlsx','boq-rev2.xlsx',bd,'boq',2345,'bbb') RETURNING id INTO d_v2;
  INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by) VALUES
    (d_v1,'opportunity',o1,bd), (d_v2,'opportunity',o1,bd);

  UPDATE public.documents SET superseded_by=d_v2, superseded_at=now() WHERE id=d_v1;

  SELECT count(*) INTO n FROM public.documents WHERE id=d_v1 AND superseded_by=d_v2;
  RAISE NOTICE '%  1. superseding records what replaced it (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The old version is still there. A "version history" that deletes the
  -- previous file is not a version history.
  SELECT count(*) INTO n FROM public.documents WHERE id=d_v1 AND deleted_at IS NULL;
  RAISE NOTICE '%  2. the superseded version is retained, not deleted (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id='attachments' AND name='p6l/1790000000000-boq-rev1.xlsx';
  RAISE NOTICE '%  3. …and so is its object (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  BEGIN
    UPDATE public.documents SET superseded_by=id WHERE id=d_v2;
    RAISE NOTICE 'FAIL  4. a document was allowed to supersede itself';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  4. a document cannot supersede itself';
  END;

  BEGIN
    UPDATE public.documents SET superseded_by=d_v1 WHERE id=d_v2;   -- no superseded_at
    RAISE NOTICE 'FAIL  5. supersede was allowed without a timestamp';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  5. superseded_by and superseded_at must move together';
  END;

  -- ===== soft delete =====
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by)
    VALUES ('p6l/1790000000002-doomed.pdf','doomed.pdf',bd) RETURNING id INTO d_del;
  INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
    VALUES (d_del,'opportunity',o1,bd);

  UPDATE public.documents SET deleted_by=bd, deleted_at=now(), delete_reason='superseded by rev2' WHERE id=d_del;

  SELECT count(*) INTO n FROM public.documents WHERE id=d_del;
  RAISE NOTICE '%  6. a soft-deleted document keeps its row (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='attachments' AND name='p6l/1790000000002-doomed.pdf';
  RAISE NOTICE '%  7. …and its object — no physical delete in Phase 6 (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The bytes stop being served. This is the point of the soft delete.
  RAISE NOTICE '%  8. a soft-deleted document stops being readable through storage',
    CASE WHEN public.storage_object_readable('attachments','p6l/1790000000002-doomed.pdf', bd) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;

  RAISE NOTICE '%  9. a live one is still readable',
    CASE WHEN public.storage_object_readable('attachments','p6l/1790000000001-boq-rev2.xlsx', bd)
         THEN 'PASS' ELSE 'FAIL' END;

  BEGIN
    UPDATE public.documents SET deleted_at=now() WHERE id=d_v2;   -- no deleted_by
    RAISE NOTICE 'FAIL 10. a delete was allowed with no actor';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 10. deleted_by and deleted_at must move together — no anonymous deletions';
  END;

  -- ===== one registry row per object =====
  BEGIN
    INSERT INTO public.documents (storage_path, original_filename, uploaded_by)
      VALUES ('p6l/1790000000001-boq-rev2.xlsx','duplicate.xlsx',bd);
    RAISE NOTICE 'FAIL 11. two registry rows claimed the same object';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS 11. one registry row per stored object';
  END;

  -- ===== one active link per pair, but re-linking allowed =====
  BEGIN
    INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
      VALUES (d_v2,'opportunity',o1,bd);
    RAISE NOTICE 'FAIL 12. the same document linked to the same record twice';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS 12. a document links to a record once while the link is live';
  END;

  UPDATE public.document_links SET unlinked_by=bd, unlinked_at=now()
   WHERE document_id=d_v2 AND entity_id=o1;
  INSERT INTO public.document_links (document_id, entity_type, entity_id, linked_by)
    VALUES (d_v2,'opportunity',o1,bd);
  SELECT count(*) INTO n FROM public.document_links WHERE document_id=d_v2 AND entity_id=o1;
  RAISE NOTICE '% 13. unlinking is soft, so re-linking leaves both rows as history (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== location =====
  BEGIN
    UPDATE public.projects SET site_latitude=24.7136 WHERE name IS NOT NULL;   -- no longitude
    RAISE NOTICE 'FAIL 14. half a coordinate was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 14. latitude without longitude is refused';
  END;

  BEGIN
    UPDATE public.documents SET captured_lat=95.0, captured_lon=10.0 WHERE id=d_v2;
    RAISE NOTICE 'FAIL 15. an out-of-range latitude was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS 15. latitude outside -90..90 is refused';
  END;

  UPDATE public.documents SET captured_lat=24.713600, captured_lon=46.675300 WHERE id=d_v2;
  SELECT count(*) INTO n FROM public.documents WHERE id=d_v2 AND captured_lat=24.7136;
  RAISE NOTICE '% 16. a valid photo coordinate is stored at 6dp (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 6 lifecycle: done ---';
END $$;

-- =============================================================================
-- The legacy backfill, on fixtures shaped like production.
-- =============================================================================
DO $$
DECLARE
  bd UUID; r_ok UUID; r_ext UUID; i_email UUID; n INT; d UUID;
BEGIN
  SELECT id INTO bd FROM auth.users WHERE email='p6lbd@phc-sa.com';

  INSERT INTO storage.objects (bucket_id,name,owner,metadata) VALUES
    ('attachments','p6bf/1790000000010-real-boq.xlsx', bd, '{"size":"555","mimetype":"application/vnd.ms-excel"}'::jsonb),
    ('attachments','p6bf/1790000000011-nobody-points-here.pdf', bd, '{"size":"77","mimetype":"application/pdf"}'::jsonb);

  -- Exactly the shapes production holds.
  INSERT INTO public.rfqs (document_url, document_storage_path, created_by)
    VALUES ('https://x.supabase.co/storage/v1/object/sign/attachments/p6bf/1790000000010-real-boq.xlsx?token=a',
            'p6bf/1790000000010-real-boq.xlsx', bd) RETURNING id INTO r_ok;
  INSERT INTO public.rfqs (document_url, created_by)
    VALUES ('https://drive.google.com/file/d/1Rw/view', bd) RETURNING id INTO r_ext;
  INSERT INTO public.inbox_items (project_name, source_type, evidence_url, created_by)
    VALUES ('P6BF email','manual_rfq','no-reply@raseedinvest.com', bd) RETURNING id INTO i_email;

  PERFORM public.register_legacy_documents();

  SELECT id INTO d FROM public.documents WHERE storage_path='p6bf/1790000000010-real-boq.xlsx';
  RAISE NOTICE '% 17. a confirmed path becomes a registered document (got %)',
    CASE WHEN d IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(d::text,'NULL');

  SELECT count(*) INTO n FROM public.document_links
   WHERE document_id=d AND entity_type='rfq' AND entity_id=r_ok AND unlinked_at IS NULL;
  RAISE NOTICE '% 18. …linked to the row the path came out of, deterministically (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.documents WHERE storage_path='p6bf/1790000000010-real-boq.xlsx' AND is_legacy;
  RAISE NOTICE '% 19. backfilled rows are marked is_legacy (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- The filename is recovered from the stored path, not invented.
  SELECT count(*) INTO n FROM public.documents
   WHERE storage_path='p6bf/1790000000010-real-boq.xlsx' AND original_filename='real-boq.xlsx';
  RAISE NOTICE '% 20. the original filename is recovered from the path (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- Size and mime come from the object, not from a guess.
  SELECT count(*) INTO n FROM public.documents
   WHERE storage_path='p6bf/1790000000010-real-boq.xlsx' AND size_bytes=555;
  RAISE NOTICE '% 21. size is read off the stored object (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the refusals, unchanged from migration 110 =====
  SELECT count(*) INTO n FROM public.documents d2
    JOIN public.document_links l ON l.document_id=d2.id
   WHERE l.entity_id=r_ext;
  RAISE NOTICE '% 22. a Google Drive link produces no document and no link (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.document_links WHERE entity_id=i_email;
  RAISE NOTICE '% 23. an email address produces no link (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== the orphan: registered, unlinked, never deleted =====
  SELECT id INTO d FROM public.documents WHERE storage_path='p6bf/1790000000011-nobody-points-here.pdf';
  RAISE NOTICE '% 24. an orphan object is registered so it stays visible as work',
    CASE WHEN d IS NOT NULL THEN 'PASS' ELSE 'FAIL' END;
  SELECT count(*) INTO n FROM public.document_links WHERE document_id=d AND unlinked_at IS NULL;
  RAISE NOTICE '% 25. …linked to nothing, because there is nothing to link it to (expect 0, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM storage.objects WHERE name='p6bf/1790000000011-nobody-points-here.pdf';
  RAISE NOTICE '% 26. …and never deleted (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== idempotent =====
  DECLARE _b INT; _a INT; _lb INT; _la INT;
  BEGIN
    SELECT count(*) INTO _b  FROM public.documents;
    SELECT count(*) INTO _lb FROM public.document_links;
    PERFORM public.register_legacy_documents();
    PERFORM public.register_legacy_documents();
    SELECT count(*) INTO _a  FROM public.documents;
    SELECT count(*) INTO _la FROM public.document_links;
    RAISE NOTICE '% 27. re-running the backfill adds nothing (documents % -> %, links % -> %)',
      CASE WHEN _a=_b AND _la=_lb THEN 'PASS' ELSE 'FAIL' END, _b, _a, _lb, _la;
  END;

  -- ===== the legacy read rule is bounded =====
  -- An unlinked legacy row stays reachable by a document role, which is what
  -- stops the migration silently stripping managers of files they read today.
  SELECT id INTO d FROM public.documents WHERE storage_path='p6bf/1790000000011-nobody-points-here.pdf';
  RAISE NOTICE '% 28. an unlinked LEGACY row remains readable by a document role',
    CASE WHEN public.can_read_document(d, bd) THEN 'PASS' ELSE 'FAIL' END;

  -- …but a new upload gets no such courtesy.
  INSERT INTO storage.objects (bucket_id,name,owner) VALUES ('attachments','p6bf/fresh.pdf', bd);
  INSERT INTO public.documents (storage_path, original_filename, uploaded_by)
    VALUES ('p6bf/fresh.pdf','fresh.pdf',bd) RETURNING id INTO d;
  RAISE NOTICE '% 29. a NEW unlinked document is uploader-only — the legacy rule does not extend to it',
    CASE WHEN public.can_read_document(d, bd)
          AND public.can_read_document(d, (SELECT id FROM auth.users WHERE email='p6ls1@phc-sa.com')) = FALSE
         THEN 'PASS' ELSE 'FAIL' END;

  -- ===== the status view =====
  SELECT count(*) INTO n FROM public.document_backfill_status WHERE outcome='recovered' AND now_registered;
  RAISE NOTICE '% 30. the status view shows recovered references as registered (expect >=1, got %)',
    CASE WHEN n>=1 THEN 'PASS' ELSE 'FAIL' END, n;

  RAISE NOTICE '--- phase 6 backfill: done ---';
END $$;
