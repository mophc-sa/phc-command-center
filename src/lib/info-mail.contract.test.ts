// =============================================================================
// The info@ mailbox — where its code lives and what it never does.
// Unit behaviour: supabase/functions/_shared/info-mail.deno-test.ts,
// ai-info-mail.deno-test.ts; database: supabase/tests/info_mailbox.test.sql.
// =============================================================================
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PASS = read("supabase/functions/outlook-sync/info-pass.ts");
const SYNC = read("supabase/functions/outlook-sync/index.ts");

describe("the info@ pass", () => {
  it("runs only behind the cron key, before anything else", () => {
    const keyCheck = SYNC.indexOf("outlook_sync_key_matches");
    const dispatch = SYNC.indexOf("syncInfoMailbox(");
    expect(keyCheck).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(keyCheck);
  });

  it("is off until INFO_MAILBOX is set", () => {
    expect(SYNC).toContain('Deno.env.get("INFO_MAILBOX")');
  });

  it("classifies through the orchestrator, never a provider", () => {
    expect(PASS).toContain("/functions/v1/ai-orchestrator");
    expect(PASS).toContain('"x-phc-service-key"');
    expect(PASS).not.toMatch(/generateStructured|OPENAI_API_KEY|ANTHROPIC_API_KEY|api\.openai\.com|api\.anthropic\.com/);
  });

  it("never forwards or sends from the pass", () => {
    expect(PASS).not.toMatch(/forwardMailboxMessage|sendAsMe|sendMail/);
  });

  it("logs counts, never addresses, subjects or bodies", () => {
    for (const line of PASS.split("\n").filter((l) => l.includes("log("))) {
      expect(line).not.toMatch(/fromEmail|subject|body|from_email/);
    }
  });
});

describe("routing info@ mail", () => {
  const H = read("supabase/functions/sales-os-api/handlers/info-mail.ts");
  const A = read("src/lib/info-mail-actions.ts");

  it("checks the router role as the caller before touching Graph", () => {
    const gate = H.slice(H.indexOf("async function routerGate"), H.indexOf("function mailbox"));
    expect(gate).toContain('ctx.asCaller.rpc("is_pipeline_operator"');
    for (const fn of ["info_mail_forward", "info_mail_mark_rfq"]) {
      const body = H.slice(H.indexOf(`async function ${fn}`));
      const role = body.indexOf("routerGate(ctx)");
      const graph = body.indexOf("appAccess(");
      expect(role).toBeGreaterThan(-1);
      expect(graph).toBeGreaterThan(role);
    }
  });

  it("forwards only to an active colleague on the company domain", () => {
    expect(H).toMatch(/status !== "active"/);
    expect(H).toMatch(/@phc-sa\.com/);
  });

  it("the browser never calls Graph and never sees the cron key", () => {
    expect(A).not.toMatch(/graph\.microsoft\.com|x-phc-sync-key|outlook_sync_key/);
    expect(A).toContain('callBackend("info_mail_forward"');
    expect(A).toContain('supabase.rpc("info_mail_dismiss"');
  });
});
