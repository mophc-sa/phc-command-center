-- =========================================================
-- SECURITY HOTFIX — activity and task read isolation.
--
-- THE EXPOSURE
-- ------------
--   activities  SELECT  USING (is_active_user(auth.uid()))
--   tasks       SELECT  USING (is_active_user(auth.uid()))
--
-- Every active account — including `viewer`, including a suspended-then-
-- reactivated one, including a salesperson with no connection to the deal —
-- could read every logged call, site visit, meeting and internal note in the
-- system, plus `draft_content`, which is where unsent client correspondence
-- and the reasoning behind a price tend to sit.
--
-- This is the same shape as the attachment, contract and commercial findings
-- earlier in this project: a table that reads like workflow metadata but
-- carries the commercial conversation.
--
-- WHY A PER-ROW PREDICATE AND NOT JUST can_read_boq()
-- ---------------------------------------------------
-- An activity does not have to belong to an opportunity. It can hang off a
-- company, a contact, an RFQ or a tender with related_opportunity_id NULL.
-- Gating solely on the opportunity would return FALSE for every one of those
-- rows and silently blank the company, RFQ and tender timelines — a
-- fail-closed break, but a break. So the predicate branches on whichever
-- entity the row actually points at, the same way document_entity_grants()
-- does for Phase 6 documents.
--
-- The argument list mirrors can_read_contract(): columns in, no re-read of the
-- row being filtered.
--
-- WHAT NARROWS, DELIBERATELY
-- --------------------------
-- A company-level activity logged by another salesperson stops being visible
-- to unrelated salespeople. Management and the pipeline still see everything
-- through is_pipeline_operator(). Two dashboards that counted every activity
-- or listed every task now count and list what the viewer is entitled to,
-- which is the correct number rather than the larger one.
--
-- Deliberately NOT is_sales_contributor(): that admits every salesperson, and
-- would leave the hole roughly where it is.
--
-- HISTORY STOPS BEING ERASABLE
-- ----------------------------
-- tasks, account_interactions and communication_templates each carried a
-- DELETE policy, against the append-only posture of every table added since
-- Phase 6. Nothing in the application deletes them — verified against the
-- frontend before removing the policies — so this closes a capability that
-- was never used and would have destroyed history without trace.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Who may read one activity ============
CREATE OR REPLACE FUNCTION public.can_read_activity(
  _opportunity_id UUID,
  _company_id     UUID,
  _rfq_id         UUID,
  _tender_id      UUID,
  _owner_id       UUID,
  _created_by     UUID,
  _user_id        UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    _user_id IS NOT NULL
    AND public.is_active_user(_user_id)
    AND (
      -- Your own record, whoever it is about.
      _owner_id   = _user_id
      OR _created_by = _user_id

      -- Attached to a deal: the deal's existing boundary decides.
      OR (_opportunity_id IS NOT NULL
          AND public.can_read_boq(_opportunity_id, _user_id))

      -- Attached to an RFQ or tender: the same stake the document registry uses.
      OR (_rfq_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.rfqs r
             WHERE r.id = _rfq_id
               AND (r.sales_owner_id = _user_id OR r.assigned_to = _user_id)))
      OR (_tender_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.tenders t
             WHERE t.id = _tender_id AND t.tender_owner_id = _user_id))

      -- The people who run the pipeline see the whole board. A company- or
      -- contact-only activity reaches nobody else.
      OR public.is_pipeline_operator(_user_id)
    );
$$;

COMMENT ON FUNCTION public.can_read_activity IS
  'Whether a user may read one activity, branching on whichever entity it points at — an activity need not belong to an opportunity. Columns in rather than an id, mirroring can_read_contract(), so filtering does not re-read the row. Deliberately not is_sales_contributor(), which admits every salesperson and would leave the exposure roughly intact.';

DROP POLICY IF EXISTS "Activities readable" ON public.activities;
DROP POLICY IF EXISTS "Activities readable by the record's people" ON public.activities;
CREATE POLICY "Activities readable by the record's people"
  ON public.activities FOR SELECT TO authenticated
  USING (public.can_read_activity(
           related_opportunity_id, company_id, related_rfq_id, related_tender_id,
           owner_id, created_by, (SELECT auth.uid())));

-- ============ 2. Tasks ============
DROP POLICY IF EXISTS "Tasks readable" ON public.tasks;
DROP POLICY IF EXISTS "Tasks readable by their people" ON public.tasks;
CREATE POLICY "Tasks readable by their people"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    public.is_active_user((SELECT auth.uid()))
    AND (
      owner_id   = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
      OR (related_opportunity_id IS NOT NULL
          AND public.can_read_boq(related_opportunity_id, (SELECT auth.uid())))
      OR public.is_pipeline_operator((SELECT auth.uid()))
    ));

-- ============ 3. History stops being erasable ============
-- Nothing in the application deletes any of these three; the policies were
-- capability without a caller.
CREATE OR REPLACE FUNCTION public.refuse_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are closed or cancelled, never deleted. | لا تُحذف السجلات.', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END; $$;

COMMENT ON FUNCTION public.refuse_delete IS
  'Shared no-delete trigger. Backs the absence of a DELETE policy for the service role, which bypasses RLS but not triggers.';

DROP POLICY IF EXISTS "Tasks deletable by commercial managers" ON public.tasks;
DROP POLICY IF EXISTS "Tasks writable by commercial managers" ON public.tasks;
DROP TRIGGER IF EXISTS tasks_no_delete ON public.tasks;
CREATE TRIGGER tasks_no_delete BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete();

DROP POLICY IF EXISTS "Account interactions deletable by sales contributors" ON public.account_interactions;
DROP TRIGGER IF EXISTS account_interactions_no_delete ON public.account_interactions;
CREATE TRIGGER account_interactions_no_delete BEFORE DELETE ON public.account_interactions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete();

DROP POLICY IF EXISTS "Communication templates deletable by admins" ON public.communication_templates;
DROP TRIGGER IF EXISTS communication_templates_no_delete ON public.communication_templates;
CREATE TRIGGER communication_templates_no_delete BEFORE DELETE ON public.communication_templates
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete();

-- A template is retired with is_active = false, which the column already
-- supports and the compose modals already filter on.
COMMENT ON COLUMN public.communication_templates.is_active IS
  'Retirement flag. Templates are deactivated rather than deleted so a sent message can still be traced to the wording it used.';

-- ============ 4. Any DELETE policy left on these three is a mistake ============
-- Named individually above because policy names are not guaranteed; this
-- catches any that survived under a different name.
DO $$
DECLARE _p RECORD;
BEGIN
  FOR _p IN
    SELECT c.relname AS tbl, p.polname AS pol
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname IN ('tasks','account_interactions','communication_templates','activities')
       AND p.polcmd = 'd'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', _p.pol, _p.tbl);
    RAISE NOTICE 'dropped surviving DELETE policy %.%', _p.tbl, _p.pol;
  END LOOP;
END $$;
