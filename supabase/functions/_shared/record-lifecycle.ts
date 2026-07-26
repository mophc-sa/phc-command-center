// =============================================================================
// Sprint 8 — Record lifecycle: pure guard logic (archive / request-delete /
// execute-delete / duplicate flag). No I/O — the sales-os-api handlers call
// these first and only then touch the database. Kept pure so they're
// unit-testable without a live Supabase client (see
// src/lib/record-lifecycle.guards.test.ts), matching the existing pattern in
// _shared/approvals.ts (planApprovalExecution).
//
// The actual hard delete itself is NOT performed here or in the edge
// function — it runs entirely inside the atomic
// public.execute_approved_record_delete(...) Postgres function (see the
// Sprint 8 migration), so a partial failure can never leave the record
// deleted with the approval or audit trail out of sync.
// =============================================================================

// Tables with archived_at / archived_by / archive_reason columns.
export const ARCHIVABLE_TABLES = ["leads", "contacts", "companies", "rfqs", "tenders"] as const;
export type ArchivableTable = (typeof ARCHIVABLE_TABLES)[number];

// Hard-delete allowlist — reviewed conservatively. A table stays here only if
// deleting a row destroys nothing beyond that row's own life story:
//   follow_ups     — no incoming FK from any other table.
//   activities     — no incoming FK from any other table.
//   inbox_items    — pre-conversion capture only; nothing downstream depends on it.
//   boqs           — boq_items references it ON DELETE CASCADE, but those are
//                    the BOQ's own line items (nothing else's history);
//                    quotations.boq_id is ON DELETE SET NULL (unlinked, not destroyed).
//   import_batches — every import_* child table (import_files, import_rows,
//                    import_mappings, import_errors, import_duplicate_candidates,
//                    import_record_candidates, import_record_links,
//                    import_approval_queue, import_split_proposals) already
//                    references it ON DELETE CASCADE, so the DB side needs no
//                    manual per-table deletes — deleting the batch row atomically
//                    cascades all of them. The one thing SQL can't reach —
//                    the batch's uploaded files in Supabase Storage — is cleaned
//                    up separately by the sales-os-api execute_delete handler
//                    (see lifecycle.ts), after the DB delete commits.
//
// Everything else that could previously be hard-deleted moves to archive-only
// (leads, contacts, companies, rfqs, tenders — real archive columns exist) or,
// for quotations and projects, no destructive/hiding action at all yet (no
// archive columns exist for them either — flagged as a known gap, not solved
// here). Opportunities is permanently excluded — stage='archived' only, and
// its cascade (stakeholders, tasks, boqs, quotations, its own
// approvals/audit trail) is exactly why this list is conservative.
export const DELETABLE_TABLES = ["follow_ups", "activities", "inbox_items", "boqs", "import_batches"] as const;
export type DeletableTable = (typeof DELETABLE_TABLES)[number];

// Documentation/UI-gating constant — every table that used to be
// hard-deletable and now is not. Not consumed by any guard below (absence
// from DELETABLE_TABLES already blocks them); exported so callers can render
// an explicit "archive only" state instead of just hiding the delete option.
export const ARCHIVE_ONLY_TABLES = [
  "leads", "contacts", "companies", "rfqs", "tenders",
  "quotations", "projects", "opportunities",
] as const;

// Entity types eligible for human "mark duplicate" flagging. Narrower than
// DELETABLE_TABLES on purpose — duplicate-flagging is only meaningful for
// primary sales records a person might confuse with another, not for child/
// transactional rows. Opportunities IS included here — duplicate flagging is
// a read/flag-only action, unrelated to the hard-delete allowlist above.
export const DUPLICATE_ALLOWED_TABLES = [
  "leads", "contacts", "companies", "opportunities", "rfqs", "tenders",
] as const;
export type DuplicateTable = (typeof DUPLICATE_ALLOWED_TABLES)[number];

export function isArchivableEntityType(t: string): t is ArchivableTable {
  return (ARCHIVABLE_TABLES as readonly string[]).includes(t);
}
export function isDeletableEntityType(t: string): t is DeletableTable {
  return (DELETABLE_TABLES as readonly string[]).includes(t);
}
export function isDuplicateAllowedEntityType(t: string): t is DuplicateTable {
  return (DUPLICATE_ALLOWED_TABLES as readonly string[]).includes(t);
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

// Guard for request_delete — checked before any database write. The
// opportunities check is technically redundant with the allowlist check
// below it (opportunities was never in DELETABLE_TABLES to begin with) but
// is kept as its own branch for a specific, actionable error message rather
// than a generic "unsupported entity type".
export function validateDeleteRequest(entityType: string, entityId: string): GuardResult {
  if (entityType === "opportunities") {
    return {
      ok: false,
      reason: "Opportunities cannot be deleted — archive the opportunity (stage='archived') instead",
    };
  }
  if (!isDeletableEntityType(entityType)) {
    return { ok: false, reason: `Unsupported entityType for delete request: ${entityType}` };
  }
  if (!entityId) return { ok: false, reason: "entityId is required" };
  return { ok: true };
}

export type ApprovalForExecution = {
  status: string;
  requested_action: string | null;
  execution_status: string | null;
  linked_record_type: string | null;
  linked_record_id: string | null;
};

// Guard for execute_delete — every precondition checked before any database
// write, including rejecting old/malformed approvals that somehow target
// opportunities or any table since removed from the allowlist (e.g. leads,
// which was hard-deletable earlier in this same sprint before the review
// tightened it).
export function validateExecuteDelete(appr: ApprovalForExecution): GuardResult {
  if (appr.status !== "approved") return { ok: false, reason: "This delete request has not been approved" };
  if (appr.requested_action !== "delete_record") {
    return { ok: false, reason: "This approval is not a delete request" };
  }
  if (appr.execution_status === "executed") {
    return { ok: false, reason: "This delete has already been executed" };
  }
  const entityType = appr.linked_record_type ?? "";
  const entityId = appr.linked_record_id ?? "";
  if (entityType === "opportunities") {
    return {
      ok: false,
      reason: "Opportunities cannot be hard-deleted — use archive (stage='archived') instead",
    };
  }
  if (!isDeletableEntityType(entityType) || !entityId) {
    return { ok: false, reason: "Approval is missing a valid linked record" };
  }
  return { ok: true };
}

// Mirrors the partial unique index one_active_delete_request_per_record in
// the Sprint 8 migration — an "active" delete request is still pending a
// decision, or approved but not yet executed. execution_status 'skipped' is
// the normal post-approval state for a delete_record approval (delete_record
// is deliberately excluded from the Approval Execution Engine's
// auto-execute allowlist — see _shared/approvals.ts), so it still counts as
// active; only 'executed' clears it.
//
// NULL-safe by construction: `executionStatus !== "executed"` is `true` when
// executionStatus is `null` (unlike SQL's `<>`, which evaluates NULL
// comparisons to UNKNOWN) — a brand-new approval row before execution_status
// is ever set is correctly treated as active. This must keep matching the
// migration's `execution_status IS DISTINCT FROM 'executed'` index predicate
// exactly, including this NULL case.
export function isActiveDeleteRequestStatus(status: string, executionStatus: string | null): boolean {
  return (status === "pending" || status === "approved") && executionStatus !== "executed";
}

// Guard for flag_duplicate's basic input shape. Existence-in-database and
// already-paired checks require I/O and stay in the handler — this only
// covers what's decidable from the input alone.
export function validateDuplicatePair(
  entityType: string,
  entityId: string,
  duplicateOfId: string,
): GuardResult {
  if (!isDuplicateAllowedEntityType(entityType)) {
    return { ok: false, reason: `Unsupported entityType for duplicate flagging: ${entityType}` };
  }
  if (!entityId || !duplicateOfId) {
    return { ok: false, reason: "entityId and duplicateOfId are required" };
  }
  if (entityId === duplicateOfId) {
    return { ok: false, reason: "A record cannot be a duplicate of itself" };
  }
  return { ok: true };
}

// Guard for archive_record / unarchive_record.
export function validateArchiveTarget(entityType: string, entityId: string): GuardResult {
  if (!isArchivableEntityType(entityType)) {
    return { ok: false, reason: `Unsupported entityType for archive: ${entityType}` };
  }
  if (!entityId) return { ok: false, reason: "entityId is required" };
  return { ok: true };
}
