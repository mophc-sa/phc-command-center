-- =============================================================================
-- Backfill policy enforcement (behavioural).
--
-- The policy is deliberately restrictive, and the value is in what it REFUSES.
-- These fixtures reproduce every shape found in production plus the edge cases
-- a naive implementation would get wrong.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  u UUID;
  r_ok UUID; r_ext UUID; r_missing UUID;
  i_ok UUID; i_email UUID; i_ext UUID;
  n INT; p TEXT;
BEGIN
  INSERT INTO auth.users (email) VALUES ('bf@phc-sa.com');
  SELECT id INTO u FROM auth.users WHERE email='bf@phc-sa.com';
  UPDATE public.profiles SET status='active' WHERE id=u;
  INSERT INTO public.user_roles (user_id, role) VALUES (u,'bd_manager');

  INSERT INTO storage.buckets (id,name,public) VALUES ('attachments','attachments',false)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('attachments','rfq/real-boq.xlsx', u),
    ('attachments','inbox/real-quote.pdf', u),
    ('attachments','inbox/orphan-nobody-points-here.pdf', u);

  -- Every shape production actually contains.
  INSERT INTO public.rfqs (document_url) VALUES
    ('https://x.supabase.co/storage/v1/object/sign/attachments/rfq/real-boq.xlsx?token=abc.def')
    RETURNING id INTO r_ok;
  INSERT INTO public.rfqs (document_url) VALUES
    ('https://drive.google.com/file/d/1RwiKx4BPC8pOHW1A4CTo5nFypNU/view')
    RETURNING id INTO r_ext;
  INSERT INTO public.rfqs (document_url) VALUES
    ('https://x.supabase.co/storage/v1/object/sign/attachments/rfq/deleted-since.xlsx?token=z')
    RETURNING id INTO r_missing;

  INSERT INTO public.inbox_items (project_name, source_type, evidence_url) VALUES
    ('BF ok','manual_rfq','https://x.supabase.co/storage/v1/object/sign/attachments/inbox/real-quote.pdf?token=q')
    RETURNING id INTO i_ok;
  INSERT INTO public.inbox_items (project_name, source_type, evidence_url) VALUES
    ('BF email','manual_rfq','no-reply@raseedinvest.com') RETURNING id INTO i_email;
  INSERT INTO public.inbox_items (project_name, source_type, evidence_url) VALUES
    ('BF external','manual_rfq','https://drive.google.com/file/d/abc/view') RETURNING id INTO i_ext;

  -- Re-run the classification the migration performs (idempotent by design).
  PERFORM public.rerun_attachment_backfill();

  -- ===== recovered =====
  SELECT document_storage_path INTO p FROM public.rfqs WHERE id=r_ok;
  RAISE NOTICE '%  1. a signed URL into our own bucket recovers its path (got %)',
    CASE WHEN p='rfq/real-boq.xlsx' THEN 'PASS' ELSE 'FAIL' END, coalesce(p,'NULL');

  SELECT evidence_storage_path INTO p FROM public.inbox_items WHERE id=i_ok;
  RAISE NOTICE '%  2. same for inbox evidence (got %)',
    CASE WHEN p='inbox/real-quote.pdf' THEN 'PASS' ELSE 'FAIL' END, coalesce(p,'NULL');

  -- ===== never fabricate =====
  SELECT document_storage_path INTO p FROM public.rfqs WHERE id=r_missing;
  RAISE NOTICE '%  3. a path with no matching object is NOT written (got %)',
    CASE WHEN p IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(p,'NULL');

  SELECT evidence_storage_path INTO p FROM public.inbox_items WHERE id=i_email;
  RAISE NOTICE '%  4. an email address is never turned into a path (got %)',
    CASE WHEN p IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(p,'NULL');

  -- ===== never import external =====
  SELECT document_storage_path INTO p FROM public.rfqs WHERE id=r_ext;
  RAISE NOTICE '%  5. a Google Drive link is not adopted as an internal document (got %)',
    CASE WHEN p IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(p,'NULL');

  SELECT evidence_storage_path INTO p FROM public.inbox_items WHERE id=i_ext;
  RAISE NOTICE '%  6. same on the inbox side (got %)',
    CASE WHEN p IS NULL THEN 'PASS' ELSE 'FAIL' END, coalesce(p,'NULL');

  -- ===== legacy columns preserved =====
  SELECT count(*) INTO n FROM public.rfqs WHERE id IN (r_ok,r_ext,r_missing) AND document_url IS NOT NULL;
  RAISE NOTICE '%  7. every legacy rfqs.document_url is preserved (expect 3, got %)',
    CASE WHEN n=3 THEN 'PASS' ELSE 'FAIL' END, n;
  SELECT count(*) INTO n FROM public.inbox_items WHERE id IN (i_ok,i_email,i_ext) AND evidence_url IS NOT NULL;
  RAISE NOTICE '%  8. every legacy inbox evidence_url is preserved (expect 3, got %)',
    CASE WHEN n=3 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== unresolved go to the report, with a reason =====
  SELECT count(*) INTO n FROM public.document_backfill_report WHERE outcome='external_url';
  RAISE NOTICE '%  9. external links are reported, not guessed (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.document_backfill_report WHERE outcome='not_a_reference';
  RAISE NOTICE '% 10. the non-reference value is reported (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.document_backfill_report WHERE outcome='object_missing' AND source_table='rfqs';
  RAISE NOTICE '% 11. the missing object is reported (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.document_backfill_report WHERE outcome='recovered';
  RAISE NOTICE '% 12. exactly the two certain ones are recovered (expect 2, got %)',
    CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM public.document_backfill_report WHERE btrim(reason)='';
  RAISE NOTICE '% 13. every report row carries a reason (expect 0 blank, got %)',
    CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== orphans surfaced, never deleted =====
  SELECT count(*) INTO n FROM public.document_backfill_report
   WHERE source_table='storage.objects' AND raw_value='inbox/orphan-nobody-points-here.pdf';
  RAISE NOTICE '% 14. the orphaned object is reported (expect 1, got %)',
    CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END, n;

  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id='attachments'
     AND name IN ('rfq/real-boq.xlsx','inbox/real-quote.pdf','inbox/orphan-nobody-points-here.pdf');
  RAISE NOTICE '% 15. no object was deleted — this suite''s own three survive (expect 3, got %)',
    CASE WHEN n=3 THEN 'PASS' ELSE 'FAIL' END, n;

  -- ===== idempotent =====
  -- Measured as a delta: other suites share this database, so an absolute
  -- count would assert something about them rather than about re-running.
  DECLARE _before INT; _after INT;
  BEGIN
    SELECT count(*) INTO _before FROM public.document_backfill_report;
    PERFORM public.rerun_attachment_backfill();
    SELECT count(*) INTO _after  FROM public.document_backfill_report;
    RAISE NOTICE '% 16. a second run adds no duplicate report rows (% -> %)',
      CASE WHEN _after = _before THEN 'PASS' ELSE 'FAIL' END, _before, _after;
  END;

  -- ===== extraction is honest about what it cannot do =====
  RAISE NOTICE '% 17. derive_attachment_path refuses an external host',
    CASE WHEN public.derive_attachment_path('https://drive.google.com/file/d/x/view') IS NULL THEN 'PASS' ELSE 'FAIL' END;
  RAISE NOTICE '% 18. …refuses free text, and strips the signature from ours',
    CASE WHEN public.derive_attachment_path('no-reply@x.com') IS NULL
          AND public.derive_attachment_path('https://x/storage/v1/object/sign/attachments/a/b.pdf?token=zz') = 'a/b.pdf'
         THEN 'PASS' ELSE 'FAIL' END;

  RAISE NOTICE '--- backfill policy: done ---';
END $$;
