-- =============================================================================
-- File upload has never worked. This is why.
--
-- Reported on 2026-09-02 by a BD Manager who could not attach a file to
-- BELLEVIEW PROJECT and got:
--
--     new row violates row-level security policy for table "documents"
--
-- The INSERT policy was not the problem. Measured against production, the
-- uploader passes every one of its conjuncts, and the insert on its own
-- succeeds. What fails is `INSERT ... RETURNING`, which the client uses because
-- it needs the new id to write the document_links row:
--
--     .from("documents").insert({...}).select().single()
--
-- PostgreSQL applies the SELECT policy to the row an INSERT returns. That
-- policy was `can_read_document(id, auth.uid())`, and can_read_document is
-- written as `SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = ...)`
-- -- it goes back to the table to find the row. Inside the INSERT that row is
-- not in the statement's snapshot yet, so the lookup finds nothing, the
-- function returns FALSE, and the row is refused.
--
-- The `d.uploaded_by = _user_id` branch inside the function cannot help: it
-- never gets that far, because the enclosing EXISTS already matched no rows.
--
-- So the fix is not a new permission. It is stating the uploader's read right
-- where the policy can evaluate it -- against the row's own columns, with no
-- table read at all. `uploaded_by` is available directly in a policy
-- expression, and it needs no snapshot.
--
-- WHAT THIS DOES NOT WIDEN
-- can_read_document already granted the uploader read access. Anyone this
-- disjunct admits was already admitted by the function one moment later, once
-- the row was committed and visible. Nobody gains a document they could not
-- already open; what changes is that the check now also works during the
-- statement that creates the row.
--
-- VERIFIED, ON PRODUCTION, BEFORE WRITING THIS
-- Both branches were run inside a transaction that was then rolled back:
--     before: INSERT ... RETURNING  ->  42501
--     after:  INSERT ... RETURNING + the document_links row  ->  both succeed
-- And the damage was measured, not assumed: `documents` held 3 legacy rows from
-- the backfill and **zero** real uploads, on a feature shipped 2026-08-23.
-- =============================================================================

DROP POLICY IF EXISTS "Documents readable via entity link" ON public.documents;
CREATE POLICY "Documents readable via entity link"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    -- Evaluated against the row itself, so it holds during INSERT ... RETURNING
    -- when the row is not yet visible to a query against the table.
    uploaded_by = (SELECT auth.uid())
    -- Everyone else still goes through the full predicate: a live link to a
    -- record they can reach, or an unlinked legacy row plus the role for it.
    OR public.can_read_document(id, (SELECT auth.uid()))
  );

COMMENT ON POLICY "Documents readable via entity link" ON public.documents IS
  'Uploader, or the full can_read_document predicate. The uploader clause is stated inline rather than left to the function because the function reads public.documents to find the row, which returns nothing during INSERT ... RETURNING -- the defect that made every upload fail from 2026-08-23 until 2026-09-02.';
