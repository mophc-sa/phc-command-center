-- =========================================================
-- PHC Sales OS — Route import-batch purge through the governed
-- delete flow (Pathfinder D5).
--
-- Follow-up to 20260711160000_rbac_record_lifecycle_hardening.sql
-- (already applied — this migration is purely additive, a
-- CREATE OR REPLACE on the same function, and does not edit that
-- file). Adds 'import_batches' to execute_approved_record_delete's
-- hard-delete allowlist, replacing the import-pipeline Edge
-- Function's bespoke purge_batch handler (deleted in a follow-up
-- code change, not this migration).
--
-- Every table that references import_batches already declares an FK
-- that keeps the DELETE from ever being blocked: most (import_record_links,
-- import_approval_queue, import_duplicate_candidates, import_errors,
-- import_mappings, import_rows, import_files, import_record_candidates
-- and its own dependents) are ON DELETE CASCADE, so a single DELETE on
-- import_batches removes them atomically — this function does NOT
-- re-implement that cascade manually, Postgres already does it. A
-- smaller set (import_source_profiles.last_successful_batch_id,
-- account_interactions.source_batch_id, quotation_updates.source_batch_id,
-- sales_actuals_monthly.source_batch_id — all added in
-- 20260714200000_import_intelligence_v2.sql /
-- 20260714210000_business_destinations.sql) are ON DELETE SET NULL
-- instead: purging a batch would unlink its provenance pointer from
-- those tables rather than cascade-deleting the live business rows,
-- which is the correct behavior for columns on real CRM records. As of
-- this migration no application code writes to any of those four
-- source_batch_id/last_successful_batch_id columns (confirmed by
-- repo-wide search) — they are unused schema laid down ahead of a
-- feature that doesn't exist yet, so the committed-links guard below
-- (which only checks import_record_links) has nothing to miss today.
-- If a future feature starts populating any of those four columns
-- outside of an import_record_links-tracked commit, revisit whether
-- the guard needs to also check them.
--
-- Storage cleanup (the batch's uploaded file objects) cannot happen
-- here — PL/pgSQL cannot call the Storage API. That step lives in
-- sales-os-api's execute_delete handler, after this RPC succeeds.
-- =========================================================

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
  _allowed_tables text[] := ARRAY['follow_ups', 'activities', 'inbox_items', 'boqs', 'import_batches'];
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
    WHEN 'import_batches' THEN
      SELECT to_jsonb(t) INTO _before FROM public.import_batches t WHERE t.id = _appr.linked_record_id;
  END CASE;

  IF _before IS NULL THEN
    RAISE EXCEPTION 'Target record not found: %/%', _appr.linked_record_type, _appr.linked_record_id USING ERRCODE = 'P0002';
  END IF;

  CASE _appr.linked_record_type
    WHEN 'follow_ups' THEN DELETE FROM public.follow_ups WHERE id = _appr.linked_record_id;
    WHEN 'activities' THEN DELETE FROM public.activities WHERE id = _appr.linked_record_id;
    WHEN 'inbox_items' THEN DELETE FROM public.inbox_items WHERE id = _appr.linked_record_id;
    WHEN 'boqs' THEN DELETE FROM public.boqs WHERE id = _appr.linked_record_id;
    -- Cascades import_record_links, import_approval_queue,
    -- import_duplicate_candidates, import_errors, import_mappings,
    -- import_rows, import_files, import_record_candidates (and its
    -- own dependents) automatically via their existing
    -- ON DELETE CASCADE foreign keys — no manual per-table deletes.
    --
    -- Preserves the old purge_batch handler's one safety check: refuse to
    -- purge a batch that has committed record links (rows the import
    -- pipeline actually wrote into the live CRM). Deleting the batch would
    -- otherwise cascade-delete import_record_links too, destroying the
    -- provenance trail linking those live records back to their import
    -- origin, without touching the live records themselves — silently
    -- losing traceability rather than losing data, but still not something
    -- this function should do without a human resolving it first.
    WHEN 'import_batches' THEN
      IF EXISTS (SELECT 1 FROM public.import_record_links WHERE batch_id = _appr.linked_record_id) THEN
        RAISE EXCEPTION 'Batch has committed record links; purge blocked until they are resolved' USING ERRCODE = '22023';
      END IF;
      DELETE FROM public.import_batches WHERE id = _appr.linked_record_id;
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
