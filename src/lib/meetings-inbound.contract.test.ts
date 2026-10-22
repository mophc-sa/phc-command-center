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

  it("fetching from Fireflies: the company key for reviewers, your own key once connected, stored only through ingest_meeting", () => {
    const h = read("supabase/functions/sales-os-api/handlers/meetings-sync.ts");
    const body = h.slice(h.indexOf("async function meetings_sync"));
    const gate = body.indexOf('ctx.asCaller.rpc("can_review_meetings"');
    expect(gate).toBeGreaterThan(-1);
    // The company key is read only for a reviewer, and nothing is pulled before the refusal.
    expect(body).toContain('const companyKey = reviewer ? Deno.env.get("FIREFLIES_API_KEY") : undefined;');
    expect(body.indexOf("if (!reviewer && !own) return err(")).toBeLessThan(body.indexOf("pullAccount("));
    // Your own key is looked up by your own id, never one from the payload.
    expect(body).toContain('ctx.svc.rpc("fireflies_api_key", { _user: ctx.caller.userId })');
    expect(h).not.toMatch(/\.from\("(meetings|meeting_action_items|tasks)"\)/);
    const pull = read("supabase/functions/_shared/fireflies-pull.ts");
    expect(pull).toContain('store.rpc("ingest_meeting"');
    expect(pull).not.toMatch(/\.from\(/);
    // The button is shown to reviewers and to people who connected their own account.
    expect(read("src/routes/_authenticated/meetings.index.tsx")).toMatch(/reviewer \|\| connected \?[\s\S]{0,200}fetchFromFireflies/);
  });

  it("decisions go through sales-os-api as the caller, not the service role", () => {
    const h = read("supabase/functions/sales-os-api/handlers/meetings.ts");
    expect(h).toContain('ctx.asCaller.rpc("decide_meeting_action_item"');
    expect(h).not.toContain("ctx.svc");
  });
});

describe("each salesperson's own Fireflies key (phase 1, 20261028100000)", () => {
  const PHASE1 = read("supabase/migrations/20261028100000_meetings_phase1.sql");

  it("the scheduled pull checks the Vault key before it reads anything", () => {
    const fn = FN.slice(FN.indexOf("export async function handleScheduledPull"));
    const check = fn.indexOf('svc.rpc("meetings_sync_key_matches"');
    expect(check).toBeGreaterThan(-1);
    expect(fn).toMatch(/if \(ok !== true\) return text\(403/);
    expect(check).toBeLessThan(fn.indexOf("runScheduledPull("));
    expect(check).toBeLessThan(fn.indexOf('"fireflies_api_key"'));
    // The webhook path hands over before reading its own secrets.
    expect(FN.indexOf('req.headers.has("x-phc-meetings-sync-key")')).toBeLessThan(FN.indexOf('env("FIREFLIES_WEBHOOK_SECRET")'));
  });

  it("the key lives in Vault, behind service-role functions, and the job reads its secret at run time", () => {
    expect(PHASE1).toContain("REVOKE ALL ON public.fireflies_connections FROM PUBLIC, anon, authenticated;");
    expect(PHASE1).toContain("vault.create_secret(btrim(_api_key)");
    for (const f of ["save_fireflies_connection(uuid,text,text)", "fireflies_api_key(uuid)", "delete_fireflies_connection(uuid)", "meetings_sync_key_matches(text)"]) {
      expect(PHASE1).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f.replace(/[()]/g, "\\$&")} FROM PUBLIC, anon, authenticated;`));
    }
    expect(PHASE1).toContain("(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meetings_sync_key')");
    expect(PHASE1).not.toMatch(/'x-phc-meetings-sync-key',\s*'[0-9a-f]{16,}/);
  });

  it("connecting saves a key only for the caller's own Fireflies account, and never returns it", () => {
    const h = read("supabase/functions/sales-os-api/handlers/fireflies.ts");
    expect(h.indexOf("sameAccount(")).toBeGreaterThan(-1);
    expect(h.indexOf("sameAccount(")).toBeLessThan(h.indexOf('"save_fireflies_connection"'));
    expect(h).toContain("_user: ctx.caller.userId");
    for (const call of h.match(/json\([^;]*\);/g) ?? []) expect(call).not.toMatch(/apiKey/);
    // The browser reads its connection without the key.
    expect(PHASE1).toMatch(/my_fireflies_connection\(\)[\s\S]{0,400}jsonb_build_object\('email', fireflies_email, 'status', status/);
  });

  it("someone in the meeting decides through the same database gate as a manager", () => {
    expect(PHASE1).toMatch(/IF NOT FOUND OR NOT public\.can_decide_meeting_item\(_id, u\) THEN/);
    expect(read("supabase/functions/sales-os-api/handlers/meetings.ts")).toContain('ctx.asCaller.rpc("confirm_meeting_opportunity"');
  });
});
