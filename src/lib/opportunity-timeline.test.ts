import { describe, expect, it } from "bun:test";
import {
  buildTimeline,
  dedupeEvents,
  groupByRecency,
  type ApprovalRow,
  type FollowUpRow,
  type IntakeRow,
  type OpportunityFactsRow,
  type StageTransitionRow,
} from "@/lib/opportunity-timeline";

const TODAY = "2026-08-20";

function transition(over: Partial<StageTransitionRow> = {}): StageTransitionRow {
  return {
    id: "t1",
    record_type: "opportunity",
    record_id: "o1",
    from_stage: "jih",
    to_stage: "jih_bafo",
    actor_id: "u1",
    notes: null,
    evidence: null,
    approval_id: null,
    created_at: "2026-08-10T09:00:00Z",
    ...over,
  };
}

function intake(over: Partial<IntakeRow> = {}): IntakeRow {
  return {
    id: "i1",
    project_name: "Tower",
    company_name: "Acme",
    review_state: "pending_review",
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    reject_reason: null,
    info_comment: null,
    info_requested_at: null,
    resubmitted_at: null,
    resubmit_count: null,
    converted_record_type: null,
    converted_record_id: null,
    created_by: "u2",
    created_at: "2026-08-01T08:00:00Z",
    ...over,
  };
}

function approval(over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: "a1",
    approval_type: "owner_grant",
    status: "pending",
    requested_by: "u1",
    assigned_approver: "u3",
    decision_notes: null,
    created_at: "2026-08-12T10:00:00Z",
    decided_at: null,
    ...over,
  };
}

function followUp(over: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id: "f1",
    owner_id: "u1",
    channel: "call",
    notes: "Spoke to the consultant",
    status: "completed",
    due_date: "2026-08-11",
    last_contact_at: "2026-08-11T14:00:00Z",
    created_at: "2026-08-05T00:00:00Z",
    ...over,
  };
}

function oppFacts(over: Partial<OpportunityFactsRow> = {}): OpportunityFactsRow {
  return {
    id: "o1",
    project_name: "Tower",
    created_at: "2026-08-02T00:00:00Z",
    verbal_award_date: null,
    contract_received_date: null,
    contract_signed_date: null,
    commercial_handoff_status: null,
    commercial_handoff_at: null,
    commercial_handoff_by: null,
    source_tender_id: null,
    loss_reason: null,
    lost_to_competitor: null,
    ...over,
  };
}

describe("ordering", () => {
  it("is latest-first by default", () => {
    const t = buildTimeline({
      transitions: [
        transition({ id: "old", created_at: "2026-08-01T00:00:00Z", to_stage: "jih" }),
        transition({ id: "new", created_at: "2026-08-15T00:00:00Z", to_stage: "under_negotiation" }),
      ],
    });
    expect(t[0].id).toBe("transition:new");
    expect(t[1].id).toBe("transition:old");
  });

  it("is stable when two events share a timestamp", () => {
    const src = {
      transitions: [
        transition({ id: "a", created_at: "2026-08-10T09:00:00Z", to_stage: "jih" }),
        transition({ id: "b", created_at: "2026-08-10T09:00:00Z", to_stage: "under_negotiation" }),
      ],
    };
    expect(buildTimeline(src).map((e) => e.id)).toEqual(buildTimeline(src).map((e) => e.id));
  });
});

describe("stage events", () => {
  it("carries previous → new state and the actor", () => {
    const [e] = buildTimeline({ transitions: [transition({ from_stage: "jih", to_stage: "jih_bafo" })] });
    expect(e.from).toBe("jih");
    expect(e.to).toBe("jih_bafo");
    expect(e.actorId).toBe("u1");
    expect(e.source).toBe("stage_transition_history");
  });

  it("names the terminal outcomes plainly", () => {
    expect(buildTimeline({ transitions: [transition({ to_stage: "won" })] })[0].title).toBe("Won");
    expect(buildTimeline({ transitions: [transition({ to_stage: "lost" })] })[0].title).toBe("Lost");
    expect(buildTimeline({ transitions: [transition({ to_stage: "on_hold" })] })[0].title).toBe("Put on hold");
  });

  it("keeps evidence when the transition recorded it", () => {
    const [e] = buildTimeline({ transitions: [transition({ evidence: "award-letter.pdf" })] });
    expect(e.evidence).toBe("award-letter.pdf");
  });

  it("distinguishes a tender stage move", () => {
    const [e] = buildTimeline({ transitions: [transition({ record_type: "tender" })] });
    expect(e.type).toBe("tender_stage_changed");
  });
});

describe("intake lineage", () => {
  it("emits creation, information requested, resubmission and the decision", () => {
    const t = buildTimeline({
      intake: [
        intake({
          info_requested_at: "2026-08-03T00:00:00Z",
          info_comment: "Send the BOQ",
          resubmitted_at: "2026-08-04T00:00:00Z",
          resubmit_count: 1,
          reviewed_at: "2026-08-05T00:00:00Z",
          review_state: "approved_for_pricing",
          reviewed_by: "u9",
        }),
      ],
    });
    const types = t.map((e) => e.type);
    expect(types).toContain("intake_created");
    expect(types).toContain("intake_need_information");
    expect(types).toContain("intake_resubmitted");
    expect(types).toContain("intake_approved_for_pricing");
  });

  it("does not emit a decision while still pending", () => {
    const t = buildTimeline({ intake: [intake()] });
    expect(t.map((e) => e.type)).toEqual(["intake_created"]);
  });

  it("does not double-report need_information as a decision", () => {
    const t = buildTimeline({
      intake: [intake({ review_state: "need_information", reviewed_at: "2026-08-03T00:00:00Z", info_requested_at: "2026-08-03T00:00:00Z" })],
    });
    expect(t.filter((e) => e.type === "intake_need_information")).toHaveLength(1);
  });

  it("shows the rejection reason", () => {
    const t = buildTimeline({
      intake: [intake({ review_state: "rejected", reviewed_at: "2026-08-06T00:00:00Z", reject_reason: "Out of scope" })],
    });
    expect(t.find((e) => e.type === "intake_rejected")?.detail).toBe("Out of scope");
  });

  it("records the conversion", () => {
    const t = buildTimeline({
      intake: [intake({ converted_record_type: "opportunity", converted_record_id: "o1", reviewed_at: "2026-08-07T00:00:00Z" })],
    });
    expect(t.find((e) => e.type === "intake_converted")?.title).toContain("Converted to opportunity");
  });

  // The source table records no resubmitter, so the field stays null.
  it("leaves the actor null rather than guessing who resubmitted", () => {
    const t = buildTimeline({ intake: [intake({ resubmitted_at: "2026-08-04T00:00:00Z" })] });
    expect(t.find((e) => e.type === "intake_resubmitted")?.actorId).toBeNull();
  });
});

describe("approvals", () => {
  it("emits the request and, once decided, the decision", () => {
    const t = buildTimeline({
      approvals: [approval({ status: "approved", decided_at: "2026-08-13T00:00:00Z", decision_notes: "ok" })],
    });
    expect(t.map((e) => e.type)).toEqual(["approval_approved", "approval_requested"]);
    expect(t[0].detail).toBe("ok");
    expect(t[0].actorId).toBe("u3");
  });

  it("emits only the request while pending", () => {
    expect(buildTimeline({ approvals: [approval()] }).map((e) => e.type)).toEqual(["approval_requested"]);
  });
});

describe("communication", () => {
  it("includes completed follow-ups", () => {
    const [e] = buildTimeline({ followUps: [followUp()] });
    expect(e.category).toBe("communication");
    expect(e.title).toContain("call");
    expect(e.detail).toBe("Spoke to the consultant");
  });

  // A scheduled follow-up is pending work, not history.
  it("excludes follow-ups that have not happened", () => {
    expect(buildTimeline({ followUps: [followUp({ status: "scheduled", last_contact_at: null })] })).toEqual([]);
    expect(buildTimeline({ followUps: [followUp({ status: "cancelled" })] })).toEqual([]);
  });
});

describe("opportunity milestones", () => {
  it("emits creation and the award/contract dates", () => {
    const t = buildTimeline({
      opportunity: oppFacts({
        verbal_award_date: "2026-08-06",
        contract_received_date: "2026-08-08",
        contract_signed_date: "2026-08-09",
      }),
    });
    const types = t.map((e) => e.type);
    expect(types).toContain("opportunity_created");
    expect(types).toContain("verbal_award");
    expect(types).toContain("contract_received");
    expect(types).toContain("contract_signed");
  });

  it("records tender lineage when the opportunity came from one", () => {
    const t = buildTimeline({ opportunity: oppFacts({ source_tender_id: "t-123" }) });
    const e = t.find((x) => x.type === "tender_converted_to_jih");
    expect(e?.title).toBe("Converted from tender");
    expect(e?.href).toBe("/tenders");
  });

  it("emits the commercial handoff with its actor", () => {
    const t = buildTimeline({
      opportunity: oppFacts({
        commercial_handoff_status: "with_commercial",
        commercial_handoff_at: "2026-08-14T00:00:00Z",
        commercial_handoff_by: "u7",
      }),
    });
    const e = t.find((x) => x.category === "commercial");
    expect(e?.title).toContain("with commercial");
    expect(e?.actorId).toBe("u7");
  });

  it("emits nothing for milestones that never happened", () => {
    const t = buildTimeline({ opportunity: oppFacts() });
    expect(t.map((e) => e.type)).toEqual(["opportunity_created"]);
  });
});

// stage_transition_history and the milestone date columns describe the same
// real-world moment; showing both would tell the reader it happened twice.
describe("no duplicate events", () => {
  it("collapses a transition and its milestone column into one", () => {
    const t = buildTimeline({
      transitions: [transition({ id: "vt", to_stage: "verbally_awarded", created_at: "2026-08-06T10:00:00Z", actor_id: "u5" })],
      opportunity: oppFacts({ verbal_award_date: "2026-08-06" }),
    });
    const verbal = t.filter((e) => e.to === "verbally_awarded");
    expect(verbal).toHaveLength(1);
  });

  it("keeps the richer record — the one with an actor", () => {
    const t = buildTimeline({
      transitions: [transition({ id: "vt", to_stage: "verbally_awarded", created_at: "2026-08-06T10:00:00Z", actor_id: "u5" })],
      opportunity: oppFacts({ verbal_award_date: "2026-08-06" }),
    });
    expect(t.find((e) => e.to === "verbally_awarded")?.actorId).toBe("u5");
  });

  it("keeps both when they are genuinely different days", () => {
    const t = buildTimeline({
      transitions: [transition({ id: "vt", to_stage: "verbally_awarded", created_at: "2026-08-01T10:00:00Z" })],
      opportunity: oppFacts({ verbal_award_date: "2026-08-06" }),
    });
    expect(t.filter((e) => e.to === "verbally_awarded")).toHaveLength(2);
  });

  it("can be switched off for auditing the raw sources", () => {
    const t = buildTimeline(
      {
        transitions: [transition({ id: "vt", to_stage: "verbally_awarded", created_at: "2026-08-06T10:00:00Z" })],
        opportunity: oppFacts({ verbal_award_date: "2026-08-06" }),
      },
      { dedupe: false },
    );
    expect(t.filter((e) => e.to === "verbally_awarded")).toHaveLength(2);
  });

  it("never drops an event that has no destination state", () => {
    const kept = dedupeEvents([
      { id: "x", at: "2026-08-01T00:00:00Z", category: "sales", type: "note", title: "n", detail: null, actorId: null, from: null, to: null, source: "s", evidence: null, href: null },
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("filtering", () => {
  const sources = {
    transitions: [transition()],
    approvals: [approval()],
    followUps: [followUp()],
    opportunity: oppFacts({ commercial_handoff_at: "2026-08-14T00:00:00Z", commercial_handoff_status: "with_commercial" }),
  };

  it("returns everything by default", () => {
    expect(buildTimeline(sources).length).toBeGreaterThan(3);
  });

  it("filters to one category", () => {
    for (const c of ["sales", "approvals", "communication", "commercial"] as const) {
      const t = buildTimeline(sources, { filter: c });
      expect(t.length).toBeGreaterThan(0);
      expect(t.every((e) => e.category === c)).toBe(true);
    }
  });
});

describe("recency grouping", () => {
  it("splits into Today / Yesterday / Earlier", () => {
    const events = buildTimeline({
      transitions: [
        transition({ id: "t", created_at: `${TODAY}T09:00:00Z`, to_stage: "jih" }),
        transition({ id: "y", created_at: "2026-08-19T09:00:00Z", to_stage: "jih_bafo" }),
        transition({ id: "e", created_at: "2026-07-01T09:00:00Z", to_stage: "under_negotiation" }),
      ],
    });
    const g = groupByRecency(events, TODAY);
    expect(g.map((x) => x.key)).toEqual(["today", "yesterday", "earlier"]);
    expect(g[0].events[0].id).toBe("transition:t");
  });

  it("omits empty groups", () => {
    const events = buildTimeline({ transitions: [transition({ created_at: "2026-01-01T00:00:00Z" })] });
    expect(groupByRecency(events, TODAY).map((g) => g.key)).toEqual(["earlier"]);
  });

  it("handles a month boundary", () => {
    const events = buildTimeline({ transitions: [transition({ created_at: "2026-07-31T09:00:00Z" })] });
    expect(groupByRecency(events, "2026-08-01").map((g) => g.key)).toEqual(["yesterday"]);
  });
});

describe("nothing is fabricated", () => {
  it("an empty source set produces an empty timeline", () => {
    expect(buildTimeline({})).toEqual([]);
  });

  it("every event names the table it came from", () => {
    const t = buildTimeline({
      transitions: [transition()],
      intake: [intake()],
      approvals: [approval()],
      followUps: [followUp()],
      opportunity: oppFacts(),
    });
    for (const e of t) expect(e.source.length).toBeGreaterThan(3);
  });
});
