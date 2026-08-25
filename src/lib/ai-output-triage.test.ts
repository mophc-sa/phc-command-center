import { describe, expect, it } from "bun:test";
import { REVIEWABLE_AGENT_KEYS } from "@/lib/ai-review-actions";

// =============================================================================
// Found by QA against production on 2026-08-25.
//
// Agent Activity showed "Pending review: 70". Only 3 of those rows had an
// Accept/Reject control, because the buttons render for REVIEWABLE_AGENT_KEYS
// and the KPI counted every row at pending_review regardless of agent. The
// other 67 came from import-pipeline agents, which the import batch screen
// consumes inline the moment they return; nothing ever advances their status.
//
// So the page reported a 70-item backlog that no one could act on and that was
// never a backlog. The KPI is split; this pins the rule it splits on.
// =============================================================================

const AWAITING = (rows: { agent_key: string; status: string }[]) =>
  rows.filter(
    (o) => o.status === "pending_review" &&
      (REVIEWABLE_AGENT_KEYS as readonly string[]).includes(o.agent_key),
  ).length;

const TRACES = (rows: { agent_key: string; status: string }[]) =>
  rows.filter(
    (o) => o.status === "pending_review" &&
      !(REVIEWABLE_AGENT_KEYS as readonly string[]).includes(o.agent_key),
  ).length;

describe("an AI output counts as awaiting a decision only if it can receive one", () => {
  // The exact production mix measured on 2026-08-25.
  const production = [
    ...Array(38).fill({ agent_key: "old_data_classifier", status: "pending_review" }),
    ...Array(14).fill({ agent_key: "workbook_classifier", status: "pending_review" }),
    ...Array(9).fill({ agent_key: "semantic_field_mapper", status: "pending_review" }),
    ...Array(4).fill({ agent_key: "import_routing_reviewer", status: "pending_review" }),
    ...Array(2).fill({ agent_key: "entity_extractor", status: "pending_review" }),
    { agent_key: "commercial_risk_assessment", status: "pending_review" },
    ...Array(2).fill({ agent_key: "opportunity_evaluation", status: "pending_review" }),
  ];

  it("reports the three that actually have buttons, not all seventy", () => {
    expect(production.length).toBe(70);
    expect(AWAITING(production)).toBe(3);
    expect(TRACES(production)).toBe(67);
  });

  it("every agent counted as awaiting review really is reviewable", () => {
    for (const key of REVIEWABLE_AGENT_KEYS) {
      expect(AWAITING([{ agent_key: key, status: "pending_review" }])).toBe(1);
    }
  });

  it("an import-pipeline agent never inflates the decision queue", () => {
    for (const key of ["old_data_classifier", "workbook_classifier", "semantic_field_mapper",
                       "import_routing_reviewer", "entity_extractor", "sheet_classifier",
                       "relationship_resolver", "change_interpreter"]) {
      expect(AWAITING([{ agent_key: key, status: "pending_review" }]), key).toBe(0);
      expect(TRACES([{ agent_key: key, status: "pending_review" }]), key).toBe(1);
    }
  });

  it("settled outputs are in neither bucket", () => {
    const settled = [
      { agent_key: "opportunity_evaluation", status: "accepted" },
      { agent_key: "old_data_classifier", status: "rejected" },
    ];
    expect(AWAITING(settled)).toBe(0);
    expect(TRACES(settled)).toBe(0);
  });
});
