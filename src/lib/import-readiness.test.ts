// Data Import Center — Phase 1.1 readiness logic + SAFETY guards.
// Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  stagedGroupsForRow,
  deriveAutoChecklist,
  isRowProcessable,
  type ImportBatch,
} from "./import-actions";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const edgeSrc = readFileSync(join(repoRoot, "supabase/functions/import-pipeline/index.ts"), "utf8");
const uiSrc = readFileSync(join(repoRoot, "src/routes/_authenticated/data-import.$batchId.tsx"), "utf8");

function batch(over: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: "b1", created_by: "u1", status: "uploading", source_type: "file", file_name: "x.csv",
    target_entity: "companies", total_rows: 10, valid_rows: 0, error_rows: 0, duplicate_rows: 0,
    dry_run: true, ai_suggestions_enabled: false, approved_by: null, approved_at: null,
    committed_at: null, rolled_back_at: null, rolled_back_by: null, notes: null,
    archived_at: null, archived_by: null, deleted_at: null,
    deleted_by: null, delete_reason: null, created_at: "", updated_at: "",
    ...over,
  } as ImportBatch;
}

// ---- Staging grouping (Section D) -------------------------------------------
test("rows are grouped into the correct staged target areas", () => {
  expect(stagedGroupsForRow({ name: "Acme", cr_number: "1" })).toContain("companies");
  expect(stagedGroupsForRow({ contact_name: "Sara", email: "s@x.com" })).toContain("contacts");
  expect(stagedGroupsForRow({ project_name: "Metro", main_contractor: "X" })).toContain("projects");
  expect(stagedGroupsForRow({ tender_ref: "T-9", boq_value: "500" })).toContain("rfq_tender");
  expect(stagedGroupsForRow({ stage: "jih", owner: "u" })).toContain("opportunities");
  expect(stagedGroupsForRow({ random_field: "v" })).toEqual(["unmapped"]);
});

// ---- Readiness checklist (Section J) ----------------------------------------
test("auto checklist reflects batch state", () => {
  const fresh = deriveAutoChecklist(batch({ status: "uploading" }));
  expect(fresh.dry_run_generated).toBe(false);
  expect(fresh.approval_obtained).toBe(false);
  const done = deriveAutoChecklist(batch({ status: "dry_run", approved_at: "2026-07-08", valid_rows: 5 }));
  expect(done.dry_run_generated).toBe(true);
  expect(done.approval_obtained).toBe(true);
  expect(done.validation_reviewed).toBe(true);
});

// ---- Exclusion / restore (Section C) ----------------------------------------
test("excluded and soft-deleted rows are not processable; active/restored are", () => {
  expect(isRowProcessable({ is_excluded: false, row_status: "active" })).toBe(true);
  expect(isRowProcessable({ is_excluded: false, row_status: "edited" })).toBe(true);
  expect(isRowProcessable({ is_excluded: true, row_status: "excluded" })).toBe(false);
  expect(isRowProcessable({ is_excluded: false, row_status: "deleted" })).toBe(false);
});

// ---- SAFETY GUARDS: live CRM writes exist, but only through one reviewed,
// approved-candidate path (Phase 2, approved) ---------------------------------
//
// Isolates the commit_candidates handler's own source (from its declaration
// to the next top-level `handlers[...] =`) so writes can be required *inside*
// it and forbidden *everywhere else* in the same file — rather than either
// banning live writes outright (no longer true) or only checking they exist
// somewhere (too weak: would pass even if approve/validate/etc. also wrote).
function extractHandlerSource(name: string): string {
  const start = edgeSrc.indexOf(`handlers["${name}"]`);
  if (start === -1) throw new Error(`handlers["${name}"] not found in import-pipeline/index.ts`);
  const nextHandler = edgeSrc.indexOf('handlers["', start + 1);
  return edgeSrc.slice(start, nextHandler === -1 ? undefined : nextHandler);
}

const commitCandidatesSrc = extractHandlerSource("commit_candidates");
const edgeSrcOutsideCommit = edgeSrc.replace(commitCandidatesSrc, "");

test("only commit_candidates writes to live CRM tables — no other handler does", () => {
  const liveTables = ["companies", "contacts", "opportunities", "tenders", "rfqs", "projects", "quotations", "leads"];
  for (const tbl of liveTables) {
    // Match `.from("companies") ... .insert(` / `.upsert(` / `.update(` on the same statement.
    const writeRe = new RegExp(`from\\(["'\`]${tbl}["'\`]\\)[\\s\\S]{0,120}?\\.(insert|upsert|update)\\(`, "g");
    const hits = edgeSrcOutsideCommit.match(writeRe) ?? [];
    expect(hits, `a handler other than commit_candidates writes to live table ${tbl}: ${hits.join(" | ")}`).toEqual([]);
  }
  // commit_candidates resolves its target table through ENTITY_TABLE_MAP
  // (a variable), not a literal table name, so it's checked structurally
  // instead: it must actually perform a generic insert/update, and it must
  // gate on review_status = 'approved' before ever reading a candidate.
  expect(commitCandidatesSrc).toMatch(/\.from\(table\)\.insert\(/);
  expect(commitCandidatesSrc).toMatch(/\.from\(table\)\.update\(/);
  expect(commitCandidatesSrc).toMatch(/review_status.*approved/);
});

test("import-pipeline never exposes the old unreviewed bare 'commit' action", () => {
  expect(edgeSrc).toContain('handlers["dry_run_commit"]');
  expect(edgeSrc).toContain('handlers["commit_candidates"]');
  // The pre-Phase-2 bare name (a per-batch blanket commit with no review
  // step) must never come back under its old name.
  expect(edgeSrc).not.toContain('handlers["commit"]');
  expect(edgeSrc).not.toContain('handlers["commit_to_crm"]');
});

test("commit_candidates is role-gated the same as approve/dry_run_commit", () => {
  expect(commitCandidatesSrc).toMatch(/system_admin cannot commit imports/);
  expect(commitCandidatesSrc).toMatch(/Insufficient role for commit/);
});

test("Commit-to-CRM UI button is conditionally gated on having an approved candidate", () => {
  expect(uiSrc).toMatch(/approvedCandidateCount === 0/);
  expect(uiSrc).toMatch(/commitBatch\(/);
});

// ---- Rollback: DELETE-only, reverses exactly what commit_candidates wrote --
test("rollback only ever deletes — it has no insert/upsert path of its own", () => {
  expect(edgeSrc).toContain('handlers["rollback"]');
  const rollbackSrc = extractHandlerSource("rollback");
  expect(rollbackSrc).not.toMatch(/\.(insert|upsert)\(/);
});
