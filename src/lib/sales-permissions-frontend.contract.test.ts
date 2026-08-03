// Contract tests for the frontend half of the 2026-07-27 sales permissions
// batch: command-center's route guard and admin-settings' Suspend/Delete
// confirm dialogs. Static source inspection. Run with `bun test src`.
//
// The RFQ form field gating tests that used to live here (RfqJihPanel's
// standalone "New RFQ" dialog, and the global NewEntryDialog quick-create)
// were removed alongside those dialogs themselves — system-redesign request
// (2026-08-01): every record now originates from the single Intake capture
// point instead of scattered per-page "New X" dialogs.
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

describe("single-intake consolidation (2026-08-01)", () => {
  test("RfqJihPanel no longer has its own standalone New RFQ dialog", () => {
    const rfqPanelSrc = src("src/components/phc/pipeline/RfqJihPanel.tsx");
    expect(rfqPanelSrc).not.toMatch(/wf_new_rfq/);
    expect(rfqPanelSrc).not.toMatch(/canEditRfqNumber|canEditTotalValue/);
  });

  test("the global NewEntryDialog quick-create component was removed", () => {
    expect(() => src("src/components/phc/NewEntryDialog.tsx")).toThrow();
  });

  test("AppShell's Quick Actions 'New Entry' item navigates to Intake instead of opening a dialog", () => {
    const appShellSrc = src("src/components/phc/AppShell.tsx");
    expect(appShellSrc).not.toMatch(/NewEntryDialog/);
    expect(appShellSrc).toMatch(/nav_\(\{ to: "\/lead-tender-inbox" \}\)/);
  });

  test("Projects, Tenders, and Quotations panels no longer have their own standalone create dialogs", () => {
    const projectsSrc = src("src/routes/_authenticated/projects.index.tsx");
    const tendersSrc = src("src/routes/_authenticated/tenders.tsx");
    const quotationsPanelSrc = src("src/components/phc/pipeline/QuotationsPanel.tsx");
    expect(projectsSrc).not.toMatch(/crm_new_project/);
    expect(tendersSrc).not.toMatch(/wf_new_tender/);
    expect(quotationsPanelSrc).not.toMatch(/action_new_quotation/);
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
