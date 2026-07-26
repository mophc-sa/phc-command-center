// Record lifecycle — pure guard logic (archive/unarchive/request-delete/
// execute-delete/duplicate flag). Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  ARCHIVABLE_TABLES,
  ARCHIVE_ONLY_TABLES,
  DELETABLE_TABLES,
  DUPLICATE_ALLOWED_TABLES,
  isActiveDeleteRequestStatus,
  isArchivableEntityType,
  isDeletableEntityType,
  isDuplicateAllowedEntityType,
  validateArchiveTarget,
  validateDeleteRequest,
  validateDuplicatePair,
  validateExecuteDelete,
  type ApprovalForExecution,
} from "../../supabase/functions/_shared/record-lifecycle";

function approval(over: Partial<ApprovalForExecution>): ApprovalForExecution {
  return {
    status: "approved",
    requested_action: "delete_record",
    execution_status: "not_run",
    // "activities" is in the final conservative hard-delete allowlist —
    // unlike "leads" (archive-only as of the Sprint 8 review), this default
    // keeps unrelated assertions (status, requested_action, ...) isolated
    // from the entity-type checks tested separately below.
    linked_record_type: "activities",
    linked_record_id: "activity-1",
    ...over,
  };
}

test("opportunities is excluded from every hard-delete table list", () => {
  expect((DELETABLE_TABLES as readonly string[]).includes("opportunities")).toBe(false);
  expect(isDeletableEntityType("opportunities")).toBe(false);
});

test("opportunities IS eligible for duplicate flagging (unrelated to hard delete)", () => {
  expect((DUPLICATE_ALLOWED_TABLES as readonly string[]).includes("opportunities")).toBe(true);
  expect(isDuplicateAllowedEntityType("opportunities")).toBe(true);
});

test("archivable tables are exactly leads/contacts/companies/rfqs/tenders", () => {
  expect([...ARCHIVABLE_TABLES].sort()).toEqual(["companies", "contacts", "leads", "rfqs", "tenders"]);
  for (const t of ARCHIVABLE_TABLES) expect(isArchivableEntityType(t), t).toBe(true);
  expect(isArchivableEntityType("opportunities")).toBe(false);
  expect(isArchivableEntityType("activities")).toBe(false);
});

test("hard-delete allowlist is the conservative Sprint 8 review list, exactly", () => {
  expect([...DELETABLE_TABLES].sort()).toEqual(["activities", "boqs", "follow_ups", "import_batches", "inbox_items"]);
});

test("archive-only tables (formerly hard-deletable) are all excluded from the delete allowlist", () => {
  expect([...ARCHIVE_ONLY_TABLES].sort()).toEqual(
    ["companies", "contacts", "leads", "opportunities", "projects", "quotations", "rfqs", "tenders"],
  );
  for (const t of ARCHIVE_ONLY_TABLES) {
    expect(isDeletableEntityType(t), t).toBe(false);
  }
});

test("only the final allowlist is accepted as deletable — nothing else, in either direction", () => {
  const allTables = [...DELETABLE_TABLES, ...ARCHIVE_ONLY_TABLES];
  for (const t of allTables) {
    expect(isDeletableEntityType(t), t).toBe(DELETABLE_TABLES.includes(t as never));
  }
});

// ---- validateDeleteRequest (request_delete guard) --------------------------

test("validateDeleteRequest rejects opportunities with a specific, actionable reason", () => {
  const r = validateDeleteRequest("opportunities", "opp-1");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/archive/i);
});

test("validateDeleteRequest rejects unknown entity types", () => {
  const r = validateDeleteRequest("not_a_real_table", "id-1");
  expect(r.ok).toBe(false);
});

test("validateDeleteRequest rejects a missing entityId", () => {
  const r = validateDeleteRequest("leads", "");
  expect(r.ok).toBe(false);
});

test("validateDeleteRequest accepts every deletable table with a real id", () => {
  for (const t of DELETABLE_TABLES) {
    expect(validateDeleteRequest(t, "some-id").ok, t).toBe(true);
  }
});

test("validateDeleteRequest rejects every archive-only table (leads/contacts/companies/rfqs/tenders/quotations/projects/opportunities)", () => {
  for (const t of ARCHIVE_ONLY_TABLES) {
    expect(validateDeleteRequest(t, "some-id").ok, t).toBe(false);
  }
});

// ---- validateExecuteDelete (execute_delete guard) --------------------------

test("validateExecuteDelete requires status === 'approved'", () => {
  expect(validateExecuteDelete(approval({ status: "pending" })).ok).toBe(false);
  expect(validateExecuteDelete(approval({ status: "approved" })).ok).toBe(true);
});

test("validateExecuteDelete requires requested_action === 'delete_record'", () => {
  expect(validateExecuteDelete(approval({ requested_action: "assign_owner" })).ok).toBe(false);
  expect(validateExecuteDelete(approval({ requested_action: null })).ok).toBe(false);
});

test("validateExecuteDelete rejects an already-executed approval", () => {
  expect(validateExecuteDelete(approval({ execution_status: "executed" })).ok).toBe(false);
});

test("validateExecuteDelete rejects an approval targeting opportunities, even if otherwise well-formed (old/malformed data)", () => {
  const r = validateExecuteDelete(
    approval({ linked_record_type: "opportunities", linked_record_id: "opp-1" }),
  );
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/archive/i);
});

test("validateExecuteDelete rejects a missing or unknown linked record", () => {
  expect(validateExecuteDelete(approval({ linked_record_type: null, linked_record_id: null })).ok).toBe(false);
  expect(validateExecuteDelete(approval({ linked_record_type: "not_a_table" })).ok).toBe(false);
  expect(validateExecuteDelete(approval({ linked_record_id: "" })).ok).toBe(false);
});

test("validateExecuteDelete accepts a fully valid, approved, not-yet-executed delete_record approval", () => {
  expect(validateExecuteDelete(approval({})).ok).toBe(true);
});

test("validateExecuteDelete rejects every archive-only table, even with an otherwise well-formed approved approval", () => {
  for (const t of ARCHIVE_ONLY_TABLES) {
    const r = validateExecuteDelete(approval({ linked_record_type: t, linked_record_id: "x" }));
    expect(r.ok, t).toBe(false);
  }
});

test("validateExecuteDelete accepts every table in the final hard-delete allowlist", () => {
  for (const t of DELETABLE_TABLES) {
    const r = validateExecuteDelete(approval({ linked_record_type: t, linked_record_id: "x" }));
    expect(r.ok, t).toBe(true);
  }
});

// ---- isActiveDeleteRequestStatus (duplicate active-request guard) ---------

test("isActiveDeleteRequestStatus treats pending and approved-but-not-executed as active", () => {
  expect(isActiveDeleteRequestStatus("pending", "not_run")).toBe(true);
  expect(isActiveDeleteRequestStatus("approved", "not_run")).toBe(true);
  // 'skipped' is the normal post-approval state for a delete_record approval
  // (delete_record is excluded from the Approval Execution Engine's
  // auto-execute allowlist) — still counts as active.
  expect(isActiveDeleteRequestStatus("approved", "skipped")).toBe(true);
});

test("isActiveDeleteRequestStatus clears once execution_status is 'executed' — the ONLY state that clears it", () => {
  expect(isActiveDeleteRequestStatus("approved", "executed")).toBe(false);
  for (const es of ["not_run", "skipped", "failed", null]) {
    expect(isActiveDeleteRequestStatus("approved", es), String(es)).toBe(true);
  }
});

test("isActiveDeleteRequestStatus treats a NULL execution_status as active (matches the DB index's IS DISTINCT FROM 'executed', not a NULL-unsafe <>)", () => {
  expect(isActiveDeleteRequestStatus("pending", null)).toBe(true);
  expect(isActiveDeleteRequestStatus("approved", null)).toBe(true);
});

test("isActiveDeleteRequestStatus treats returned/escalated as inactive (not blocking a fresh request)", () => {
  expect(isActiveDeleteRequestStatus("returned", "not_run")).toBe(false);
  expect(isActiveDeleteRequestStatus("escalated", "not_run")).toBe(false);
});

// ---- validateDuplicatePair (flag_duplicate guard) --------------------------

test("validateDuplicatePair restricts entityType to the explicit allowlist", () => {
  expect(validateDuplicatePair("boqs", "a", "b").ok).toBe(false);
  expect(validateDuplicatePair("activities", "a", "b").ok).toBe(false);
  for (const t of DUPLICATE_ALLOWED_TABLES) {
    expect(validateDuplicatePair(t, "a", "b").ok, t).toBe(true);
  }
});

test("validateDuplicatePair rejects a record being flagged as a duplicate of itself", () => {
  const r = validateDuplicatePair("leads", "same-id", "same-id");
  expect(r.ok).toBe(false);
});

test("validateDuplicatePair rejects missing ids", () => {
  expect(validateDuplicatePair("leads", "", "b").ok).toBe(false);
  expect(validateDuplicatePair("leads", "a", "").ok).toBe(false);
});

// ---- validateArchiveTarget (archive_record / unarchive_record guard) -------

test("validateArchiveTarget only allows the five archivable tables", () => {
  for (const t of ARCHIVABLE_TABLES) expect(validateArchiveTarget(t, "id-1").ok, t).toBe(true);
  expect(validateArchiveTarget("opportunities", "id-1").ok).toBe(false);
  expect(validateArchiveTarget("follow_ups", "id-1").ok).toBe(false);
});

test("validateArchiveTarget rejects a missing entityId", () => {
  expect(validateArchiveTarget("leads", "").ok).toBe(false);
});
