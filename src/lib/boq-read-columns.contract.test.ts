// Contract test for the BOQ read-column fix (2026-11-14 review).
// 20260824100000_commercial_read_isolation revoked SELECT on the BOQ cost
// columns from `authenticated`. Any `*` select, `boq_items(*)` embed or bare
// `.select()` after an insert/update (RETURNING *) then fails with 403, which
// left the BOQ tab empty and made create/status/add-item fail for everyone.
// Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BOQ_READ_COLUMNS, BOQ_ITEM_READ_COLUMNS } from "./sales-actions";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");
const cols = (s: string) => s.split(",").map((c) => c.trim());

test("BOQ read columns leave out the revoked cost columns", () => {
  expect(cols(BOQ_READ_COLUMNS)).not.toContain("estimated_value");
  expect(cols(BOQ_ITEM_READ_COLUMNS)).not.toContain("unit_rate");
  expect(cols(BOQ_ITEM_READ_COLUMNS)).not.toContain("cost_estimate");
});

test("BOQ actions never return every column", () => {
  const src = read("src/lib/sales-actions.ts");
  const boqBlock = src.slice(src.indexOf("export async function createBoq"), src.indexOf("/* ---------------- Sales Targets"));
  expect(boqBlock).not.toMatch(/\.select\(\)/);
});

test("BOQ panel lists its columns instead of `*`", () => {
  const src = read("src/components/phc/pipeline/BoqPanel.tsx");
  expect(src).not.toMatch(/from\("boqs"\)\s*\.select\("\*/);
  expect(src).not.toContain("boq_items(*)");
});
