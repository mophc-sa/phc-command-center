// =============================================================================
// Client data never lives in the repository. The March-2026 CRM import payloads
// (real phones and emails) were tracked until the 2026-10-07 security audit;
// this keeps them, and anything like them, out for good.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const tracked = execSync("git ls-files scripts/crm-import", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

describe("CRM import payloads are not tracked", () => {
  it("only the scripts are in git, never a data file", () => {
    const data = tracked.filter((f) => /\.(json|sql|csv|xlsx)$/i.test(f));
    expect(data).toEqual([]);
  });
});
