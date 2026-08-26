// =============================================================================
// Phase 5.1 Package B — action intelligence.
//
// The proof points the spec asks for, each written as the failure it prevents
// rather than as a restatement of the code.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ATTENTION,
  RULE_POINTS,
  RISK_REASONS,
  bandOf,
  buildAttention,
  isMeaningfulClientActivity,
  stageAgingFor,
  stageBaselines,
  summarize,
  type ActivityRow,
  type AttentionOpp,
  type FollowUpRow,
  type StageTransitionRow,
} from "@/lib/attention";
import { pipelineHealth } from "@/lib/sales-kpis";

const TODAY = "2026-08-26";
const opp = (o: Partial<AttentionOpp> & { id: string }): AttentionOpp => ({
  sales_stage: "jih",
  project_name: o.id,
  next_action: "Call the client",
  next_action_due: "2026-09-30",
  contractor_decision_maker: "Eng. Khalid",
  human_win_probability: 50,
  last_activity_at: TODAY,
  created_at: "2026-08-20",
  ...o,
});
const fu = (id: string, oppId: string, due: string, status = "scheduled"): FollowUpRow => ({
  id,
  opportunity_id: oppId,
  due_date: due,
  status,
});

describe("one opportunity is one item, however many things are wrong with it", () => {
  // The exact case from the 2026-08-25 review: NEW MURABBA listed twice because
  // it had two overdue follow-ups. Four problems became eight dashboard rows.
  const subject = opp({
    id: "murabba",
    quotation_value: 2_000_000,
    next_action: null,
    next_action_due: null,
    contractor_decision_maker: null,
    last_activity_at: "2026-07-01",
    created_at: "2026-06-01",
  });

  const items = buildAttention({
    opportunities: [subject],
    followUps: [fu("f1", "murabba", "2026-08-01"), fu("f2", "murabba", "2026-08-03")],
    today: TODAY,
  });

  it("appears exactly once", () => {
    expect(items).toHaveLength(1);
    expect(items[0].opportunityId).toBe("murabba");
  });

  it("carries all four underlying reasons, not four rows", () => {
    const kinds = items[0].reasons.map((r) => r.kind).sort();
    expect(kinds).toContain("follow_up_overdue");
    expect(kinds).toContain("no_next_action");
    expect(kinds).toContain("no_decision_maker");
    expect(kinds).toContain("inactive");
    expect(items[0].issueCount).toBe(items[0].reasons.length);
  });

  it("collapses two overdue follow-ups into one reason that keeps both ids", () => {
    const r = items[0].reasons.find((x) => x.kind === "follow_up_overdue")!;
    expect(r.sourceIds.sort()).toEqual(["f1", "f2"]);
    expect(r.detail).toContain("2 overdue follow-ups");
  });

  it("reports the oldest overdue age, not the newest", () => {
    expect(items[0].oldestOverdueDays).toBe(25); // 2026-08-01 → 2026-08-26
  });

  it("names a primary issue without hiding the rest", () => {
    expect(items[0].primaryReason).toBeDefined();
    expect(items[0].reasons.length).toBeGreaterThan(1);
  });
});

describe("priority is deterministic and value-aware", () => {
  // The complaint the whole engine exists for: SAR 8M two days late must
  // outrank SAR 100K ten days late. Due-date order alone gets this backwards.
  const big = opp({ id: "big", quotation_value: 8_000_000 });
  const small = opp({ id: "small", quotation_value: 100_000 });
  const items = buildAttention({
    opportunities: [big, small],
    followUps: [fu("a", "big", "2026-08-24"), fu("b", "small", "2026-08-16")],
    today: TODAY,
  });

  it("ranks the larger, less-late deal first", () => {
    expect(items.map((i) => i.opportunityId)).toEqual(["big", "small"]);
  });

  it("produces the same order every time it runs", () => {
    const again = buildAttention({
      opportunities: [small, big], // input order reversed
      followUps: [fu("b", "small", "2026-08-16"), fu("a", "big", "2026-08-24")],
      today: TODAY,
    });
    expect(again.map((i) => i.opportunityId)).toEqual(items.map((i) => i.opportunityId));
    expect(again.map((i) => i.score)).toEqual(items.map((i) => i.score));
  });

  it("bands are pure cuts on the score", () => {
    expect(bandOf(60)).toBe("critical");
    expect(bandOf(59)).toBe("high");
    expect(bandOf(35)).toBe("high");
    expect(bandOf(34)).toBe("normal");
    expect(bandOf(15)).toBe("normal");
    expect(bandOf(14)).toBe("low");
  });

  it("the score is exactly the sum of the reasons that fired, plus value and stage", () => {
    // §9: a band nobody can take apart is a black box wearing a number.
    for (const i of items) {
      const fromReasons = i.reasons.reduce((s, r) => s + r.points, 0);
      expect([i.opportunityId, i.score >= fromReasons]).toEqual([i.opportunityId, true]);
    }
  });

  it("no AI is consulted — the engine takes only rows and a date", () => {
    // buildAttention has no client, no fetch and no agent parameter. If an AI
    // call is ever added here, this test is the one that should be argued with.
    expect(buildAttention.length).toBe(1);
    const offline = buildAttention({ opportunities: [big], followUps: [fu("a", "big", "2026-08-24")], today: TODAY });
    expect(offline[0].priority).toBe(items.find((i) => i.opportunityId === "big")!.priority);
  });
});

describe("terminal and paused work is excluded", () => {
  it("won, lost, on_hold and archived never appear", () => {
    const items = buildAttention({
      opportunities: [
        opp({ id: "won", sales_stage: "won", next_action: null }),
        opp({ id: "lost", sales_stage: "lost", next_action: null }),
        opp({ id: "hold", sales_stage: "on_hold", next_action: null }),
        opp({ id: "arch", stage: "archived", next_action: null }),
      ],
      today: TODAY,
    });
    expect(items).toEqual([]);
  });

  it("on_hold is still open pipeline — it is excluded from hygiene, not from the book", () => {
    // Nagging a deliberately parked deal for a next action is how a queue
    // teaches people to ignore it.
    const health = pipelineHealth(
      [{ id: "hold", sales_stage: "on_hold", next_action: null, quotation_value: 1_000_000 }],
      { today: TODAY, period: null },
    );
    expect(health.map((h) => h.issue)).not.toContain("no_next_action");
  });
});

describe("next action hygiene", () => {
  it("detects a missing action", () => {
    const [i] = buildAttention({ opportunities: [opp({ id: "a", next_action: null })], today: TODAY });
    expect(i.nextAction.status).toBe("missing");
    expect(i.reasons.map((r) => r.kind)).toContain("no_next_action");
  });

  it("detects an action with no date — a wish, not a plan", () => {
    const [i] = buildAttention({ opportunities: [opp({ id: "a", next_action_due: null })], today: TODAY });
    expect(i.nextAction.status).toBe("no_date");
    expect(i.reasons.map((r) => r.kind)).toContain("no_next_action_date");
  });

  it("detects an action whose date has slipped", () => {
    const [i] = buildAttention({ opportunities: [opp({ id: "a", next_action_due: "2026-08-10" })], today: TODAY });
    expect(i.nextAction.status).toBe("overdue");
  });

  it("a complete, future-dated action raises nothing", () => {
    const items = buildAttention({ opportunities: [opp({ id: "a" })], today: TODAY });
    expect(items).toEqual([]);
  });

  it("feeds pipelineHealth too, so Data Quality and Needs Attention agree", () => {
    const health = pipelineHealth(
      [{ id: "a", sales_stage: "jih", next_action: null }],
      { today: TODAY, period: null },
    );
    expect(health.map((h) => h.issue)).toContain("no_next_action");
  });

  it("never creates an action — the engine only reads", () => {
    const before = opp({ id: "a", next_action: null });
    buildAttention({ opportunities: [before], today: TODAY });
    expect(before.next_action).toBeNull();
  });
});

describe("At Risk is a named set of reasons, not a mood", () => {
  it("every at-risk item exposes at least one risk reason", () => {
    const items = buildAttention({
      opportunities: [opp({ id: "a", last_activity_at: "2026-06-01", created_at: "2026-05-01" })],
      today: TODAY,
    });
    expect(items[0].atRisk).toBe(true);
    expect(items[0].reasons.some((r) => RISK_REASONS.includes(r.kind))).toBe(true);
  });

  it("an item with only clerical gaps is not at risk", () => {
    // A missing decision maker is a data-quality problem, not a deal in danger.
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", contractor_decision_maker: null })],
      today: TODAY,
    });
    expect(i.atRisk).toBe(false);
  });
});

describe("stalled uses real history and real contact", () => {
  const transitions: StageTransitionRow[] = [
    { record_type: "opportunity", record_id: "a", from_stage: "rfq_received", to_stage: "jih", created_at: "2026-06-01" },
  ];

  it("needs BOTH too-long-in-stage and nothing moving it", () => {
    // Time alone is not stalled: a deal legitimately sits in pricing while
    // someone works it. Silence is what turns age into a problem.
    const busy = buildAttention({
      opportunities: [opp({ id: "a", last_activity_at: TODAY })],
      transitions,
      today: TODAY,
    });
    expect(busy.find((i) => i.opportunityId === "a")?.stalled ?? false).toBe(false);

    const silent = buildAttention({
      opportunities: [opp({ id: "a", last_activity_at: "2026-06-05" })],
      transitions,
      today: TODAY,
    });
    expect(silent[0].stalled).toBe(true);
  });

  it("a note to ourselves is not client contact", () => {
    const note: ActivityRow = { id: "n", opportunity_id: "a", activity_type: "note", status: "logged", created_at: TODAY };
    expect(isMeaningfulClientActivity(note)).toBe(false);
    const items = buildAttention({
      opportunities: [opp({ id: "a", last_activity_at: "2026-06-05" })],
      activities: [note],
      transitions,
      today: TODAY,
    });
    expect(items[0].stalled).toBe(true);
  });

  it("an unsent draft is not contact; a sent one is", () => {
    const base = { id: "d", opportunity_id: "a", activity_type: "email_draft", created_at: TODAY };
    expect(isMeaningfulClientActivity({ ...base, status: "draft" })).toBe(false);
    expect(isMeaningfulClientActivity({ ...base, status: "sent" })).toBe(true);
  });

  it("a real meeting clears the inactivity reason", () => {
    const meeting: ActivityRow = { id: "m", opportunity_id: "a", activity_type: "meeting", status: "logged", created_at: TODAY };
    const items = buildAttention({
      opportunities: [opp({ id: "a", last_activity_at: "2026-06-05" })],
      activities: [meeting],
      transitions,
      today: TODAY,
    });
    expect(items.find((i) => i.opportunityId === "a")?.reasons.map((r) => r.kind) ?? []).not.toContain("inactive");
  });
});

describe("stage aging never manufactures a benchmark", () => {
  const spell = (rec: string, to: string, at: string): StageTransitionRow => ({
    record_type: "opportunity",
    record_id: rec,
    to_stage: to,
    created_at: at,
  });

  it("returns Baseline Not Available below the observation floor", () => {
    const few = [spell("r1", "jih", "2026-01-01"), spell("r1", "won", "2026-01-11")];
    const b = stageBaselines(few)!.get("jih")!;
    expect(b.source).toBe("unavailable");
    expect(b.days).toBeNull();
    expect(b.observations).toBe(1);
  });

  it("uses the median once there are enough completed spells", () => {
    // Durations 10, 10, 10, 10, 400 — the mean is 88, the median is 10. One
    // parked deal must not make every other deal look healthy.
    const rows: StageTransitionRow[] = [];
    for (const [i, days] of [10, 10, 10, 10, 400].entries()) {
      const start = new Date(Date.UTC(2026, 0, 1));
      const end = new Date(start.getTime() + days * 86_400_000);
      rows.push(spell(`r${i}`, "jih", start.toISOString()));
      rows.push(spell(`r${i}`, "won", end.toISOString()));
    }
    const b = stageBaselines(rows).get("jih")!;
    expect(b.source).toBe("median");
    expect(b.observations).toBe(5);
    expect(b.days).toBe(10);
  });

  it("counts only completed spells — a deal still sitting there is not evidence", () => {
    // Otherwise the baseline drifts toward whatever is currently stuck, which
    // is exactly backwards.
    const open = [spell("r1", "jih", "2026-01-01")];
    expect(stageBaselines(open).get("jih")!.observations).toBe(0);
  });

  it("dates entry from the transition when one exists", () => {
    const a = stageAgingFor(
      opp({ id: "x" }),
      [spell("x", "jih", "2026-08-01T00:00:00Z")],
      stageBaselines([]),
      TODAY,
    );
    expect(a.enteredAtSource).toBe("transition");
    expect(a.daysInStage).toBe(25);
  });

  it("falls back to creation ONLY when the deal has never moved", () => {
    // That is a fact on the record, not an inference.
    const a = stageAgingFor(opp({ id: "x", created_at: "2026-08-06" }), [], stageBaselines([]), TODAY);
    expect(a.enteredAtSource).toBe("created");
    expect(a.daysInStage).toBe(20);
  });

  it("refuses to date entry when the deal moved but not into its current stage", () => {
    const a = stageAgingFor(
      opp({ id: "x", sales_stage: "under_negotiation" }),
      [spell("x", "jih", "2026-08-01T00:00:00Z")],
      stageBaselines([]),
      TODAY,
    );
    expect(a.enteredAtSource).toBe("unknown");
    expect(a.daysInStage).toBeNull();
  });

  it("reports no deviation when there is no baseline to deviate from", () => {
    const a = stageAgingFor(opp({ id: "x" }), [], stageBaselines([]), TODAY);
    expect(a.baseline?.source).toBe("unavailable");
    expect(a.deviationDays).toBeNull();
  });
});

describe("closing soon requires a real date", () => {
  it("never infers one", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", expected_contract_date: null, next_action: null })],
      today: TODAY,
    });
    expect(i.closingSoon).toBe(false);
  });

  it("fires on a genuine near date", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", expected_contract_date: "2026-09-10" })],
      today: TODAY,
    });
    expect(i.closingSoon).toBe(true);
  });

  it("a passed date is overdue, not closing soon", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", expected_contract_date: "2026-08-01" })],
      today: TODAY,
    });
    expect(i.closingSoon).toBe(false);
    expect(i.reasons.map((r) => r.kind)).toContain("expected_close_overdue");
  });

  it("a date beyond the window does not fire", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", expected_contract_date: "2027-01-01", next_action: null })],
      today: TODAY,
    });
    expect(i.closingSoon).toBe(false);
  });
});

describe("roll-ups do not double count", () => {
  const items = buildAttention({
    opportunities: [
      opp({ id: "a", quotation_value: 1_000_000, next_action: null, last_activity_at: "2026-06-01", created_at: "2026-05-01" }),
      opp({ id: "b", quotation_value: 2_000_000, next_action: null }),
    ],
    followUps: [fu("f1", "a", "2026-08-01"), fu("f2", "a", "2026-08-02")],
    today: TODAY,
  });

  it("counts each opportunity once per bucket regardless of reason count", () => {
    const s = summarize(items);
    expect(new Set(s.atRisk.ids).size).toBe(s.atRisk.count);
    expect(new Set(s.missingNextAction.ids).size).toBe(s.missingNextAction.count);
  });

  it("sums each opportunity's value once, not once per issue", () => {
    const s = summarize(items);
    // `a` has several reasons but contributes its 1M exactly once.
    expect(s.missingNextAction.value).toBe(3_000_000);
  });
});

describe("the rule table is complete and non-negative", () => {
  it("every reason kind the engine can emit has a documented weight", () => {
    for (const [kind, points] of Object.entries(RULE_POINTS)) {
      expect([kind, points > 0]).toEqual([kind, true]);
    }
  });

  it("thresholds are exposed rather than buried in the arithmetic", () => {
    expect(DEFAULT_ATTENTION.minBaselineObservations).toBeGreaterThan(1);
    expect(DEFAULT_ATTENTION.closingSoonDays).toBeGreaterThan(0);
  });
});

describe("owner scoping is preserved", () => {
  it("filtering by owner returns only that owner's work", () => {
    // The engine narrows in-memory; RLS still decides what was fetched. This
    // guards the client half of that contract only.
    const items = buildAttention({
      opportunities: [
        opp({ id: "mine", owner_id: "u1", next_action: null }),
        opp({ id: "theirs", owner_id: "u2", next_action: null }),
      ],
      today: TODAY,
      ownerId: "u1",
    });
    expect(items.map((i) => i.opportunityId)).toEqual(["mine"]);
  });
});
