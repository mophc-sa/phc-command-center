// Contract test for the "uploaded data must be fully processed even with no
// pre-existing column" fix (2026-07-27). Before this fix, any source column
// that didn't map to a known CRM field was either dropped outright (never
// saved as a mapping in the AI auto-import flow) or written as a literal
// "__extra::{column}" top-level key that broke the insert at commit time
// (no target table had an extra_data column to receive it, and no code
// ever unpacked the prefix). Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const edgeSrc = readFileSync(join(repoRoot, "supabase/functions/import-pipeline/index.ts"), "utf8");
const autoImportSrc = readFileSync(join(repoRoot, "src/routes/_authenticated/data-import.index.tsx"), "utf8");
const extraDataMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260727140000_extra_data_all_import_targets.sql"),
  "utf8",
);
const targetEntityMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260727150000_import_batches_target_entity_all_types.sql"),
  "utf8",
);

test("validate() prefixes extra-data mappings so the source column name survives", () => {
  const start = edgeSrc.indexOf('if (m.target_column === EXTRA_DATA_TARGET) {');
  expect(start).toBeGreaterThan(-1);
  const body = edgeSrc.slice(start, start + 200);
  expect(body).toMatch(/mapped\[`\$\{EXTRA_DATA_KEY_PREFIX\}\$\{m\.source_column\}`\]/);
});

test("commit_candidates unpacks EXTRA_DATA_KEY_PREFIX keys into a nested extra_data object instead of spreading them flat", () => {
  const start = edgeSrc.indexOf("const extraData: Record<string, unknown> = {};");
  const end = edgeSrc.indexOf("if (Object.keys(extraData).length > 0) payload.extra_data = extraData;", start);
  expect(start).toBeGreaterThan(-1);
  const body = edgeSrc.slice(start, end);
  expect(body).toMatch(/key\.startsWith\(EXTRA_DATA_KEY_PREFIX\)/);
  expect(body).toMatch(/key\.slice\(EXTRA_DATA_KEY_PREFIX\.length\)/);
});

test("every import target table gets an extra_data jsonb column (7 new + 3 pre-existing = all 10 ImportTargetEntity tables)", () => {
  for (const table of ["opportunities", "projects", "quotations", "follow_ups", "boqs", "rfqs", "tenders"]) {
    expect(extraDataMigration).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS extra_data jsonb`));
  }
});

test("import_batches_target_entity_check now allows all 10 ImportTargetEntity values", () => {
  for (const entity of ["companies", "contacts", "leads", "opportunities", "projects", "boq", "rfqs", "tenders", "follow_ups", "quotations"]) {
    expect(targetEntityMigration).toMatch(new RegExp(`'${entity}'`));
  }
});

test("auto-import flow saves AI-suggested extra-data mappings instead of filtering them out", () => {
  const filterStart = autoImportSrc.indexOf(".filter((p) => p.suggested_target");
  expect(filterStart).toBeGreaterThan(-1);
  const filterLine = autoImportSrc.slice(filterStart, filterStart + 250);
  expect(filterLine).not.toMatch(/!== EXTRA_DATA_SENTINEL/);
  expect(filterLine).toMatch(/p\.suggested_target === EXTRA_DATA_SENTINEL/);
});

test("auto-import flow has a defensive fallback covering every parsed source column, not just ones the AI proposed", () => {
  expect(autoImportSrc).toMatch(/const covered = new Set\(toSave\.map/);
  expect(autoImportSrc).toMatch(/for \(const col of sourceColumns\)/);
});

test("auto-import flow falls back to extra_data for every column when the AI mapping call fails outright", () => {
  const elseStart = autoImportSrc.indexOf("} else if (sourceColumns.length > 0) {");
  expect(elseStart).toBeGreaterThan(-1);
  const elseEnd = autoImportSrc.indexOf("}", elseStart + 40);
  const body = autoImportSrc.slice(elseStart, elseEnd);
  expect(body).toMatch(/EXTRA_DATA_SENTINEL/);
});
