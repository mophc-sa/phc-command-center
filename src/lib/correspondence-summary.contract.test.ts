// =============================================================================
// The correspondence summary — advice that cites its sources, runs only when
// asked, and is read by the deal's people.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PANEL = read("src/components/phc/DealCorrespondencePanel.tsx");
const PROMPTS = read("supabase/functions/_shared/ai-prompts.ts");
const SQL = read("supabase/migrations/20261004100000_correspondence_summary_readers.sql");

describe("the summary runs only when someone asks", () => {
  it("the panel calls the orchestrator from a click, never from an effect", () => {
    expect(PANEL).toContain("runAiAgent({ agent: AGENT");
    expect(PANEL).not.toMatch(/useEffect\([^)]*runAiAgent/);
    expect(PANEL).toContain("onClick={run}");
  });

  it("goes through the single orchestrator, with no new Edge Function", () => {
    expect(read("supabase/config.toml")).not.toContain("deal-correspondence");
  });
});

describe("the output can be checked against its sources", () => {
  it("every point carries source ids, and the prompt forbids first-person quotes", () => {
    expect(read("supabase/functions/_shared/ai-schemas.ts")).toMatch(/source_ids: z\.array\(z\.string\(\)\.uuid\(\)\)\.min\(1\)/);
    expect(PROMPTS).toContain("never quote a first-person");
  });

  it("the panel only links sources that are emails on this deal", () => {
    expect(PANEL).toContain("ids.filter((id) => byId.has(id))");
  });

  it("says when newer email has arrived since the summary", () => {
    expect(PANEL).toContain("Date.parse(e.created_at) > Date.parse(output.created_at)");
  });
});

describe("who reads it", () => {
  it("the deal's readers, for this agent only", () => {
    expect(SQL).toContain("agent_key = 'deal_correspondence_summary'");
    expect(SQL).toContain("public.can_read_boq(entity_id, (SELECT auth.uid()))");
    expect(SQL).toMatch(/FOR SELECT TO authenticated/);
  });

  it("running it checks the deal with can_read_boq", () => {
    expect(read("supabase/functions/_shared/ai-agent-registry.ts")).toContain('svc.rpc("can_read_boq", { _opportunity_id: entityId, _user_id: userId })');
  });
});
