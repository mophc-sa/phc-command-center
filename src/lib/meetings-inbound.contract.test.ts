// =============================================================================
// Fireflies meetings — the rules about where code lives, what it logs, and who
// may write. Unit behaviour is in supabase/functions/_shared/fireflies.deno-test.ts;
// database behaviour in supabase/tests/fireflies_meetings.test.sql.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FN = read("supabase/functions/meetings-inbound/index.ts");
const SQL = read("supabase/migrations/20261001100000_fireflies_meetings.sql");

describe("the webhook authenticates before it does anything", () => {
  it("verifies the signature before parsing, calling Fireflies, or touching the database", () => {
    const check = FN.indexOf("verifySignature(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(FN.indexOf("JSON.parse(raw)"));
    expect(check).toBeLessThan(FN.indexOf("await fetch("));
    expect(check).toBeLessThan(FN.indexOf("serviceClient()"));
  });

  it("answers a bad signature with 403", () => {
    expect(FN).toMatch(/if \(!\(await verifySignature\([\s\S]*?\)\)\) \{[\s\S]*?return text\(403/);
  });

  it("is deployed without JWT verification and type-checked in CI", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.meetings-inbound\]\s*\nverify_jwt = false/);
    expect(read(".github/workflows/ci.yml")).toContain("supabase/functions/meetings-inbound/index.ts");
  });

  it("never logs meeting content", () => {
    const logs = FN.match(/console\.(log|error)\([^;]*\);/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line).not.toMatch(/title|summary|transcript\b|meeting\b|items\)/);
  });

  it("stores only through ingest_meeting, never by writing tables directly", () => {
    expect(FN).toContain('svc.rpc("ingest_meeting"');
    expect(FN).not.toMatch(/\.from\("(meetings|meeting_action_items|tasks)"\)/);
  });
});

describe("the database is the gate", () => {
  it("lets browsers read meetings but never write them", () => {
    expect(SQL).toContain("REVOKE ALL ON public.meetings, public.meeting_action_items FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT SELECT ON public.meetings, public.meeting_action_items TO authenticated;");
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY;[\s\S]*ENABLE ROW LEVEL SECURITY;/);
  });

  it("keeps ingest for the service role only", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.ingest_meeting(jsonb, jsonb) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.ingest_meeting(jsonb, jsonb) TO service_role;");
  });

  it("creates the task with a provenance key and requires a named owner", () => {
    expect(SQL).toContain("'meeting_action:'||it.id");
    expect(SQL).toMatch(/_owner_id IS NULL OR NOT EXISTS/);
  });

  it("decisions go through sales-os-api as the caller, not the service role", () => {
    const h = read("supabase/functions/sales-os-api/handlers/meetings.ts");
    expect(h).toContain('ctx.asCaller.rpc("decide_meeting_action_item"');
    expect(h).not.toContain("ctx.svc");
  });
});
