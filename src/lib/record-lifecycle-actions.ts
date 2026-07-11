import { callBackend } from "@/lib/backend";

// Client wrappers for the Sprint 8 record-lifecycle actions in the
// `sales-os-api` Edge Function. Direct client-side DELETE no longer works on
// any sales table (RLS DELETE policies dropped + DELETE revoked at the grant
// layer) — these six actions are the only supported way to retire or restore
// a record.

// Archivable is the subset of tables with archived_at/archived_by/archive_reason
// columns.
export type ArchivableEntityType = "leads" | "contacts" | "companies" | "rfqs" | "tenders";
export const ARCHIVABLE_ENTITY_TYPES: readonly ArchivableEntityType[] = [
  "leads", "contacts", "companies", "rfqs", "tenders",
];

// Hard-delete allowlist — reviewed conservatively (Sprint 8 review). A table
// is only here if deleting a row destroys nothing beyond that row's own life
// story: no other table has a business-history FK into it, or (boqs) the
// only cascade is onto rows that belong exclusively to it.
//
// Everything that used to be hard-deletable and isn't anymore — leads,
// contacts, companies, rfqs, tenders (archive-only, real archive columns
// exist), quotations, projects (no destructive/hiding action at all yet —
// a known gap, not solved here), and opportunities (stage='archived' only,
// never hard-deletable at all) — is intentionally absent.
export type DeletableEntityType = "follow_ups" | "activities" | "inbox_items" | "boqs";
export const DELETABLE_ENTITY_TYPES: readonly DeletableEntityType[] = [
  "follow_ups", "activities", "inbox_items", "boqs",
];

// Duplicate-flagging is narrower than the full record set — only primary
// sales records a person might genuinely confuse with another. Opportunities
// IS included here (flagging is read/flag-only, unrelated to hard delete).
export type DuplicateEntityType = "leads" | "contacts" | "companies" | "opportunities" | "rfqs" | "tenders";
export const DUPLICATE_ENTITY_TYPES: readonly DuplicateEntityType[] = [
  "leads", "contacts", "companies", "opportunities", "rfqs", "tenders",
];

export async function archiveRecord(input: {
  entityType: ArchivableEntityType;
  entityId: string;
  reason?: string;
}) {
  const res = await callBackend<{ record: unknown }>("archive_record", {
    entityType: input.entityType,
    entityId: input.entityId,
    reason: input.reason ?? null,
  });
  return res.record;
}

export async function unarchiveRecord(input: { entityType: ArchivableEntityType; entityId: string }) {
  const res = await callBackend<{ record: unknown }>("unarchive_record", {
    entityType: input.entityType,
    entityId: input.entityId,
  });
  return res.record;
}

export async function requestDelete(input: {
  entityType: DeletableEntityType;
  entityId: string;
  reason: string;
}) {
  const res = await callBackend<{ pending_approval: boolean; approval: unknown }>("request_delete", {
    entityType: input.entityType,
    entityId: input.entityId,
    reason: input.reason,
  });
  return res.approval;
}

// system_admin only, and only once a commercial manager has approved the
// linked delete_request approval via decideApproval(). Executes atomically
// server-side via the execute_approved_record_delete Postgres function — the
// response always reflects a fully-committed transaction (delete + approval
// update + audit row), never a partial state.
export async function executeDelete(input: { approvalId: string }) {
  return callBackend<{ ok: boolean; deleted: { entityType: string; entityId: string }; approval_id: string }>(
    "execute_delete",
    { approvalId: input.approvalId },
  );
}

export async function flagDuplicate(input: {
  entityType: DuplicateEntityType;
  entityId: string;
  duplicateOfId: string;
  reason?: string;
}) {
  const res = await callBackend<{ group_id: string }>("flag_duplicate", {
    entityType: input.entityType,
    entityId: input.entityId,
    duplicateOfId: input.duplicateOfId,
    reason: input.reason ?? null,
  });
  return res.group_id;
}

export async function resolveDuplicateGroup(input: {
  groupId: string;
  resolution: "merged" | "dismissed";
}) {
  const res = await callBackend<{ group: unknown }>("resolve_duplicate_group", {
    groupId: input.groupId,
    resolution: input.resolution,
  });
  return res.group;
}
