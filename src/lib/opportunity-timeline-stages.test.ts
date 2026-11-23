import { expect, test } from "bun:test";
import { buildTimeline, groupByStage } from "./opportunity-timeline";

test("emails and calls join stage moves, grouped under the stage they happened in", () => {
  const events = buildTimeline({
    transitions: [{ id: "t1", record_type: "opportunity", record_id: "o", from_stage: "rfq_received", to_stage: "jih", actor_id: null, notes: null, evidence: null, approval_id: null, created_at: "2026-11-10T10:00:00Z" } as never],
    activities: [
      { id: "a1", activity_type: "call", status: "logged", summary: "asked for BOQ", occurred_at: "2026-11-05T09:00:00Z", owner_id: null, created_by: null },
      { id: "a2", activity_type: "email_received", status: "logged", summary: "RE: price", occurred_at: "2026-11-12T09:00:00Z", owner_id: null, created_by: null },
      { id: "a3", activity_type: "email_draft", status: "draft", summary: "never sent", occurred_at: "2026-11-13T09:00:00Z", owner_id: null, created_by: null },
    ],
  });
  expect(events.some((e) => e.id === "activity:a3")).toBe(false);
  const groups = groupByStage(events);
  expect(groups.map((g) => g.stage)).toEqual(["jih", "rfq_received"]);
  expect(groups[0].events.map((e) => e.id)).toEqual(["activity:a2", events.find((e) => e.source === "stage_transition_history")!.id]);
  expect(groups[1].events.map((e) => e.id)).toEqual(["activity:a1"]);
});
