// Contract test for the 2026-07-28 fix: admin-settings' team list hid
// suspended/deleted accounts entirely, making the already-working
// Activate button unreachable (found via a real support case — an admin
// suspended an account and then had no way to reactivate it). Static
// source inspection. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
function src(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

const teamActionsSrc = src("src/lib/team-actions.ts");
const adminSettingsSrc = src("src/routes/_authenticated/admin-settings.tsx");

test("listTeam() no longer hard-filters to status = active — only pending_approval is excluded (it has its own panel)", () => {
  const fnStart = teamActionsSrc.indexOf("export async function listTeam()");
  const fnEnd = teamActionsSrc.indexOf("export async function listPendingUsers", fnStart);
  const body = teamActionsSrc.slice(fnStart, fnEnd);
  expect(body).not.toMatch(/\.eq\("status", "active"\)/);
  expect(body).toMatch(/\.neq\("status", "pending_approval"\)/);
});

test("role-toggle checkboxes are disabled for a deleted account (terminal state, no reactivate path)", () => {
  const fnStart = adminSettingsSrc.indexOf('const guardSelf = isSelf && has && isSystemAdmin(role);');
  const fnEnd = adminSettingsSrc.indexOf("return (", fnStart);
  const body = adminSettingsSrc.slice(fnStart, fnEnd);
  expect(body).toMatch(/m\.status === "deleted"/);
});
