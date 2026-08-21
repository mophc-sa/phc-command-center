-- =========================================================
-- SECURITY HOTFIX — attachment reads are no longer open to everyone.
--
-- THE EXPOSURE
-- ------------
-- The read policy on the attachments bucket is, in full:
--
--     "Attachments readable by authenticated"  USING (bucket_id = 'attachments')
--
-- That is the entire predicate. Any authenticated user — a `viewer`, or a
-- salesperson who owns none of the underlying deals — can read every contract,
-- BOQ, quotation and award letter in the bucket. Phase 1 deliberately hides
-- another rep's opportunity ROW from a salesperson; the PDF attached to it was
-- never hidden.
--
-- WHY THIS IS NOT THE FULL FIX
-- ----------------------------
-- The honest constraint: five of the six upload call sites write to a STATIC
-- folder that carries no entity id —
--
--     inbox/…      contracts/…      boq/…      rfq/…
--
-- and all three objects in production today are `inbox/…` or `rfq/…`. Only
-- `evidence/{opportunity_id}/…` and `projects/{project_id}/cover/…` embed an id,
-- and neither has produced an object yet.
--
-- So for most files the path proves nothing about which entity they belong to,
-- and a fully entity-derived policy is not implementable until the Phase 6
-- document registry exists to record the link. Waiting for that would leave the
-- bucket open for the whole of Phase 6.
--
-- This is therefore a STAGING policy: it closes the exposure now using only
-- signals that exist today, and derives access from the entity wherever the
-- path actually permits it. Phase 6 replaces the role fallback with a registry
-- lookup; the policy shape does not change.
--
-- WHAT CHANGES FOR WHOM
-- ---------------------
--   uploader                      reads their own files          (unchanged)
--   pipeline operators, finance,
--   estimation                    read attachments               (unchanged)
--   salesperson                   own uploads + files on their
--                                 own opportunities              (TIGHTENED)
--   viewer                        no attachment reads            (TIGHTENED)
--   system_admin alone            no attachment reads            (TIGHTENED)
--   anon                          no reads                       (unchanged)
--
-- `system_admin` is excluded deliberately, which is why
-- can_view_all_sales_data() is NOT reused here — that helper includes both
-- system_admin and viewer. Platform administration is not a reason to read a
-- client's contract, the same rule Phases 1–5 apply to commercial decisions.
--
-- NOTE ON EXISTING LINKS: the two rows that store a pre-signed URL are
-- unaffected either way. A signed URL is pre-authorised and bypasses RLS
-- entirely — and both have already expired regardless (verified: HTTP 400).
-- Recovering those is a separate, data-level fix.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Who may read attachments by role ============
-- Deliberately NOT can_view_all_sales_data(): that includes system_admin and
-- viewer. This is the narrower set of people whose work actually involves the
-- documents — the commercial pipeline, plus finance and estimation, who receive
-- contracts and BOQs respectively.
CREATE OR REPLACE FUNCTION public.can_read_attachments(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY[
      'managing_director', 'general_manager', 'ceo',
      'sales_manager', 'bd_manager', 'sales_ops',
      'finance_manager', 'estimation_manager'
    ]::public.app_role[]
  );
$$;

COMMENT ON FUNCTION public.can_read_attachments IS
  'Roles whose work involves the documents themselves. Excludes system_admin and viewer by design — can_view_all_sales_data() includes both and must not be reused for attachment reads.';

-- ============ 2. Entity-derived access, where the path allows it ============
-- Only two path shapes carry an entity id today. Everything else returns FALSE,
-- so an unrecognised path grants nothing — the policy fails closed and access
-- falls back to uploader-or-role rather than to "allow".
CREATE OR REPLACE FUNCTION public.attachment_entity_visible(_path TEXT, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _seg  TEXT;
  _id   UUID;
BEGIN
  IF _path IS NULL OR _user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- evidence/{opportunity_id}/…
  IF _path LIKE 'evidence/%' THEN
    _seg := split_part(_path, '/', 2);
    BEGIN _id := _seg::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN FALSE; END;
    RETURN EXISTS (
      SELECT 1 FROM public.opportunities o
       WHERE o.id = _id
         -- A salesperson reaches their own deal's documents; everyone with
         -- broader pipeline sight reaches them through can_read_attachments.
         AND o.owner_id = _user_id
    );
  END IF;

  -- projects/{project_id}/cover/…
  IF _path LIKE 'projects/%' THEN
    _seg := split_part(_path, '/', 2);
    BEGIN _id := _seg::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN FALSE; END;
    RETURN EXISTS (
      SELECT 1 FROM public.projects p
        JOIN public.opportunities o ON o.project_id = p.id
       WHERE p.id = _id AND o.owner_id = _user_id
    );
  END IF;

  -- inbox/ contracts/ boq/ rfq/ — no entity id in the path, nothing to derive.
  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.attachment_entity_visible IS
  'Derives attachment access from the object path where the path embeds an entity id (evidence/{opportunity_id}, projects/{project_id}). Returns FALSE for the static folders (inbox, contracts, boq, rfq), which carry no id — so it fails closed. Phase 6 replaces this with a document_links lookup.';

-- ============ 3. Replace the blanket read policy ============
DROP POLICY IF EXISTS "Attachments readable by authenticated" ON storage.objects;

CREATE POLICY "Attachments readable by owner, role, or linked entity"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments'
    AND (
      -- You can always read what you uploaded.
      owner = (SELECT auth.uid())
      -- Or your role's work involves these documents.
      OR public.can_read_attachments((SELECT auth.uid()))
      -- Or the path proves the file belongs to something you already see.
      OR public.attachment_entity_visible(name, (SELECT auth.uid()))
    )
  );

-- The INSERT / UPDATE / DELETE policies are deliberately untouched. This hotfix
-- closes a read exposure; changing who may upload or delete is a separate
-- decision with its own blast radius.
