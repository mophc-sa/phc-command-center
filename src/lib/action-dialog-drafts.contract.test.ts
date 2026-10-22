// =============================================================================
// Every ActionDialog keeps a draft (manager feedback 2026-10-19), and a draft
// must never land on the wrong record.
//
// A dialog opened for one row of a list (`open={!!rejectFor}`) has the same
// page path, title and fields for every row. Without `recordId` the reason
// half-typed for one lead is offered when rejecting the next. See
// autoDraftId in form-draft.ts.
// =============================================================================

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

// Per-row dialogs that need no record id, and why.
const EXEMPT = new Set([
  // No fields: a confirmation has nothing to keep.
  "src/routes/_authenticated/approvals.tsx:executeFor",
  "src/routes/_authenticated/admin-settings.tsx:suspendTarget",
  "src/routes/_authenticated/admin-settings.tsx:deleteTarget",
  "src/routes/_authenticated/agent-activity.tsx:rejectFor",
  // Creates a new company from the name typed elsewhere; not about a row.
  "src/routes/_authenticated/lead-tender-inbox.tsx:creatingCompanyFor",
  "src/routes/_authenticated/contacts.tsx:creatingCompanyFor",
]);

describe("drafts never land on the wrong record", () => {
  test("a dialog opened for one row says which row", () => {
    const missing: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<ActionDialog\b/g)) {
        const head = src.slice(m.index!, m.index! + 300);
        const row = head.match(/open=\{!!(\w+)\}/)?.[1];
        if (!row || head.includes("recordId=")) continue;
        const id = `${f}:${row}`;
        if (!EXEMPT.has(id)) missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });

  test("ActionDialog drafts by default and can be told not to", () => {
    const src = readFileSync("src/components/phc/ActionDialog.tsx", "utf8");
    expect(src).toContain("draftId?: string | false;");
    expect(src).toMatch(/draftId === false\s*\? null\s*: draftId \?\? autoDraftId\(/);
  });
});
