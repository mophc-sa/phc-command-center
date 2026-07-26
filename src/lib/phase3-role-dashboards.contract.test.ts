// Contract test for Phase 3's role-based dashboard landing — static source
// inspection verifying salespeople land on their personal dashboard
// (my-workspace, which already shows their own sales_targets row) while
// managers keep landing on command-center, now with an aggregated team
// target. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function read(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), "utf8");
}

test("isSalesperson routes to /my-workspace, checked before the viewer fallback", () => {
  const source = read("src/routes/index.tsx");
  const salespersonIdx = source.indexOf("isSalesperson(r)");
  const myWorkspaceIdx = source.indexOf('to: "/my-workspace"');
  const fallbackIdx = source.indexOf("// viewer");
  expect(salespersonIdx).toBeGreaterThan(-1);
  expect(myWorkspaceIdx).toBeGreaterThan(salespersonIdx);
  expect(fallbackIdx).toBeGreaterThan(myWorkspaceIdx);
});

test("executive/sales_mgr still land on /command-center (unchanged)", () => {
  const source = read("src/routes/index.tsx");
  expect(source).toMatch(/isExecutive\(r\) \|\| isSalesManager\(r\)[\s\S]{0,80}to: "\/command-center"/);
});

test("command-center's team-target query sums sales_targets across all users (annual, falling back to monthly)", () => {
  const source = read("src/routes/_authenticated/command-center.tsx");
  expect(source).toMatch(/queryKey: \["cc-team-target"\]/);
  expect(source).toMatch(/eq\("period_type", "annual"\)\.eq\("period_start", annYear\)/);
  expect(source).toMatch(/eq\("period_type", "monthly"\)\.eq\("period_start", monthStart\)/);
  expect(source).toMatch(/total: annualSum > 0 \? annualSum : monthlySum/);
  // Unlike my-workspace.tsx's per-user target query, this one must NOT
  // scope by a single user_id — it's an org-wide sum.
  const queryBlockStart = source.indexOf('queryKey: ["cc-team-target"]');
  const queryBlockEnd = source.indexOf("});", queryBlockStart);
  const queryBlock = source.slice(queryBlockStart, queryBlockEnd);
  expect(queryBlock).not.toMatch(/\.eq\("user_id"/);
});

test("Team Target KPI card renders in command-center's KPI row", () => {
  const source = read("src/routes/_authenticated/command-center.tsx");
  expect(source).toMatch(/label=\{lang === "ar" \? "الهدف الإجمالي للفريق" : "Team Target"\}/);
});
