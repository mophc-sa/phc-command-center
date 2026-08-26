// =============================================================================
// The Command Center's AI commentary must satisfy the orchestrator's own
// entity contract.
//
// WHAT ESCAPED, AND WHY
// ---------------------
// Package D shipped the commentary call as:
//
//   agent: "sales_report_insights", entityType: "opportunities"
//
// The authoritative registry allows that agent exactly one entity type,
// "reports". Every call in production returned 400 AI_ENTITY_NOT_ALLOWED, from
// the day it shipped until 2026-08-26 — and nothing looked broken, because the
// deterministic brief correctly fell back to "AI commentary unavailable". A
// dead feature and a provider outage are indistinguishable from the outside.
//
// Locally it was worse than invisible: CORS blocked the request before it left
// the browser, producing the SAME message from a DIFFERENT cause. Two faults,
// one symptom, and the harmless-looking one hid the real one.
//
// These tests read AGENT_ENTITY_ALLOWLIST rather than restating it, so the
// registry stays the single authority. Restating it here would just create a
// second place for the contract to drift.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_ENTITY_ALLOWLIST, isEntityAllowedForAgent } from "../../supabase/functions/_shared/ai-guardrails";
import { AGGREGATE_ENTITY_ID } from "@/lib/ai-orchestrator-actions";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const commandCenter = read("src/routes/_authenticated/command-center.tsx");

/** The entityType the Command Center actually sends with sales_report_insights. */
function commandCenterCall() {
  const at = commandCenter.indexOf('agent: "sales_report_insights"');
  expect(at).toBeGreaterThan(-1);
  const block = commandCenter.slice(at, at + 320);
  return {
    entityType: block.match(/entityType:\s*"([a-z_]+)"/)?.[1] ?? null,
    entityIdExpr: block.match(/entityId:\s*([A-Za-z_][A-Za-z0-9_.]*)/)?.[1] ?? null,
  };
}

describe("the Command Center honours the orchestrator's entity contract", () => {
  it("sends an entityType the registry actually allows", () => {
    const { entityType } = commandCenterCall();
    expect(isEntityAllowedForAgent("sales_report_insights", entityType)).toBe(true);
  });

  it("sends exactly the entityType the registry names", () => {
    // Not merely "an allowed one" — the registry lists a single value, and the
    // test should fail if a future edit widens the agent instead of fixing the
    // caller.
    const allowed = AGENT_ENTITY_ALLOWLIST.sales_report_insights;
    expect(allowed).toEqual(["reports"]);
    expect(commandCenterCall().entityType).toBe("reports");
  });

  it("would REJECT the value that shipped broken", () => {
    // The guard that would have caught this before production.
    expect(isEntityAllowedForAgent("sales_report_insights", "opportunities")).toBe(false);
    expect(commandCenter).not.toMatch(
      /agent:\s*"sales_report_insights"[\s\S]{0,200}entityType:\s*"opportunities"/,
    );
  });

  it("uses the shared aggregate sentinel, not a real record id", () => {
    // The agent summarises an org-wide view. Passing the first opportunity's id
    // implied a subject it never had, and only worked by accident of ordering.
    const { entityIdExpr } = commandCenterCall();
    expect(entityIdExpr).toBe("AGGREGATE_ENTITY_ID");
    expect(commandCenter).not.toMatch(/entityId:\s*\(data\?\.opportunities/);
  });

  it("the sentinel is a real uuid, because entity_id is uuid-typed", () => {
    // A non-uuid placeholder failed schema validation on every call once
    // before, silently. Shape is part of the contract.
    expect(AGGREGATE_ENTITY_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("both callers share one sentinel — no second copy to drift", () => {
    const reports = read("src/routes/_authenticated/reports.tsx");
    expect(reports).toContain("AGGREGATE_ENTITY_ID");
    // The literal nil uuid appears only where the constant is defined.
    const actions = read("src/lib/ai-orchestrator-actions.ts");
    expect(actions).toContain('"00000000-0000-0000-0000-000000000000"');
    expect(reports).not.toContain('"00000000-0000-0000-0000-000000000000"');
    expect(commandCenter).not.toContain('"00000000-0000-0000-0000-000000000000"');
  });

  it("every runAiAgent call site in the app satisfies the registry", () => {
    // Not just this one. The same class of defect anywhere else fails here.
    for (const f of [
      "src/routes/_authenticated/command-center.tsx",
      "src/routes/_authenticated/reports.tsx",
      "src/routes/_authenticated/agent-activity.tsx",
      "src/routes/_authenticated/opportunities.$id.tsx",
      "src/components/phc/ProjectKanban.tsx",
      "src/components/phc/ProjectBudget.tsx",
    ]) {
      const src = read(f);
      const calls = [...src.matchAll(/agent:\s*"([a-z_]+)"[\s\S]{0,200}?entityType:\s*"([a-z_]+)"/g)];
      for (const [, agent, entityType] of calls) {
        expect([f, agent, entityType, isEntityAllowedForAgent(agent as never, entityType)])
          .toEqual([f, agent, entityType, true]);
      }
    }
  });
});

describe("commentary cannot touch a deterministic fact", () => {
  it("the brief is built before commentary is consulted", () => {
    // deterministicBrief is computed from the engines; commentary is appended
    // to it. If the order ever inverts, the AI is upstream of the numbers.
    const detAt = commandCenter.indexOf("const deterministicBrief");
    const comAt = commandCenter.indexOf("const commentary = useQuery");
    expect(detAt).toBeGreaterThan(-1);
    expect(comAt).toBeGreaterThan(detAt);
  });

  it("a failed or absent commentary returns the deterministic brief untouched", () => {
    expect(commandCenter).toMatch(/if \(!c \|\| !c\.ok\) return deterministicBrief;/);
  });

  it("commentary contributes only inferences and recommendations", () => {
    // withAiCommentary takes exactly those two channels. Nothing in the call
    // supplies a metric, a total, a probability or a target.
    const at = commandCenter.indexOf("withAiCommentary(deterministicBrief");
    const block = commandCenter.slice(at, at + 260);
    const keys = [...block.matchAll(/^\s*([a-zA-Z]+),$/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(["inferences", "recommendations"]);
    for (const forbidden of ["pipeline", "forecast", "target", "probability", "weighted"]) {
      expect([forbidden, block.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("the commentary query writes nothing — it only reads", () => {
    const at = commandCenter.indexOf("const commentary = useQuery");
    const block = commandCenter.slice(at, at + 500);
    for (const w of [".insert(", ".update(", ".delete(", ".upsert("]) {
      expect([w, block.includes(w)]).toEqual([w, false]);
    }
  });

  it("forbidden actions are filtered before a recommendation can render", () => {
    expect(commandCenter).toContain("filterRecommendations");
  });

  it("no chain-of-thought is read or rendered", () => {
    for (const k of ["reasoning", "chain_of_thought", "chainOfThought", "thinking"]) {
      expect([k, commandCenter.includes(k)]).toEqual([k, false]);
    }
  });
});
