-- =========================================================
-- PHC Sales OS — Sprint 8: RBAC & Record Lifecycle hardening.
--
-- Rebuilt from the parked Sprint 7 patch (.handoff/rbac-hardening-sprint8-wip.patch)
-- against main after the Communication Hub (PR #18) merge. Renamed off
-- 20260711120000 — that version is now occupied by
-- 20260711120000_communication_hub.sql, already applied to PHC AGENT.
--
-- Three things, applied uniformly across the core sales tables (leads,
-- contacts, companies, opportunities, rfqs, tenders, follow_ups,
-- quotations, projects, boqs, activities, inbox_items):
--
--   1. INSERT / UPDATE policies stop hardcoding role literals (which meant
--      managing_director / general_manager / sales_ops were silently
--      excluded everywhere) and instead call the shared capability
--      predicates — is_sales_contributor() (new, below) for creation,
--      is_pipeline_operator() (existing) for the "not the owner but still
--      allowed to edit" branch of updates. This also fixes a real gap:
--      leads previously had NO owner-based update path at all, so a
--      salesperson could not edit their own assigned lead.
--
--   2. DELETE is removed everywhere a client could previously hard-delete
--      a record (sales_manager/ceo could) — including opportunities. Direct
--      delete is replaced by archive / request-delete / duplicate-flag
--      workflows built on top of the sales-os-api edge function
--      (server-side, audited). Both the RLS DELETE policy AND the
--      underlying table privilege are removed, so a client can never delete
--      even if a policy is mistakenly reintroduced without matching the
--      privilege layer. (Opportunities is additionally excluded from the
--      app-layer request_delete/execute_delete allowlist entirely — see
--      supabase/functions/_shared/record-lifecycle.ts — it uses
--      stage='archived' only.)
--
--   3. archived_at / archived_by / archive_reason columns are added to the
--      tables that had no soft-delete path at all (leads, contacts,
--      companies, rfqs; tenders already had archive_reason). Opportunities
--      is deliberately skipped — it already has an 'archived' stage value.
--
-- Non-destructive, additive + in-place policy replacement.
-- =========================================================

-- ---- 0. New capability predicate: is_sales_contributor -----------------
-- Everyone who may create day-to-day sales records, including salesperson
-- (who is deliberately excluded from is_pipeline_operator). Mirrors
-- canCreateSalesRecords in src/lib/roles.ts / supabase/functions/_shared/roles.ts.
CREATE OR REPLACE FUNCTION public.is_sales_contributor(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['managing_director','general_manager','ceo','sales_manager','bd_manager','sales_ops','salesperson']::public.app_role[]
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_sales_contributor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_sales_contributor(uuid) TO authenticated;

-- ---- 1. LEADS ------------------------------------------------------------
DROP POLICY IF EXISTS "Leads insertable by sales team" ON public.leads;
CREATE POLICY "Leads insertable by sales team" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Leads editable by BD/Manager" ON public.leads;
CREATE POLICY "Leads editable by owner or pipeline operator" ON public.leads FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Leads deletable by Manager" ON public.leads;
REVOKE DELETE ON public.leads FROM authenticated;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- ---- 2. CONTACTS ----------------------------------------------------------
DROP POLICY IF EXISTS "Contacts insertable by sales team" ON public.contacts;
CREATE POLICY "Contacts insertable by sales team" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Contacts updatable by owner or BD/Manager" ON public.contacts;
CREATE POLICY "Contacts editable by owner or pipeline operator" ON public.contacts FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Contacts deletable by Manager/CEO" ON public.contacts;
REVOKE DELETE ON public.contacts FROM authenticated;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- ---- 3. COMPANIES ----------------------------------------------------------
DROP POLICY IF EXISTS "Companies insertable by sales team" ON public.companies;
CREATE POLICY "Companies insertable by sales team" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Companies updatable by owner or BD/Manager" ON public.companies;
CREATE POLICY "Companies editable by owner or pipeline operator" ON public.companies FOR UPDATE TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Companies deletable by Manager/CEO" ON public.companies;
REVOKE DELETE ON public.companies FROM authenticated;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- ---- 4. OPPORTUNITIES -------------------------------------------------------
-- No archive columns — 'archived' is already a valid opportunity_stage value.
-- DELETE is still revoked at the DB layer (defense in depth); the app layer
-- additionally excludes opportunities from request_delete/execute_delete
-- entirely — see supabase/functions/_shared/record-lifecycle.ts.
DROP POLICY IF EXISTS "Sales team can insert opportunities" ON public.opportunities;
CREATE POLICY "Sales team can insert opportunities" ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Owner or Manager/CEO can update" ON public.opportunities;
CREATE POLICY "Owner or pipeline operator can update" ON public.opportunities FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Manager/CEO can delete" ON public.opportunities;
REVOKE DELETE ON public.opportunities FROM authenticated;

-- ---- 5. RFQS ------------------------------------------------------------
DROP POLICY IF EXISTS "RFQs insertable by sales team" ON public.rfqs;
CREATE POLICY "RFQs insertable by sales team" ON public.rfqs FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "RFQs updatable by owner or manager" ON public.rfqs;
CREATE POLICY "RFQs editable by owner or pipeline operator" ON public.rfqs FOR UPDATE TO authenticated
  USING (sales_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (sales_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "RFQs deletable by manager" ON public.rfqs;
REVOKE DELETE ON public.rfqs FROM authenticated;

ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- ---- 6. TENDERS ----------------------------------------------------------
-- archive_reason already exists (20260707100080_rfq_tender.sql).
DROP POLICY IF EXISTS "Tenders insertable by sales team" ON public.tenders;
CREATE POLICY "Tenders insertable by sales team" ON public.tenders FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Tenders updatable by owner or manager" ON public.tenders;
CREATE POLICY "Tenders editable by owner or pipeline operator" ON public.tenders FOR UPDATE TO authenticated
  USING (tender_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (tender_owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Tenders deletable by manager" ON public.tenders;
REVOKE DELETE ON public.tenders FROM authenticated;

ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---- 7. FOLLOW_UPS --------------------------------------------------------
-- Was a single FOR ALL policy (covering insert/update/delete). Split so
-- delete can be removed without reopening insert/update.
DROP POLICY IF EXISTS "Follow-ups editable by owner or Manager/CEO" ON public.follow_ups;
CREATE POLICY "Follow-ups insertable by sales team" ON public.follow_ups FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));
CREATE POLICY "Follow-ups editable by owner or pipeline operator" ON public.follow_ups FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));
REVOKE DELETE ON public.follow_ups FROM authenticated;

-- ---- 8. QUOTATIONS --------------------------------------------------------
DROP POLICY IF EXISTS "Quotations insertable by sales team" ON public.quotations;
CREATE POLICY "Quotations insertable by sales team" ON public.quotations FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Quotations updatable by owner or Manager/CEO" ON public.quotations;
CREATE POLICY "Quotations editable by owner or pipeline operator" ON public.quotations FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Quotations deletable by Manager/CEO" ON public.quotations;
REVOKE DELETE ON public.quotations FROM authenticated;

-- ---- 9. PROJECTS ----------------------------------------------------------
-- No individual owner column — update authority is role-based, same as
-- before, just via the shared predicate instead of a literal role array.
DROP POLICY IF EXISTS "Projects insertable by sales team" ON public.projects;
CREATE POLICY "Projects insertable by sales team" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Projects updatable by sales team" ON public.projects;
CREATE POLICY "Projects updatable by sales team" ON public.projects FOR UPDATE TO authenticated
  USING (public.is_sales_contributor(auth.uid()))
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Projects deletable by Manager/CEO" ON public.projects;
REVOKE DELETE ON public.projects FROM authenticated;

-- ---- 10. BOQS ---------------------------------------------------------
-- Was a single FOR ALL policy. Split the same way as follow_ups; update
-- authority is creator-or-pipeline-operator (no dedicated owner column).
DROP POLICY IF EXISTS "BOQs editable by sales team" ON public.boqs;
CREATE POLICY "BOQs insertable by sales team" ON public.boqs FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));
CREATE POLICY "BOQs editable by creator or pipeline operator" ON public.boqs FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (created_by = auth.uid() OR public.is_pipeline_operator(auth.uid()));
REVOKE DELETE ON public.boqs FROM authenticated;

-- ---- 11. ACTIVITIES ---------------------------------------------------
DROP POLICY IF EXISTS "Activities insertable by sales team" ON public.activities;
CREATE POLICY "Activities insertable by sales team" ON public.activities FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Activities editable by owner or Manager" ON public.activities;
CREATE POLICY "Activities editable by owner or pipeline operator" ON public.activities FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_pipeline_operator(auth.uid()));

DROP POLICY IF EXISTS "Activities deletable by owner or Manager" ON public.activities;
REVOKE DELETE ON public.activities FROM authenticated;

-- ---- 12. INBOX_ITEMS ----------------------------------------------------
-- Same gap pattern as the tables above (literal role list, no sales_ops /
-- executives, hard delete available to managers). Already has an
-- 'archived' inbox_status value and archive_reason column, so no new
-- archive columns needed.
DROP POLICY IF EXISTS "Inbox items insertable by sales team" ON public.inbox_items;
CREATE POLICY "Inbox items insertable by sales team" ON public.inbox_items FOR INSERT TO authenticated
  WITH CHECK (public.is_sales_contributor(auth.uid()));

DROP POLICY IF EXISTS "Inbox items editable by owner or manager" ON public.inbox_items;
CREATE POLICY "Inbox items editable by owner or pipeline operator" ON public.inbox_items FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_owner_id = auth.uid()
    OR public.is_pipeline_operator(auth.uid())
  )
  WITH CHECK (
    created_by = auth.uid()
    OR assigned_owner_id = auth.uid()
    OR public.is_pipeline_operator(auth.uid())
  );

DROP POLICY IF EXISTS "Inbox items deletable by manager" ON public.inbox_items;
REVOKE DELETE ON public.inbox_items FROM authenticated;

-- ---- 13. Atomic hard-delete execution (review fix — single transaction) ----
-- The Sprint 8 review found the original JS implementation of execute_delete
-- non-atomic: delete, approval-status update, and audit insert were three
-- separate PostgREST calls, so a failure after the delete could leave the
-- record gone with the approval still showing "not executed" and no audit
-- row. Everything below runs in ONE Postgres transaction — any error rolls
-- back the delete, the approval update, and the audit insert together. The
-- sales-os-api execute_delete handler now calls ONLY this RPC; it no longer
-- issues any direct delete/update/audit calls of its own.
--
-- Also tightens the hard-delete allowlist itself. Re-reviewed table by
-- table, conservatively this time — a table only stays hard-deletable if
-- deleting a row destroys nothing beyond that row's own life story:
--   follow_ups   — no incoming FK from any other table.
--   activities   — no incoming FK from any other table.
--   inbox_items  — pre-conversion capture only; nothing downstream depends on it.
--   boqs         — boq_items references it ON DELETE CASCADE, but those are
--                  the BOQ's own line items (nothing else's history);
--                  quotations.boq_id is ON DELETE SET NULL (unlinked, not destroyed).
-- Every other table that was previously hard-deletable (leads, contacts,
-- companies, rfqs, tenders, quotations, projects) moves to archive-only (or,
-- for quotations/projects, no destructive action at all yet — see the
-- Sprint 8 rebuild report). Opportunities remains permanently excluded —
-- stage='archived' only.
CREATE OR REPLACE FUNCTION public.execute_approved_record_delete(
  _approval_id uuid,
  _actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _appr record;
  _before jsonb;
  _deleted_count int;
  _allowed_tables text[] := ARRAY['follow_ups', 'activities', 'inbox_items', 'boqs'];
BEGIN
  IF NOT public.has_any_role(_actor_id, ARRAY['system_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'System admin authority required' USING ERRCODE = '42501';
  END IF;

  -- Lock the approval row for the duration of the transaction so a
  -- concurrent execute_delete call on the same approval cannot race past
  -- the execution_status check below.
  SELECT * INTO _appr FROM public.approvals WHERE id = _approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found' USING ERRCODE = 'P0002';
  END IF;

  IF _appr.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'This delete request has not been approved' USING ERRCODE = '22023';
  END IF;
  IF _appr.requested_action IS DISTINCT FROM 'delete_record' THEN
    RAISE EXCEPTION 'This approval is not a delete request' USING ERRCODE = '22023';
  END IF;
  IF _appr.execution_status = 'executed' THEN
    RAISE EXCEPTION 'This delete has already been executed' USING ERRCODE = '22023';
  END IF;
  IF _appr.linked_record_type IS NULL OR _appr.linked_record_id IS NULL THEN
    RAISE EXCEPTION 'Approval is missing a valid linked record' USING ERRCODE = '22023';
  END IF;
  IF _appr.linked_record_type = 'opportunities' THEN
    RAISE EXCEPTION 'Opportunities cannot be hard-deleted — use archive (stage=''archived'') instead' USING ERRCODE = '22023';
  END IF;
  IF NOT (_appr.linked_record_type = ANY(_allowed_tables)) THEN
    RAISE EXCEPTION 'Unsupported entityType for delete: %', _appr.linked_record_type USING ERRCODE = '22023';
  END IF;

  -- Before-snapshot — loaded BEFORE the delete. Table names cannot be
  -- parameterized in plain SQL, and this function must never build dynamic
  -- SQL from user-influenced input, so branch explicitly over the small,
  -- fixed allowlist instead.
  CASE _appr.linked_record_type
    WHEN 'follow_ups' THEN
      SELECT to_jsonb(t) INTO _before FROM public.follow_ups t WHERE t.id = _appr.linked_record_id;
    WHEN 'activities' THEN
      SELECT to_jsonb(t) INTO _before FROM public.activities t WHERE t.id = _appr.linked_record_id;
    WHEN 'inbox_items' THEN
      SELECT to_jsonb(t) INTO _before FROM public.inbox_items t WHERE t.id = _appr.linked_record_id;
    WHEN 'boqs' THEN
      SELECT to_jsonb(t) INTO _before FROM public.boqs t WHERE t.id = _appr.linked_record_id;
  END CASE;

  IF _before IS NULL THEN
    RAISE EXCEPTION 'Target record not found: %/%', _appr.linked_record_type, _appr.linked_record_id USING ERRCODE = 'P0002';
  END IF;

  CASE _appr.linked_record_type
    WHEN 'follow_ups' THEN DELETE FROM public.follow_ups WHERE id = _appr.linked_record_id;
    WHEN 'activities' THEN DELETE FROM public.activities WHERE id = _appr.linked_record_id;
    WHEN 'inbox_items' THEN DELETE FROM public.inbox_items WHERE id = _appr.linked_record_id;
    WHEN 'boqs' THEN DELETE FROM public.boqs WHERE id = _appr.linked_record_id;
  END CASE;
  GET DIAGNOSTICS _deleted_count = ROW_COUNT;
  IF _deleted_count <> 1 THEN
    RAISE EXCEPTION 'Delete affected % row(s), expected exactly 1', _deleted_count USING ERRCODE = 'P0001';
  END IF;

  -- executed_at / executed_by / execution_status / execution_error all exist
  -- on approvals as of 20260708130020_approval_execution.sql (confirmed
  -- present — this migration does not need to add them).
  UPDATE public.approvals
  SET execution_status = 'executed',
      executed_at = now(),
      executed_by = _actor_id,
      execution_error = NULL
  WHERE id = _approval_id;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
  VALUES (
    _actor_id,
    'user',
    _appr.linked_record_type || '.deleted',
    _appr.linked_record_type,
    _appr.linked_record_id,
    _before,
    jsonb_build_object(
      'approval_id', _approval_id,
      'deleted_table', _appr.linked_record_type,
      'deleted_record_id', _appr.linked_record_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object('entityType', _appr.linked_record_type, 'entityId', _appr.linked_record_id),
    'approval_id', _approval_id
  );
END;
$$;

-- Callable only via the service-role client from sales-os-api — never
-- directly from a browser session.
REVOKE EXECUTE ON FUNCTION public.execute_approved_record_delete(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_approved_record_delete(uuid, uuid) TO service_role;

-- ---- 14. Prevent duplicate active delete requests ---------------------
-- DB-enforced: a partial unique index is fully compatible with this schema
-- (every predicate below is a plain, immutable comparison against the row's
-- own columns — no subqueries needed), so this is authoritative, not just a
-- server-side check. "Active" mirrors the request_delete guard: still
-- pending a decision, or approved but not yet executed (execution_status
-- 'skipped' — the normal post-approval state for a delete_record approval,
-- since delete_record is deliberately excluded from the Approval Execution
-- Engine's auto-execute allowlist — still counts as active here; only
-- 'executed' clears it). The application layer (isActiveDeleteRequestStatus
-- in _shared/record-lifecycle.ts) also checks this before insert, purely for
-- a clean error message — this index is what actually guarantees it under
-- concurrent requests.
--
-- Uses IS DISTINCT FROM rather than <>: a plain `<>` comparison against NULL
-- evaluates to UNKNOWN in Postgres, and a partial index silently EXCLUDES any
-- row whose WHERE predicate is UNKNOWN (not just FALSE) — so a delete_request
-- approval with execution_status still NULL would have been invisible to
-- this index, defeating the whole point. IS DISTINCT FROM is NULL-safe: NULL
-- IS DISTINCT FROM 'executed' evaluates to TRUE, so a NULL row is correctly
-- included (still "active").
CREATE UNIQUE INDEX IF NOT EXISTS one_active_delete_request_per_record
  ON public.approvals (linked_record_type, linked_record_id)
  WHERE requested_action = 'delete_record'
    AND status IN ('pending', 'approved')
    AND execution_status IS DISTINCT FROM 'executed';
