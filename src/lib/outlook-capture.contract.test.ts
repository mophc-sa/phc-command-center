// =============================================================================
// Capturing Outlook email — who may call the sync, what it never logs, and
// that binding goes through the database's own rules.
// Unit behaviour: supabase/functions/_shared/mail-capture.deno-test.ts and
// graph.deno-test.ts. Database: supabase/tests/outlook_capture_access.test.sql.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SYNC = read("supabase/functions/outlook-sync/index.ts");
const SQL = read("supabase/migrations/20261003100000_outlook_capture.sql");

describe("the sync is called only by the scheduler", () => {
  it("checks the Vault key before doing anything else", () => {
    const check = SYNC.indexOf('rpc("outlook_sync_key_matches"');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(SYNC.indexOf('from("mail_connections")'));
    expect(SYNC).toMatch(/if \(ok !== true\) return text\(403/);
  });

  it("the key is generated into Vault and read by the cron job at run time, never written into the job", () => {
    expect(SQL).toContain("vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'outlook_sync_key'");
    expect(SQL).toMatch(/'x-phc-sync-key', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'outlook_sync_key'\)/);
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.outlook_sync_key_matches(text) FROM PUBLIC, anon, authenticated;");
  });

  it("is deployed without JWT verification and type-checked in CI", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.outlook-sync\]\s*\nverify_jwt = false/);
    expect(read(".github/workflows/ci.yml")).toContain("supabase/functions/outlook-sync/index.ts");
  });
});

describe("nothing about a message reaches the logs", () => {
  it("logs carry outcomes and counts only", () => {
    const logs = SYNC.match(/log\(\{[^}]*\}\)/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).not.toMatch(/subject|body|email|address|from|summary|ext\b/);
  });
});

describe("only mail about a known client is kept", () => {
  it("unmatched mail is skipped before a body is fetched or a row written", () => {
    const skip = SYNC.indexOf("if (!contactHit && !companyId) continue;");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(SYNC.indexOf("await getMessageDetail("));
    expect(skip).toBeLessThan(SYNC.indexOf('from("activities").insert('));
  });

  it("private mail and drafts are filtered, and personal/private sensitivity is checked before storing", () => {
    expect(SYNC).toContain("batch.filter((m) => shouldSkip(m) === null)");
    const sens = SYNC.indexOf('detail.sensitivity === "1" || detail.sensitivity === "2"');
    expect(sens).toBeGreaterThan(-1);
    expect(sens).toBeLessThan(SYNC.indexOf('from("activities").insert('));
  });
});

describe("linking a conversation to a deal goes through the database", () => {
  it("the action calls bind_email_conversation as the caller", () => {
    const h = read("supabase/functions/sales-os-api/handlers/outlook.ts");
    expect(h).toContain('ctx.asCaller.rpc("bind_email_conversation"');
  });

  it("the function requires the owner or a pipeline operator, and a readable deal", () => {
    expect(SQL).toMatch(/a\.owner_id = u OR public\.is_pipeline_operator\(u\)/);
    expect(SQL).toContain("public.can_read_boq(_opportunity_id, u)");
    expect(SQL).toContain("AND owner_id = a.owner_id");
  });

  it("the sync state is service-role only", () => {
    expect(SQL).toContain("REVOKE ALL ON public.mail_sync_state FROM PUBLIC, anon, authenticated;");
  });
});
