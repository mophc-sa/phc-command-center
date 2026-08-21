-- =========================================================
-- PHASE 6 — the storage policy the registry was built to enable, and the
-- legacy files brought into it.
--
-- Migration 109 said this in its own header: "Phase 6 replaces the role
-- fallback with a registry lookup; the policy shape does not change." This is
-- that replacement.
--
-- WHAT CHANGES
-- ------------
--   before   uploader OR document-role OR (path happens to embed an entity id)
--   after    uploader OR (the object is a registered document you may read)
--
-- The role clause does not disappear so much as move: it now lives inside
-- can_read_document(), where it applies to a linked file only if the linker
-- could reach the record, and to an unlinked file only if that file predates
-- the registry. A bd_manager no longer reads every object in the bucket by
-- virtue of the bucket; they read the documents attached to records they can
-- reach, which for their role is most of them — but it is now derived rather
-- than assumed, and it narrows automatically as roles narrow.
--
-- WHAT THIS TIGHTENS
-- ------------------
-- An object with no registry row is readable only by whoever uploaded it. That
-- is a deliberate fail-closed: an unregistered object is a file the system
-- cannot say anything about, and "we don't know what this is" should not
-- resolve to "so everyone senior may read it". The backfill below registers
-- every object that can be mapped deterministically, so the only objects left
-- in that state on production are ones nothing points at.
--
-- A soft-deleted document stops serving its bytes. The row survives, the
-- history survives, the object survives — the read does not.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- INSERT, UPDATE and DELETE on storage.objects are untouched for the third
-- migration running. Who may upload and who may remove an object are separate
-- decisions with their own blast radius.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Is this object a document the caller may read? ============
CREATE OR REPLACE FUNCTION public.storage_object_readable(_bucket TEXT, _path TEXT, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
     WHERE d.storage_bucket = _bucket
       AND d.storage_path   = _path
       -- Soft-deleted means the bytes stop being served. The registry row and
       -- its history stay, which is the whole point of a soft delete.
       AND d.deleted_at IS NULL
       AND public.can_read_document(d.id, _user_id)
  );
$$;

COMMENT ON FUNCTION public.storage_object_readable IS
  'Whether a stored object is a live registered document the caller may read. An unregistered object returns FALSE — the storage policy then falls back to uploader-only, which is intentional: a file the registry knows nothing about grants nothing by role.';

-- ============ 2. Replace the staging read policy ============
DROP POLICY IF EXISTS "Attachments readable by owner, role, or linked entity" ON storage.objects;
DROP POLICY IF EXISTS "Attachments readable by authenticated" ON storage.objects;

CREATE POLICY "Attachments readable via document registry"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments'
    AND (
      owner = (SELECT auth.uid())
      OR public.storage_object_readable('attachments', name, (SELECT auth.uid()))
    )
  );

-- The staging helper is no longer referenced by any policy. It is dropped
-- rather than left behind, so nobody wires it back in believing it is current.
DROP FUNCTION IF EXISTS public.attachment_entity_visible(TEXT, UUID);

-- ============ 3. Bring the legacy objects into the registry ============
-- Reuses migration 110's work rather than re-deriving it: that migration
-- already decided, per reference, whether a storage path could be extracted
-- without guessing and whether the object actually exists. Its conclusions are
-- in rfqs.document_storage_path and inbox_items.evidence_storage_path, and
-- everything it refused is in document_backfill_report with a reason.
--
-- The same refusals apply here and are not revisited:
--   * a Google Drive link is not an internal document
--   * `no-reply@raseedinvest.com` is not a file reference
--   * a path with no matching object is not registered
--   * an orphan object is registered but linked to nothing, never deleted
--
-- Entity mapping is deterministic in both directions: the path came OUT of that
-- row, so the row is what it belongs to. No similarity matching, no inference
-- from filenames.
CREATE OR REPLACE FUNCTION public.register_legacy_documents()
RETURNS TABLE (registered INT, linked INT, unlinked_orphans INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _r RECORD;
  _doc_id UUID;
  _reg INT := 0;
  _lnk INT := 0;
  _orph INT := 0;
BEGIN
  -- ---- 3a. references whose path migration 110 confirmed ----
  FOR _r IN
    SELECT 'rfq'::public.document_entity_type AS etype, r.id AS eid,
           r.document_storage_path AS path, r.created_by AS linker
      FROM public.rfqs r
     WHERE r.document_storage_path IS NOT NULL
    UNION ALL
    SELECT 'inbox_item'::public.document_entity_type, i.id,
           i.evidence_storage_path, i.created_by
      FROM public.inbox_items i
     WHERE i.evidence_storage_path IS NOT NULL
  LOOP
    -- The object has to still be there. Migration 110 checked, but that was a
    -- different moment and this must not assert a file that has since gone.
    IF NOT EXISTS (SELECT 1 FROM storage.objects o
                    WHERE o.bucket_id = 'attachments' AND o.name = _r.path) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.documents
      (storage_bucket, storage_path, original_filename, mime_type, size_bytes,
       doc_type, uploaded_by, uploaded_at, is_legacy)
    SELECT 'attachments', o.name,
           -- The stored name is `{folder}/{timestamp}-{original}`; the original
           -- filename is what follows the first hyphen after the timestamp.
           regexp_replace(split_part(o.name, '/', 2), '^[0-9]+-', ''),
           o.metadata->>'mimetype',
           NULLIF(o.metadata->>'size', '')::BIGINT,
           'other', o.owner, o.created_at, TRUE
      FROM storage.objects o
     WHERE o.bucket_id = 'attachments' AND o.name = _r.path
    ON CONFLICT (storage_bucket, storage_path) DO NOTHING;

    SELECT id INTO _doc_id FROM public.documents
     WHERE storage_bucket = 'attachments' AND storage_path = _r.path;
    IF _doc_id IS NULL THEN CONTINUE; END IF;
    _reg := _reg + 1;

    INSERT INTO public.document_links (document_id, entity_type, entity_id, link_role, linked_by)
    VALUES (_doc_id, _r.etype, _r.eid, 'primary', _r.linker)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN _lnk := _lnk + 1; END IF;
  END LOOP;

  -- ---- 3b. objects nothing points at ----
  -- Registered so they remain reachable by the people who can reach them today,
  -- and so they are visible as work to be done rather than invisible. Linked to
  -- nothing, because there is nothing to link them to, and deleted never.
  FOR _r IN
    SELECT o.name AS path FROM storage.objects o
     WHERE o.bucket_id = 'attachments'
       AND NOT EXISTS (SELECT 1 FROM public.documents d
                        WHERE d.storage_bucket = 'attachments' AND d.storage_path = o.name)
  LOOP
    INSERT INTO public.documents
      (storage_bucket, storage_path, original_filename, mime_type, size_bytes,
       doc_type, uploaded_by, uploaded_at, is_legacy, notes)
    SELECT 'attachments', o.name,
           regexp_replace(split_part(o.name, '/', 2), '^[0-9]+-', ''),
           o.metadata->>'mimetype',
           NULLIF(o.metadata->>'size', '')::BIGINT,
           'other', o.owner, o.created_at, TRUE,
           'Registered by the Phase 6 backfill. No business record referenced this file, so it is linked to nothing — see document_backfill_report.'
      FROM storage.objects o
     WHERE o.bucket_id = 'attachments' AND o.name = _r.path
    ON CONFLICT (storage_bucket, storage_path) DO NOTHING;
    _orph := _orph + 1;
  END LOOP;

  RETURN QUERY SELECT _reg, _lnk, _orph;
END;
$fn$;

REVOKE ALL ON FUNCTION public.register_legacy_documents() FROM PUBLIC;

COMMENT ON FUNCTION public.register_legacy_documents IS
  'Brings pre-registry objects into the registry using migration 110''s confirmed paths only. Idempotent. Never guesses an entity mapping, never adopts an external URL, never deletes an orphan — it registers the orphan unlinked and leaves it visible as work.';

SELECT public.register_legacy_documents();

-- ============ 4. Report what is still unresolved ============
-- The Phase 6 view of migration 110's report: what the registry could not be
-- given, and why. Same rows, read through the lens of "is this a document yet?"
CREATE OR REPLACE VIEW public.document_backfill_status AS
  SELECT r.source_table, r.source_column, r.record_id, r.raw_value,
         r.derived_path, r.outcome, r.reason, r.reported_at,
         (d.id IS NOT NULL)                                   AS now_registered,
         (SELECT count(*) FROM public.document_links l
           WHERE l.document_id = d.id AND l.unlinked_at IS NULL) AS active_links
    FROM public.document_backfill_report r
    LEFT JOIN public.documents d
      ON d.storage_bucket = 'attachments' AND d.storage_path = r.derived_path;

COMMENT ON VIEW public.document_backfill_status IS
  'Migration 110''s unresolved references, plus whether Phase 6 managed to register each one. A row with outcome <> recovered and now_registered = false is a reference a human still has to interpret.';
