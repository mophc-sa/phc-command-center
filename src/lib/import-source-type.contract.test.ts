// =============================================================================
// `import_batches.source_type` means how the data ARRIVED, not what it is about.
//
// A real upload failed with `import_batches_source_type_check` because the AI
// workbook classifier's answer — "client_relations", "protenders_leads",
// "quotation_masterlist", "unknown" — was written into that column, which the
// database constrains to file / api / manual. Every AI-classified import died
// at that update.
//
// The type was the reason it slipped through: updateBatch declared
// `source_type: string` while every neighbouring field used
// Pick<ImportBatch, …>. A bare string cannot fail a compile.
//
// These pin the two halves of the fix — the narrow type, and the classifier's
// answer going somewhere that fits it.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const actions = read("src/lib/import-actions.ts");
const page = read("src/routes/_authenticated/data-import.index.tsx");

/** Source with comment lines stripped — the prose here names the bad values. */
const code = (s: string) =>
  s.split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

describe("source_type is typed as narrowly as the database constrains it", () => {
  it("declares exactly the three values the CHECK allows", () => {
    expect(actions).toMatch(
      /export type ImportSourceType\s*=\s*"file"\s*\|\s*"api"\s*\|\s*"manual"/,
    );
  });

  it("updateBatch no longer accepts an arbitrary string for it", () => {
    const fn = actions.match(/export async function updateBatch[\s\S]*?\n}/)?.[0] ?? "";
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).not.toMatch(/source_type:\s*string/);
    expect(fn).toContain("ImportSourceType");
  });
});

describe("the workbook's kind is not written into source_type", () => {
  it("the classifier's answer never reaches that column", () => {
    // The exact shape of the bug: source_type set from detected_source_kind.
    expect(code(page)).not.toMatch(/source_type:\s*r\.detected_source_kind/);
    expect(code(page)).not.toMatch(/source_type:[^,}\n]*detected_source_kind/);
  });

  it("the batch update sets no source_type at all", () => {
    // 'file' is already the column default and it is true — the data did
    // arrive as a file — so the correct value is the one nobody writes.
    const call = page.match(/await updateBatch\(batch\.id,\s*\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(call.length).toBeGreaterThan(0);
    expect(call).not.toContain("source_type");
  });

  it("the classification is kept rather than discarded", () => {
    // Fixing the crash by dropping the AI's answer would trade one bug for a
    // quieter one: the classification is used for routing and is worth keeping.
    const call = page.match(/await updateBatch\(batch\.id,\s*\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(call).toContain("structure_analysis");
    expect(call).toContain("detected_source_kind");
    expect(call).toContain("detected_entity_type");
  });

  it("target_entity still routes from the classification", () => {
    // The crash was in the same statement that sets the destination table; a
    // fix that lost this would break routing while looking successful.
    const call = page.match(/await updateBatch\(batch\.id,\s*\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(call).toContain("target_entity: detectedEntity");
  });
});
