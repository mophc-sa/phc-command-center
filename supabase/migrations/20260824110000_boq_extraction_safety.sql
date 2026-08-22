-- =========================================================
-- SECURITY HOTFIX B — the AI BOQ extractor can no longer destroy BOQ history.
--
-- WHAT run_boq_extraction DOES TODAY
-- ----------------------------------
-- In sales-os-api (v44, ACTIVE in production), the commit path is:
--
--   1. find the ONE boqs row for the opportunity (maybeSingle), create if absent
--   2. DELETE FROM boq_items WHERE boq_id = <that boq>      <-- destroys history
--   3. INSERT the freshly parsed rows
--   4. UPDATE boqs.estimated_value with the new total
--
-- Two things are wrong, and they compound.
--
-- The insert at step 3 names a column `unit` that `boq_items` does not have.
-- Verified against production: `column "unit" of relation "boq_items" does not
-- exist`. So step 3 always fails.
--
-- Step 2 does not. On an opportunity that already has priced BOQ lines, the
-- delete succeeds, the insert then fails, and the transaction is not one
-- transaction — these are four separate PostgREST calls. The result is a BOQ
-- stripped of every line with nothing put back. Today that is invisible because
-- boq_items holds zero rows; the first time someone prices a BOQ and re-runs
-- extraction, it is data loss.
--
-- WHY A DATABASE GUARD AND NOT A CODE FIX
-- ---------------------------------------
-- The Edge Function change in this hotfix cannot protect anything until it is
-- deployed, and v44 stays live until then. A trigger protects production the
-- moment this migration is applied, regardless of what any client sends —
-- including the service role, which bypasses RLS but not triggers.
--
-- It is also the right rule on its own terms. Phase 7 introduces immutable BOQ
-- revisions; deleting priced lines in place was never going to survive that.
-- Blocking it now costs nothing (zero rows today) and means Phase 7 inherits a
-- table that has never lost a line.
--
-- FAIL CLOSED, NOT FAIL QUIET
-- ---------------------------
-- The delete raises rather than silently doing nothing. A no-op delete followed
-- by a failed insert looks like success to a caller that does not check, which
-- is exactly how the current path would have lost data. The error names the
-- staging tables so whoever hits it knows where the work should go instead.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- No business data is touched. Nothing is dropped. Inserting and updating BOQ
-- lines still works — only deletion is refused. `boq_extractions` and
-- `extracted_boq_items`, which have existed unused since the AI pipeline was
-- built, become the sanctioned destination.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. BOQ lines are not deletable ============
CREATE OR REPLACE FUNCTION public.boq_history_is_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'BOQ lines cannot be deleted. Priced lines are commercial history, and the AI extractor must stage into boq_extractions / extracted_boq_items for human review rather than overwrite a BOQ in place. | لا يمكن حذف بنود الـBOQ — تُسجَّل الاستخلاصات في boq_extractions للمراجعة البشرية بدل الكتابة فوق الـBOQ.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS boq_items_no_delete ON public.boq_items;
CREATE TRIGGER boq_items_no_delete
  BEFORE DELETE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.boq_history_is_immutable();

-- A BOQ with lines is history too. Deleting the header would cascade the lines
-- and slip past the row trigger above.
DROP TRIGGER IF EXISTS boqs_no_delete ON public.boqs;
CREATE TRIGGER boqs_no_delete
  BEFORE DELETE ON public.boqs
  FOR EACH ROW EXECUTE FUNCTION public.boq_history_is_immutable();

-- Belt and braces for the ordinary API path: the grant goes too, so a delete is
-- refused by privilege before it ever reaches the trigger. The trigger is what
-- stops the service role.
REVOKE DELETE ON public.boq_items FROM authenticated, anon;
REVOKE DELETE ON public.boqs      FROM authenticated, anon;

DROP POLICY IF EXISTS "BOQ items editable by sales team or pipeline operator — delete" ON public.boq_items;
DROP POLICY IF EXISTS "BOQs deletable by commercial manager" ON public.boqs;

COMMENT ON FUNCTION public.boq_history_is_immutable IS
  'Refuses deletion of BOQ headers and lines. Added because the deployed AI extractor deletes every line before re-inserting, and its insert fails on a column that does not exist — so on a priced BOQ it would delete and put nothing back. Phase 7 replaces this with proper revisions.';

-- ============ 2. Staging is the only sanctioned AI destination ============
-- The two tables have existed since the AI pipeline was built and have never
-- held a row, because the extractor wrote straight to the canonical tables
-- instead. Give them write policies so the corrected extractor has somewhere
-- legitimate to land, and keep reads on the same footing as the BOQ itself.
DROP POLICY IF EXISTS "Extractions readable" ON public.boq_extractions;
CREATE POLICY "Extractions readable by the deal's people"
  ON public.boq_extractions FOR SELECT
  TO authenticated
  USING (
    related_opportunity_id IS NULL
      AND uploaded_by = (SELECT auth.uid())
    OR public.can_read_boq(related_opportunity_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Extractions insertable by sales contributors" ON public.boq_extractions;
CREATE POLICY "Extractions insertable by sales contributors"
  ON public.boq_extractions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_sales_contributor((SELECT auth.uid())));

DROP POLICY IF EXISTS "Extracted items readable" ON public.extracted_boq_items;
CREATE POLICY "Extracted items readable when the extraction is"
  ON public.extracted_boq_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.boq_extractions e
     WHERE e.id = extracted_boq_items.extraction_id
       AND (
         (e.related_opportunity_id IS NULL AND e.uploaded_by = (SELECT auth.uid()))
         OR public.can_read_boq(e.related_opportunity_id, (SELECT auth.uid()))
       )
  ));

DROP POLICY IF EXISTS "Extracted items insertable by sales contributors" ON public.extracted_boq_items;
CREATE POLICY "Extracted items insertable by sales contributors"
  ON public.extracted_boq_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_sales_contributor((SELECT auth.uid())));

GRANT SELECT, INSERT ON public.boq_extractions      TO authenticated;
GRANT SELECT, INSERT ON public.extracted_boq_items  TO authenticated;
REVOKE DELETE, UPDATE ON public.boq_extractions     FROM authenticated, anon;
REVOKE DELETE, UPDATE ON public.extracted_boq_items FROM authenticated, anon;

COMMENT ON TABLE public.boq_extractions IS
  'Staging for AI BOQ extraction. Nothing here is canonical: a human promotes lines into a BOQ. The extractor writes here and never to boqs/boq_items — see boq_history_is_immutable().';
