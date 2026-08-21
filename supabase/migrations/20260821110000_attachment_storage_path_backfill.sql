-- =========================================================
-- Recover storage paths from legacy URL columns — deterministically only.
--
-- WHY
-- ---
-- uploadAttachment() returns a 7-day signed URL, and three of its four call
-- sites persisted that URL instead of the path. Those links die a week after
-- upload and the file becomes unreachable through the UI, silently, because the
-- row still holds a plausible-looking URL. One of the two affected rows in
-- production is already dead (verified: HTTP 400).
--
-- WHAT THIS DOES, AND REFUSES TO DO
-- ---------------------------------
-- A path is recovered ONLY when both are true:
--
--   1. it can be extracted from the stored URL with no guessing, and
--   2. an object with exactly that name exists in the attachments bucket.
--
-- Everything else is written to public.document_backfill_report with a reason
-- and left alone. Nothing is inferred, and no path is ever constructed from a
-- filename, a timestamp, or a similarity match.
--
-- Specifically refused:
--   * external URLs (Google Drive and the like) — an external link is not an
--     internal document, and importing it as one would assert custody we do not
--     have
--   * values that are not references at all — production currently holds
--     `no-reply@raseedinvest.com` in inbox_items.evidence_url
--   * anything whose derived path has no matching storage object
--
-- Legacy columns are NOT modified, NOT cleared, and NOT renamed. Readers gain a
-- better source; nothing loses its existing one. That makes this reversible by
-- dropping two columns.
--
-- On this production dataset the split is 2 recovered, 3 reported — so a naive
-- backfill would have written an email address into a storage_path column and
-- adopted two Google Drive links as internal documents.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. The report ============
-- A table rather than migration NOTICEs: an unresolved reference is a piece of
-- work someone has to do, and it needs to still be there tomorrow.
CREATE TABLE IF NOT EXISTS public.document_backfill_report (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  TEXT NOT NULL,
  source_column TEXT NOT NULL,
  record_id     UUID NOT NULL,
  raw_value     TEXT,
  derived_path  TEXT,
  outcome       TEXT NOT NULL,
  reason        TEXT NOT NULL,
  reported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_backfill_outcome_check
    CHECK (outcome IN ('recovered', 'external_url', 'not_a_reference', 'object_missing'))
);

COMMENT ON TABLE public.document_backfill_report IS
  'One row per legacy file reference examined. outcome=recovered means a storage path was written; every other outcome means the reference was left untouched and needs a human. Never delete rows here to make the report look clean — resolve the reference instead.';

CREATE UNIQUE INDEX IF NOT EXISTS document_backfill_report_unique
    ON public.document_backfill_report (source_table, source_column, record_id);

ALTER TABLE public.document_backfill_report ENABLE ROW LEVEL SECURITY;

-- Readable by the people who would act on it. Not system_admin by role alone,
-- consistent with the attachment policy this accompanies.
DROP POLICY IF EXISTS "Backfill report readable by document handlers" ON public.document_backfill_report;
CREATE POLICY "Backfill report readable by document handlers"
  ON public.document_backfill_report FOR SELECT
  USING (public.can_read_attachments((SELECT auth.uid())));

-- ============ 2. Deterministic extraction ============
-- Returns a path only for a URL that points into our own attachments bucket.
-- Anything else — an external host, an email address, free text — returns NULL.
CREATE OR REPLACE FUNCTION public.derive_attachment_path(_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _value IS NULL OR btrim(_value) = '' THEN NULL
    -- Our own storage URL: everything after /attachments/, minus the query
    -- string that carries the signature.
    WHEN position('/attachments/' in _value) > 0
      THEN nullif(split_part(split_part(_value, '/attachments/', 2), '?', 1), '')
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.derive_attachment_path IS
  'Extracts a storage path from a URL that points into our own attachments bucket. Returns NULL for external URLs and for values that are not references — it never constructs a path.';

-- ============ 3. The new columns ============
-- Added only to the two tables that actually hold references today. Speculative
-- columns on tables with nothing in them would be noise; Phase 6's registry is
-- the general answer.
ALTER TABLE public.rfqs        ADD COLUMN IF NOT EXISTS document_storage_path TEXT;
ALTER TABLE public.inbox_items ADD COLUMN IF NOT EXISTS evidence_storage_path TEXT;

COMMENT ON COLUMN public.rfqs.document_storage_path IS
  'Storage path in the attachments bucket. Prefer this over document_url and sign on read — document_url may hold an expired signed URL. NULL means no recoverable internal object; see document_backfill_report.';
COMMENT ON COLUMN public.inbox_items.evidence_storage_path IS
  'Storage path in the attachments bucket. Prefer this over evidence_url and sign on read. NULL means no recoverable internal object; see document_backfill_report.';

-- ============ 4. Classify, then recover only the certain ones ============
-- A function rather than an inline block: the classification has to be
-- re-runnable (new references arrive, missing objects get uploaded later) and
-- it has to be testable. Idempotent — re-running updates the report in place
-- and never writes a second row for the same reference.
CREATE OR REPLACE FUNCTION public.rerun_attachment_backfill()
RETURNS TABLE (recovered INT, reported INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _r RECORD;
  _path TEXT;
  _outcome TEXT;
  _reason TEXT;
  _rec INT := 0;
  _rep INT := 0;
BEGIN
  FOR _r IN
    SELECT 'rfqs' AS tbl, 'document_url' AS col, id, document_url AS val FROM public.rfqs        WHERE document_url IS NOT NULL
    UNION ALL
    SELECT 'inbox_items',  'evidence_url',        id, evidence_url       FROM public.inbox_items WHERE evidence_url IS NOT NULL
  LOOP
    _path := public.derive_attachment_path(_r.val);

    IF _path IS NULL THEN
      IF _r.val ~ '^https?://' THEN
        _outcome := 'external_url';
        _reason  := 'Points at a host outside our storage. An external link is not an internal document and is not adopted as one.';
      ELSE
        _outcome := 'not_a_reference';
        _reason  := 'Not a URL or a storage path. The column holds something else and needs a human to interpret it.';
      END IF;

    ELSIF NOT EXISTS (
      SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'attachments' AND o.name = _path
    ) THEN
      _outcome := 'object_missing';
      _reason  := 'A path was extracted but no such object exists in the bucket. Recording it would assert a file that is not there.';

    ELSE
      _outcome := 'recovered';
      _reason  := 'Path extracted from our own storage URL and confirmed against an existing object.';

      IF _r.tbl = 'rfqs' THEN
        UPDATE public.rfqs SET document_storage_path = _path
         WHERE id = _r.id AND document_storage_path IS DISTINCT FROM _path;
      ELSE
        UPDATE public.inbox_items SET evidence_storage_path = _path
         WHERE id = _r.id AND evidence_storage_path IS DISTINCT FROM _path;
      END IF;
    END IF;

    IF _outcome = 'recovered' THEN _rec := _rec + 1; ELSE _rep := _rep + 1; END IF;

    INSERT INTO public.document_backfill_report
      (source_table, source_column, record_id, raw_value, derived_path, outcome, reason)
    VALUES (_r.tbl, _r.col, _r.id, left(_r.val, 500), _path, _outcome, _reason)
    ON CONFLICT (source_table, source_column, record_id) DO UPDATE
      SET raw_value = EXCLUDED.raw_value, derived_path = EXCLUDED.derived_path,
          outcome = EXCLUDED.outcome, reason = EXCLUDED.reason, reported_at = now();
  END LOOP;

  -- Orphans: objects nothing points at. Reported, never deleted — an
  -- unreferenced file is far more likely to be a lost link than rubbish, and
  -- deleting it destroys the evidence needed to reconnect it.
  INSERT INTO public.document_backfill_report
    (source_table, source_column, record_id, raw_value, derived_path, outcome, reason)
  SELECT 'storage.objects', 'name', o.id, o.name, o.name, 'object_missing',
         'Object exists in the bucket but no business record references it. Left in place.'
    FROM storage.objects o
   WHERE o.bucket_id = 'attachments'
     AND NOT EXISTS (
       SELECT 1 FROM public.rfqs r        WHERE public.derive_attachment_path(r.document_url) = o.name
       UNION ALL
       SELECT 1 FROM public.inbox_items i WHERE public.derive_attachment_path(i.evidence_url) = o.name
     )
  ON CONFLICT (source_table, source_column, record_id) DO NOTHING;

  RETURN QUERY SELECT _rec, _rep;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rerun_attachment_backfill() FROM PUBLIC;

COMMENT ON FUNCTION public.rerun_attachment_backfill IS
  'Re-classifies every legacy file reference and recovers a storage path only where it is deterministic and the object exists. Idempotent. Never fabricates a path, never adopts an external URL, never modifies or clears a legacy column, never deletes an object.';

-- Run it once as part of this migration.
SELECT public.rerun_attachment_backfill();

-- Read the outcome:
--   SELECT outcome, count(*) FROM public.document_backfill_report GROUP BY 1;
--   SELECT * FROM public.document_backfill_report WHERE outcome <> 'recovered';
