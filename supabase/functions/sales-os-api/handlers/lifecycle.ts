import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import {
  json,
  err,
  canApproveCommercialAction,
  canCreateSalesRecords,
  canExecuteDelete,
  canManageSalesPipeline,
  isActiveDeleteRequestStatus,
  validateArchiveTarget,
  validateDeleteRequest,
  validateDuplicatePair,
} from "../shared.ts";

async function archive_record(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const entityType = String(payload.entityType ?? "");
  const entityId = String(payload.entityId ?? "");
  const guard = validateArchiveTarget(entityType, entityId);
  if (!guard.ok) return err(guard.reason);
  const reason = (payload.reason as string) ?? null;
  const svc = ctx.svc;
  const { data, error } = await svc
    .from(entityType)
    .update({
      archived_at: new Date().toISOString(),
      archived_by: caller.userId,
      archive_reason: reason,
    })
    .eq("id", entityId)
    .select()
    .single();
  if (error) return err(error.message, 400);
  await auditLog(
    svc,
    caller.userId,
    `${entityType}.archived`,
    entityType,
    entityId,
    { reason },
    caller.roles,
  );
  return json({ ok: true, record: data });
}

// Reverse of archive_record — clears the three archive columns. Same
// authority as archiving.

async function unarchive_record(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const entityType = String(payload.entityType ?? "");
  const entityId = String(payload.entityId ?? "");
  const guard = validateArchiveTarget(entityType, entityId);
  if (!guard.ok) return err(guard.reason);
  const svc = ctx.svc;
  const { data, error } = await svc
    .from(entityType)
    .update({ archived_at: null, archived_by: null, archive_reason: null })
    .eq("id", entityId)
    .select()
    .single();
  if (error) return err(error.message, 400);
  await auditLog(
    svc,
    caller.userId,
    `${entityType}.unarchived`,
    entityType,
    entityId,
    {},
    caller.roles,
  );
  return json({ ok: true, record: data });
}

// Any sales contributor may request a delete — this only opens an
// approval, never touches the record. "delete_record" is deliberately NOT
// in EXECUTABLE_ACTIONS (see _shared/approvals.ts), so a manager approving
// this via decide_approval never auto-deletes — it only unblocks
// execute_delete below, a genuinely separate step by a different role.
// Opportunities are rejected here — see validateDeleteRequest — they use
// stage='archived' instead; request a stage change via
// update_opportunity_stage. Rejects a second active request for the same
// record (see one_active_delete_request_per_record in the migration —
// this check gives a clean error; the partial unique index is what
// actually guarantees it under concurrent requests).

async function request_delete(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canCreateSalesRecords(caller.roles)) return err("Sales role required", 403);
  const entityType = String(payload.entityType ?? "");
  const entityId = String(payload.entityId ?? "");
  const guard = validateDeleteRequest(entityType, entityId);
  if (!guard.ok) return err(guard.reason);
  const reason = (payload.reason as string) ?? null;
  const svc = ctx.svc;

  const { data: existingRequests, error: exErr } = await svc
    .from("approvals")
    .select("status, execution_status")
    .eq("requested_action", "delete_record")
    .eq("linked_record_type", entityType)
    .eq("linked_record_id", entityId);
  if (exErr) return err(exErr.message, 400);
  const alreadyActive = (existingRequests ?? []).some(
    (r: { status: string; execution_status: string | null }) =>
      isActiveDeleteRequestStatus(r.status, r.execution_status),
  );
  if (alreadyActive) {
    return err("A delete request for this record is already pending or approved", 409);
  }

  const { data: appr, error } = await svc
    .from("approvals")
    .insert({
      approval_type: "delete_request",
      requested_by: caller.userId,
      status: "pending",
      decision_notes: reason,
      linked_record_type: entityType,
      linked_record_id: entityId,
      requested_action: "delete_record",
      requested_payload: { entityType, entityId, reason },
    })
    .select()
    .single();
  if (error) {
    // Race fallback: two concurrent requests both pass the check above —
    // the partial unique index rejects the second insert (Postgres 23505).
    if ((error as { code?: string }).code === "23505") {
      return err("A delete request for this record is already pending or approved", 409);
    }
    return err(error.message, 400);
  }
  await auditLog(
    svc,
    caller.userId,
    "delete.requested",
    entityType,
    entityId,
    { approval: appr?.id, reason },
    caller.roles,
  );
  return json({ ok: true, pending_approval: true, approval: appr });
}

// The ONLY path that actually deletes a row. system_admin only, and only
// once a commercial manager has approved the linked delete_request
// approval — two separate steps by two different roles. Delegates
// entirely to the atomic public.execute_approved_record_delete(...)
// Postgres function (see the Sprint 8 migration): loading the
// before-snapshot, deleting, verifying the rowcount, marking the approval
// executed, and writing the audit row all happen in ONE transaction there.
// This handler performs NO direct delete/update/audit calls of its own —
// if the RPC call fails for any reason, nothing changed.

async function execute_delete(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller } = ctx;
  if (!canExecuteDelete(caller.roles)) return err("System admin authority required", 403);
  const approvalId = String(payload.approvalId ?? "");
  if (!approvalId) return err("approvalId is required");
  const svc = ctx.svc;

  const { data, error } = await svc.rpc("execute_approved_record_delete", {
    _approval_id: approvalId,
    _actor_id: caller.userId,
  });
  if (error) return err(error.message, 409);
  return json(data);
}

// Mark a record as a probable duplicate of another. Low blast radius (no
// data is touched), so any sales contributor may flag one. A commercial
// manager later resolves the group — this never auto-merges. Both records
// must exist in the same table, and there must not already be an open
// duplicate group linking this exact pair.

async function flag_duplicate(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canCreateSalesRecords(caller.roles)) return err("Sales role required", 403);
  const entityType = String(payload.entityType ?? "");
  const entityId = String(payload.entityId ?? "");
  const duplicateOfId = String(payload.duplicateOfId ?? "");
  const guard = validateDuplicatePair(entityType, entityId, duplicateOfId);
  if (!guard.ok) return err(guard.reason);

  const svc = ctx.svc;

  // Both records must actually exist, in the same table (entityType is a
  // single parameter shared by both ids, so "same table" holds by
  // construction — this confirms both ids are real rows in it).
  const { data: existingRows, error: exErr } = await svc
    .from(entityType)
    .select("id")
    .in("id", [entityId, duplicateOfId]);
  if (exErr) return err(exErr.message, 400);
  const foundIds = new Set((existingRows ?? []).map((r: { id: string }) => r.id));
  if (!foundIds.has(entityId)) return err(`Record not found: ${entityType}/${entityId}`, 404);
  if (!foundIds.has(duplicateOfId))
    return err(`Record not found: ${entityType}/${duplicateOfId}`, 404);

  // Prevent a duplicate OPEN group for the exact same pair.
  const { data: members } = await svc
    .from("duplicate_group_members")
    .select("group_id, entity_id")
    .eq("entity_type", entityType)
    .in("entity_id", [entityId, duplicateOfId]);
  const candidateGroupIds = [
    ...new Set((members ?? []).map((m: { group_id: string }) => m.group_id)),
  ];
  if (candidateGroupIds.length > 0) {
    const { data: openGroups } = await svc
      .from("duplicate_groups")
      .select("id")
      .in("id", candidateGroupIds)
      .eq("status", "open");
    const openGroupIds = new Set((openGroups ?? []).map((g: { id: string }) => g.id));
    const perGroupCount = new Map<string, number>();
    for (const m of members ?? []) {
      if (openGroupIds.has(m.group_id))
        perGroupCount.set(m.group_id, (perGroupCount.get(m.group_id) ?? 0) + 1);
    }
    const alreadyPaired = [...perGroupCount.values()].some((c) => c >= 2);
    if (alreadyPaired) return err("An open duplicate group already links these two records", 409);
  }

  const reason = (payload.reason as string) ?? null;
  const { data: group, error: gErr } = await svc
    .from("duplicate_groups")
    .insert({ entity_type: entityType, match_reason: reason ?? "Manually flagged", status: "open" })
    .select("id")
    .single();
  if (gErr || !group) return err(gErr?.message ?? "Could not create duplicate group", 400);
  const { error: mErr } = await svc.from("duplicate_group_members").insert([
    { group_id: group.id, entity_type: entityType, entity_id: entityId },
    { group_id: group.id, entity_type: entityType, entity_id: duplicateOfId },
  ]);
  if (mErr) return err(mErr.message, 400);
  await auditLog(
    svc,
    caller.userId,
    "duplicate.flagged",
    entityType,
    entityId,
    {
      group_id: group.id,
      duplicate_of: duplicateOfId,
    },
    caller.roles,
  );
  return json({ ok: true, group_id: group.id });
}

// A commercial manager resolves an open duplicate group. "merged" records
// the decision only — no field-level merge or child-record relinking is
// performed; that remains a manual follow-up, out of scope for this sprint.

async function resolve_duplicate_group(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canApproveCommercialAction(caller.roles))
    return err("Commercial approval authority required", 403);
  const groupId = String(payload.groupId ?? "");
  const resolution = String(payload.resolution ?? "");
  if (!groupId) return err("groupId is required");
  if (resolution !== "merged" && resolution !== "dismissed") {
    return err("resolution must be 'merged' or 'dismissed'");
  }
  const svc = ctx.svc;
  const { data, error } = await svc
    .from("duplicate_groups")
    .update({ status: resolution })
    .eq("id", groupId)
    .select()
    .single();
  if (error) return err(error.message, 400);
  await auditLog(
    svc,
    caller.userId,
    "duplicate.resolved",
    "duplicate_group",
    groupId,
    { resolution },
    caller.roles,
  );
  return json({ ok: true, group: data });
}

export const lifecycleModule: HandlerModule = {
  name: "lifecycle",
  handlers: {
    archive_record,
    unarchive_record,
    request_delete,
    execute_delete,
    flag_duplicate,
    resolve_duplicate_group,
  },
};
