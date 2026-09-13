// =============================================================================
// Capturing client replies — the rules about where code lives and what it logs.
//
// The unit behaviour is in supabase/functions/_shared/mail-inbound.deno-test.ts.
// These are the properties a unit test of one function cannot see.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FN = read("supabase/functions/mail-inbound/index.ts");

describe("the webhook authenticates before it does anything", () => {
  it("checks credentials before reading the body or touching the database", () => {
    const auth = FN.indexOf("authorizeInbound(");
    expect(auth).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(FN.indexOf("req.json()"));
    expect(auth).toBeLessThan(FN.indexOf("serviceClient()"));
  });

  it("answers bad credentials with 403, which stops Postmark retrying", () => {
    // Lazy to the closing `)) {` — the check nests a call inside its arguments.
    expect(FN).toMatch(/if \(!authorizeInbound\([\s\S]*?\)\) \{\s*return text\(403/);
  });

  it("is deployed without JWT verification, because Postmark cannot send one", () => {
    // With the gateway default, every client reply would be rejected before the
    // function's own Basic-auth check ever ran.
    const toml = read("supabase/config.toml");
    expect(toml).toMatch(/\[functions\.mail-inbound\]\s*\nverify_jwt = false/);
  });

  it("is type-checked in CI with the other functions", () => {
    expect(read(".github/workflows/ci.yml")).toContain("supabase/functions/mail-inbound/index.ts");
  });
});

describe("nothing about a message is kept unless it belongs to a deal", () => {
  it("never logs the sender, subject or body", () => {
    const logs = FN.match(/console\.(log|error)\([^;]*\);/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect([line, /\br\.(from|subject|body|to)\b|payload|record\b/.test(line)]).toEqual([line, false]);
    }
  });

  it("drops a message that matches no thread without writing", () => {
    const unknown = FN.indexOf("if (!thread)");
    const insert = FN.indexOf('.from("activities").insert(');
    expect(unknown).toBeGreaterThan(-1);
    expect(unknown).toBeLessThan(insert);
    expect(FN.slice(unknown, insert)).toContain('return text(200, "ignored")');
  });

  it("binds a reply only through the hashed id, never by sender or subject", () => {
    expect(FN).toContain('.eq("token_hash", await hashThreadToken(r.replyId))');
    expect(FN).not.toMatch(/\.eq\(\s*"(email_from|summary|from)"/);
  });

  it("records a retried delivery once", () => {
    expect(FN).toMatch(/code === "23505"\) return text\(200, "duplicate"\)/);
  });
});

describe("an inbound reply is contact, in both places that decide it", () => {
  it("records received mail as its own activity type", () => {
    expect(FN).toContain('activity_type: "email_received"');
    expect(read("supabase/migrations/20260930110000_activity_type_email_received.sql"))
      .toContain("ADD VALUE IF NOT EXISTS 'email_received'");
  });

  it("adds the enum value in its own migration, before the function that uses it", () => {
    // Postgres will not use an enum value in the transaction that adds it.
    expect("20260930110000" < "20260930120000").toBe(true);
    const fnFile = read("supabase/migrations/20260930120000_inbound_reply_counts_as_contact.sql");
    expect(fnFile).not.toContain("ADD VALUE");
  });

  it("keeps the visibility guard the function exists to enforce", () => {
    const fnFile = read("supabase/migrations/20260930120000_inbound_reply_counts_as_contact.sql");
    expect(fnFile).toContain("SECURITY DEFINER");
    expect(fnFile).toContain("public.can_read_opportunity_record(_opportunity_id, (SELECT auth.uid()))");
    expect(fnFile).toContain("REVOKE EXECUTE ON FUNCTION public.last_verified_client_contact(UUID) FROM PUBLIC, anon;");
  });
});
