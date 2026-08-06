// Regression guard for the run_automations audit-logging bug.
//
// The real behavioral tests for audit()'s error handling live in
// supabase/functions/_shared/supabase.test.ts (Deno test — this repo has no
// Deno runtime/CI wiring, so it isn't executable from `bun test`). Bun also
// cannot resolve that file's "npm:@supabase/supabase-js@2" Deno-style
// specifier, so it can't be imported here either (confirmed empirically).
// These are static source-text checks instead — narrower, but they run in
// CI today and directly guard against the two ways this bug showed up.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("run_automations no longer passes a non-UUID string literal as entity_id", () => {
  // audit_log.entity_id is a uuid column. The original bug passed a bare string
  // literal, which the database rejects. The invariant is not "always null" —
  // it is "a real UUID expression, or null". When the rules moved into SQL
  // (2026-08-06) the handler gained a genuine run_id UUID to log, and a first
  // pass at that reintroduced the bug as `runId ?? "unknown"`. This checks the
  // rule rather than one previous spelling of it.
  const src = readFileSync(
    join(here, "../../supabase/functions/sales-os-api/handlers/automation.ts"),
    "utf8",
  );
  const match = src.match(
    /auditLog\(\s*svc,\s*caller\.userId,\s*"automations\.run",\s*"[a-z_]+",\s*([^,]+),/,
  );
  expect(match, "automations.run audit() call not found").not.toBeNull();
  const entityId = match![1].trim();

  // Reject any string literal: that is the shape of the original defect.
  expect(entityId, `entity_id must not be a string literal, got ${entityId}`).not.toMatch(
    /^["'`]/,
  );
  expect(entityId).not.toMatch(/\?\?\s*["'`]/); // ...including as a `?? "fallback"`
  expect(entityId === "null" || entityId.includes("runId")).toBe(true);
});

test("audit() checks and logs the insert error instead of discarding it", () => {
  const src = readFileSync(join(here, "../../supabase/functions/_shared/supabase.ts"), "utf8");
  const fnMatch = src.match(/export async function audit\([\s\S]*?\n\}/);
  expect(fnMatch, "audit() function not found").not.toBeNull();
  const body = fnMatch![0];
  expect(body.includes("const { error }"), "audit() must capture the insert error").toBe(true);
  expect(body.includes("console.error"), "audit() must log a captured error").toBe(true);
  expect(body.includes("return { error }"), "audit() must return the error to the caller").toBe(
    true,
  );
});

test("audit() entityId parameter accepts null (nullable audit_log.entity_id)", () => {
  const src = readFileSync(join(here, "../../supabase/functions/_shared/supabase.ts"), "utf8");
  expect(src.includes("entityId: string | null")).toBe(true);
});
