// Contract tests for the frontend half of the 2026-07-27 sales permissions
// batch: command-center's route guard, RFQ form field gating (both
// RfqJihPanel and NewEntryDialog), and admin-settings' Suspend/Delete
// confirm dialogs. Static source inspection. Run with `bun test src`.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
function src(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("command-center route guard", () => {
  const commandCenterSrc = src("src/routes/_authenticated/command-center.tsx");

  test("redirects a pure salesperson (no elevated role) to /my-workspace", () => {
    expect(commandCenterSrc).toMatch(/isSalesperson\(roles\) && !hasElevatedRole/);
    expect(commandCenterSrc).toMatch(/throw redirect\(\{ to: "\/my-workspace" \}\);/);
  });

  test("does not disturb viewer's existing landing contract (only salesperson is checked, not a broader role exclusion)", () => {
    const guardStart = commandCenterSrc.indexOf("beforeLoad: async () => {");
    const guardEnd = commandCenterSrc.indexOf("head: () =>", guardStart);
    const guardBody = commandCenterSrc.slice(guardStart, guardEnd);
    expect(guardBody).not.toMatch(/isViewer/);
  });

  test("a user holding salesperson plus a manager role is not redirected (roles are additive)", () => {
    expect(commandCenterSrc).toMatch(/canManageSalesPipeline\(roles\) \|\| isSystemAdmin\(roles\) \|\| isFinanceManager\(roles\)/);
  });
});

describe("RFQ form field gating — RfqJihPanel", () => {
  const rfqPanelSrc = src("src/components/phc/pipeline/RfqJihPanel.tsx");

  test("rfqNumber field is only rendered for canEditRfqNumber roles", () => {
    expect(rfqPanelSrc).toMatch(/\.\.\.\(canEditNumber \? \[\{ key: "rfqNumber"/);
  });

  test("estimatedValue (Total Value) field is only rendered for canEditTotalValue roles", () => {
    expect(rfqPanelSrc).toMatch(/\.\.\.\(canEditValue \? \[\{ key: "estimatedValue"/);
  });

  test("salesOwnerId (assignment) field is only rendered for canManageSalesPipeline roles", () => {
    expect(rfqPanelSrc).toMatch(/\.\.\.\(canAssignOwner \? \[\{/);
  });

  test("city, classification, classificationOther, receivedDate fields are always present", () => {
    for (const key of ["city", "classification", "classificationOther", "receivedDate"]) {
      expect(rfqPanelSrc).toContain(`key: "${key}"`);
    }
  });
});

describe("RFQ form field gating — NewEntryDialog (rfq type)", () => {
  const newEntrySrc = src("src/components/phc/NewEntryDialog.tsx");

  test("rfqFields() takes teamMembers + roles and gates the same three fields", () => {
    const fnStart = newEntrySrc.indexOf("function rfqFields(");
    const fnEnd = newEntrySrc.indexOf("\n}", fnStart);
    const body = newEntrySrc.slice(fnStart, fnEnd);
    expect(body).toMatch(/canEditNumber \? \[\{ key: "rfqNumber"/);
    expect(body).toMatch(/canEditValue \? \[\{ key: "estimatedValue"/);
    expect(body).toMatch(/canAssignOwner \? \[\{/);
  });
});

describe("admin-settings Suspend vs Delete", () => {
  const adminSrc = src("src/routes/_authenticated/admin-settings.tsx");

  test("Suspend now opens a confirm dialog instead of firing immediately", () => {
    expect(adminSrc).toMatch(/onClick=\{\(\) => setSuspendTarget\(m\)\}/);
    expect(adminSrc).not.toMatch(/onClick=\{\(\) => handleSuspend\(m\)\}/);
  });

  test("Delete is a distinct, system_admin-only action with its own confirm dialog", () => {
    expect(adminSrc).toMatch(/isSystemAdmin\(roles\) \? \(/);
    expect(adminSrc).toMatch(/onClick=\{\(\) => openDeleteConfirm\(m\)\}/);
  });

  test("a deleted account shows a static label, no action buttons", () => {
    expect(adminSrc).toMatch(/m\.status === "deleted" \? \(/);
  });

  test("delete confirm dialog surfaces the owned-active-record count as a warning, not a hard block", () => {
    expect(adminSrc).toMatch(/deleteOwnedCount != null && deleteOwnedCount > 0/);
    expect(adminSrc).toMatch(/countOwnedActiveRecords/);
  });
});
