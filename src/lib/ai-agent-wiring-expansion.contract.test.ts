// Contract tests for the 2026-07-28 AI-agent wiring expansion:
//   1. data_cleanup / contact_mapping — two agents that were fully built
//      and tested but had zero UI call sites (docs/ai-orchestrator.md,
//      "Later agents" section) — now wired into the data-import batch
//      detail page.
//   2. relationship_resolver's "Accept" action — previously a dead write
//      (it read a `source_row_id` field the AI's own output schema never
//      actually returns, so the raw_data patch never ran) that also, when
//      it did anything, stored a note instead of using the dedicated
//      import_candidate_links table. Replaced with acceptResolvedLink(),
//      which resolves refs to real batch candidates when possible and
//      falls back to a labeled note otherwise.
//   3. opportunity_evaluation — previously had zero run call sites
//      anywhere in the app (only ever appeared in REVIEWABLE_AGENT_KEYS).
//      Now has a run button on the opportunity detail page, alongside an
//      in-context Accept/Reject review bar shared with risk_finance —
//      reusing the existing sales-os-api review_ai_agent_output action,
//      not a new mechanism.
// Static source inspection. Run with `bun test src`.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
function src(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

const importActionsSrc = src("src/lib/import-actions.ts");
const dataImportPageSrc = src("src/routes/_authenticated/data-import.$batchId.tsx");
const opportunityPageSrc = src("src/routes/_authenticated/opportunities.$id.tsx");
const aiReviewActionsSrc = src("src/lib/ai-review-actions.ts");

describe("acceptResolvedLink — structural reconciliation with import_candidate_links", () => {
  const fnStart = importActionsSrc.indexOf("export async function acceptResolvedLink");
  const fnEnd = importActionsSrc.indexOf("\n}\n", fnStart);
  const body = importActionsSrc.slice(fnStart, fnEnd);

  test("only inserts into import_candidate_links when both refs resolve to a batch candidate", () => {
    expect(body).toMatch(/resolveCandidateId\(input\.fromRef\)/);
    expect(body).toMatch(/resolveCandidateId\(input\.toRef\)/);
    expect(body).toMatch(/if \(sourceCandidateId && targetCandidateId\)/);
  });

  test("normalizes 'linked_opportunity' to the constrained vocabulary's 'opportunity_of', without inventing a mapping for unmappable types", () => {
    expect(importActionsSrc).toMatch(/relationshipType === "linked_opportunity" \? "opportunity_of" : relationshipType/);
  });

  test("upserts on the same unique key as the import_candidate_links table (source_candidate_id, target_candidate_id, relationship_type)", () => {
    expect(body).toMatch(/onConflict: "source_candidate_id,target_candidate_id,relationship_type"/);
  });

  test("falls back to a labeled raw_data note — not a silent no-op — when structured storage isn't possible", () => {
    expect(body).toMatch(/__relationship_hints/);
    expect(body).toMatch(/structured: false/);
    expect(body).toMatch(/Saved as a note only/);
  });
});

describe("data-import.$batchId.tsx — relationship_resolver Accept button uses the real reconciliation path", () => {
  test("no longer reads the nonexistent link.source_row_id field", () => {
    expect(dataImportPageSrc).not.toMatch(/link\.source_row_id/);
  });

  test("Accept button calls acceptResolvedLink with the AI's actual returned refs", () => {
    const idx = dataImportPageSrc.indexOf("await acceptResolvedLink({");
    expect(idx).toBeGreaterThan(-1);
    const call = dataImportPageSrc.slice(idx, idx + 300);
    expect(call).toMatch(/fromRef: link\.from_entity_ref/);
    expect(call).toMatch(/toRef: link\.to_entity_ref/);
    expect(call).toMatch(/relationshipType: link\.relationship_type/);
  });

  test("acceptedLinkIds now tracks structured-vs-note per link, not just accepted/not", () => {
    expect(dataImportPageSrc).toMatch(/useState<Map<number, boolean>>\(new Map\(\)\)/);
  });
});

describe("data-import.$batchId.tsx — data_cleanup and contact_mapping are now wired in", () => {
  test("runs data_cleanup via a real button", () => {
    expect(dataImportPageSrc).toMatch(/await runDataCleanup\(batchId\)/);
    expect(dataImportPageSrc).toMatch(/Clean Up Data/);
  });

  test("runs contact_mapping via a real button", () => {
    expect(dataImportPageSrc).toMatch(/await runContactMapping\(batchId\)/);
    expect(dataImportPageSrc).toMatch(/Map Contacts to Companies/);
  });

  test("data_cleanup corrections have an Apply action that patches import_rows.raw_data", () => {
    const idx = dataImportPageSrc.indexOf('.from("import_rows").select("id, raw_data").eq("id", c.row_id)');
    expect(idx).toBeGreaterThan(-1);
  });

  test("data_cleanup duplicates have a per-row 'mark as duplicate' action using import_rows.status", () => {
    expect(dataImportPageSrc).toMatch(/\.from\("import_rows"\)\.update\(\{ status: "duplicate" \}\)/);
  });

  test("contact_mapping's contact_company_links reuse acceptResolvedLink with relationship_type 'contact_of'", () => {
    const idx = dataImportPageSrc.indexOf("fromRef: link.contact_row_id");
    expect(idx).toBeGreaterThan(-1);
    const call = dataImportPageSrc.slice(idx - 50, idx + 250);
    expect(call).toMatch(/relationshipType: "contact_of"/);
  });
});

describe("opportunities.$id.tsx — opportunity_evaluation now has its first-ever run button", () => {
  test("invokes the opportunity_evaluation agent", () => {
    expect(opportunityPageSrc).toMatch(/agent: "opportunity_evaluation", entityType: "opportunities", entityId: id/);
  });

  test("both risk_finance and opportunity_evaluation persist and re-fetch their ai_agent_outputs row after a run", () => {
    expect(opportunityPageSrc).toMatch(/queryKey: \["ai-output", id, "risk_finance"\]/);
    expect(opportunityPageSrc).toMatch(/queryKey: \["ai-output", id, "opportunity_evaluation"\]/);
    expect(opportunityPageSrc).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["ai-output", id, "risk_finance"\] \}\)/);
    expect(opportunityPageSrc).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["ai-output", id, "opportunity_evaluation"\] \}\)/);
  });

  test("review actions are gated by canReviewAiOutput and go through the existing reviewAgentOutput action, not a new mechanism", () => {
    expect(opportunityPageSrc).toMatch(/canReviewAiOutput\(roles\)/);
    expect(opportunityPageSrc).toMatch(/await reviewAgentOutput\(\{ outputId: output\.id, decision \}\)/);
  });

  test("both panels render the shared AiOutputReviewBar rather than duplicating review UI", () => {
    const occurrences = opportunityPageSrc.split("<AiOutputReviewBar").length - 1;
    expect(occurrences).toBe(2);
  });
});

describe("ai-review-actions.ts — getLatestAgentOutput added without disturbing the existing review mechanism", () => {
  test("REVIEWABLE_AGENT_KEYS and reviewAgentOutput (the existing sales-os-api-backed action) are untouched", () => {
    expect(aiReviewActionsSrc).toMatch(/export const REVIEWABLE_AGENT_KEYS = \[/);
    expect(aiReviewActionsSrc).toMatch(/callBackend<\{ output: AiAgentOutputRow \}>\("review_ai_agent_output"/);
  });

  test("getLatestAgentOutput is a plain scoped SELECT (RLS-gated), not a new backend action", () => {
    const fnStart = aiReviewActionsSrc.indexOf("export async function getLatestAgentOutput");
    const fnEnd = aiReviewActionsSrc.indexOf("\n}\n", fnStart);
    const body = aiReviewActionsSrc.slice(fnStart, fnEnd);
    expect(body).toMatch(/supabase\s*\n?\s*\.from\("ai_agent_outputs"\)/);
    expect(body).not.toMatch(/callBackend/);
  });
});
