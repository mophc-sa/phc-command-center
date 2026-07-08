// AI Evidence Panel view-model. Run with `bun test src`.
import { test, expect } from "bun:test";
import { buildEvidencePanel, type AiRecommendation, type AiEvidenceItem } from "./ai-actions";

const rec: AiRecommendation = {
  id: "r1",
  agent_key: "lead_scoring",
  title: "Lead score 82 (hot) — Riyadh Metro",
  recommendation: "Escalate to BD.",
  rationale: "Reason codes: strong_signage_fit, value_above_threshold",
  confidence: 82,
  severity: "high",
  status: "pending",
  entity_type: "lead",
  entity_id: "l1",
  suggested_action: "qualify_lead",
  required_approval_type: null,
  missing_data: ["contact_plan"],
  generated_by: "phc-agents",
  created_at: "2026-07-08T10:00:00Z",
};

const evidence: AiEvidenceItem[] = [
  { id: "e1", recommendation_id: "r1", label: "Signage potential", field: "signage_potential", value: "high", source_type: "record", source_ref: "leads:l1", source_url: null, weight: 30 },
  { id: "e2", recommendation_id: "r1", label: "Estimated value", field: "estimated_value", value: "750000", source_type: "record", source_ref: "leads:l1", source_url: null, weight: 25 },
];

test("evidence panel exposes every required element", () => {
  const p = buildEvidencePanel(rec, evidence);
  expect(p.title).toBe(rec.title);
  expect(p.confidence).toBe(82);
  expect(p.reasonCodes).toEqual(["strong_signage_fit", "value_above_threshold"]);
  expect(p.fieldsUsed).toEqual(["signage_potential", "estimated_value"]);
  expect(p.sources.length).toBe(2);
  expect(p.missingData).toEqual(["contact_plan"]);
  expect(p.generatedBy).toBe("phc-agents");
  expect(p.timestamp).toBe("2026-07-08T10:00:00Z");
  expect(p.requiresApproval).toBe(false);
});

test("a recommendation carrying an approval type is flagged as sensitive", () => {
  const p = buildEvidencePanel({ ...rec, required_approval_type: "owner_assignment" }, evidence);
  expect(p.requiresApproval).toBe(true);
});

test("fieldsUsed de-duplicates and drops empty fields", () => {
  const p = buildEvidencePanel(rec, [
    ...evidence,
    { id: "e3", recommendation_id: "r1", label: "Dup", field: "signage_potential", value: "high", source_type: "record", source_ref: null, source_url: null, weight: 1 },
    { id: "e4", recommendation_id: "r1", label: "NoField", field: null, value: "x", source_type: "computed", source_ref: null, source_url: null, weight: 1 },
  ]);
  expect(p.fieldsUsed).toEqual(["signage_potential", "estimated_value"]);
});
