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
const uiSrc = readFileSync(join(repoRoot, "src/routes/_authenticated/data-import.tsx"), "utf8");

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

// ---- SAFETY GUARDS: no live CRM writes in Phase 1.1 -------------------------
test("import-pipeline never INSERTs/UPSERTs into live CRM tables", () => {
  const liveTables = ["companies", "contacts", "opportunities", "tenders", "rfqs", "projects", "quotations", "leads"];
  for (const tbl of liveTables) {
    // Match `.from("companies") ... .insert(` / `.upsert(` on the same statement.
    const insertRe = new RegExp(`from\\(["'\`]${tbl}["'\`]\\)[\\s\\S]{0,120}?\\.(insert|upsert)\\(`, "g");
    const hits = edgeSrc.match(insertRe) ?? [];
    expect(hits, `edge writes to live table ${tbl}: ${hits.join(" | ")}`).toEqual([]);
  }
});

test("import-pipeline exposes only a dry-run commit, not a real commit", () => {
  expect(edgeSrc).toContain('handlers["dry_run_commit"]');
  expect(edgeSrc).not.toContain('handlers["commit"]');
  expect(edgeSrc).not.toContain('handlers["commit_to_crm"]');
});

test("Commit-to-CRM UI button is disabled with a 'not enabled yet' message", () => {
  expect(uiSrc).toMatch(/Controlled CRM commit is not enabled yet/i);
  // The commit button carries the `disabled` attribute (which precedes its label).
  expect(uiSrc).toMatch(/disabled[\s\S]{0,300}?Commit to CRM/);
});

// ---- Rollback: DELETE-only exception to the no-live-writes guard -----------
test("rollback handler exists and is the only exception to the no-insert/upsert guard", () => {
  expect(edgeSrc).toContain('handlers["rollback"]');
  // Still no live CREATE/UPDATE path — rollback only ever deletes what this
  // pipeline itself previously created (see the guard above, which already
  // covers insert/upsert across every live CRM table including this one's).
  expect(edgeSrc).not.toContain('handlers["commit"]');
});
