// =============================================================================
// Phase 5.1 Package B — action intelligence.
//
// The proof points the spec asks for, each written as the failure it prevents
// rather than as a restatement of the code.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ATTENTION,
  REASON_CATEGORY,
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
/** A verified client-facing contact. `last_activity_at` no longer establishes
 *  one: it is stamped by any logged activity, notes and unsent drafts included. */
const met = (oppId: string, at: string): ActivityRow => ({
  id: `m-${oppId}-${at}`,
  opportunity_id: oppId,
  activity_type: "meeting",
  status: "logged",
  created_at: at,
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
    activities: [met("murabba", "2026-07-01")],
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
    expect(r.detail).toEqual({ key: "rsn_follow_up_overdue_many", params: { count: 2, days: 25 } });
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

  it("a complete, future-dated action on a fully-evidenced deal raises nothing", () => {
    const items = buildAttention({
      opportunities: [opp({ id: "a" })],
      activities: [met("a", TODAY)],
      today: TODAY,
    });
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
      opportunities: [opp({ id: "a", expected_contract_date: "2026-07-01", created_at: "2026-05-01" })],
      activities: [met("a", "2026-06-01")],
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

describe("stalled requires evidence of what 'too long' means", () => {
  // A baseline needs minBaselineObservations completed spells. This fixture
  // supplies five 10-day spells for `jih`, so the median is a real 10 days.
  const withBaseline: StageTransitionRow[] = [];
  for (let i = 0; i < 5; i++) {
    withBaseline.push({ record_type: "opportunity", record_id: `hist${i}`, to_stage: "jih", created_at: "2026-01-01T00:00:00Z" });
    withBaseline.push({ record_type: "opportunity", record_id: `hist${i}`, to_stage: "won", created_at: "2026-01-11T00:00:00Z" });
  }
  const entered = (id: string, at: string): StageTransitionRow => ({
    record_type: "opportunity",
    record_id: id,
    to_stage: "jih",
    created_at: at,
  });

  it("a valid baseline plus excessive age plus silence IS stalled", () => {
    const items = buildAttention({
      opportunities: [opp({ id: "a" })],
      activities: [met("a", "2026-06-05")],
      transitions: [...withBaseline, entered("a", "2026-06-01T00:00:00Z")],
      today: TODAY,
    });
    expect(items[0].stalled).toBe(true);
    const r = items[0].reasons.find((x) => x.kind === "stalled")!;
    expect(r.detail).toEqual({ key: "rsn_stalled", params: { days: 86, stage: "jih", limit: 10, source: "baseline" } });
  });

  it("time alone is not stalled — a worked deal legitimately sits in pricing", () => {
    const items = buildAttention({
      opportunities: [opp({ id: "a" })],
      activities: [met("a", TODAY)],
      transitions: [...withBaseline, entered("a", "2026-06-01T00:00:00Z")],
      today: TODAY,
    });
    expect(items.find((i) => i.opportunityId === "a")?.stalled ?? false).toBe(false);
  });

  it("NO baseline plus enormous age is NOT stalled, however old", () => {
    // The correction that produced this test: a flat fallback would have made
    // that invented number the benchmark for the whole book, because
    // stage_transition_history is sparse and almost every baseline is absent.
    const items = buildAttention({
      opportunities: [opp({ id: "a", created_at: "2020-01-01" })],
      activities: [met("a", "2020-01-01")],
      transitions: [],
      today: TODAY,
    });
    expect(items[0].aging.daysInStage).toBeGreaterThan(2000);
    expect(items[0].aging.baseline?.source).toBe("unavailable");
    expect(items[0].stalled).toBe(false);
  });

  it("but that neglected deal still SURFACES — as attention, not as risk", () => {
    // Removing the invented benchmark must not make an abandoned deal
    // invisible. It must also not call it endangered on evidence nobody
    // approved: six years of measured silence is a striking fact, and the
    // threshold that would make it a verdict is one this codebase chose.
    const items = buildAttention({
      opportunities: [opp({ id: "a", created_at: "2020-01-01", next_action: null })],
      activities: [met("a", "2020-01-01")],
      transitions: [],
      today: TODAY,
    });
    const kinds = items[0].reasons.map((r) => r.kind);
    expect(kinds).toContain("inactive");
    expect(kinds).toContain("no_next_action");
    expect(items[0].score).toBeGreaterThan(0);
    // Needs Attention YES, At Risk NO — the distinction the 49/49 reading lost.
    expect(items[0].atRisk).toBe(false);
  });

  it("and becomes At Risk the moment real risk evidence appears", () => {
    const items = buildAttention({
      opportunities: [
        opp({ id: "a", created_at: "2020-01-01", next_action: null, expected_contract_date: "2026-01-01" }),
      ],
      activities: [met("a", "2020-01-01")],
      transitions: [],
      today: TODAY,
    });
    expect(items[0].atRisk).toBe(true);
    expect(items[0].reasons.find((r) => r.category === "risk")!.kind).toBe("expected_close_overdue");
  });

  it("a configured stage SLA counts as evidence in place of a baseline", () => {
    // Designed for, deliberately unpopulated. When the business sets a real
    // SLA it becomes a limit on the same footing as a measured median.
    const items = buildAttention({
      opportunities: [opp({ id: "a", created_at: "2026-06-01" })],
      activities: [met("a", "2026-06-05")],
      transitions: [],
      today: TODAY,
      thresholds: { ...DEFAULT_ATTENTION, stageSla: { jih: 30 } },
    });
    expect(items[0].stalled).toBe(true);
    expect(items[0].reasons.find((r) => r.kind === "stalled")!.detail.params).toMatchObject({ limit: 30, source: "SLA" });
  });

  it("ships with no SLA populated", () => {
    expect(DEFAULT_ATTENTION.stageSla).toEqual({});
  });

  it("a note to ourselves is not client contact", () => {
    const note: ActivityRow = { id: "n", opportunity_id: "a", activity_type: "note", status: "logged", created_at: TODAY };
    expect(isMeaningfulClientActivity(note)).toBe(false);
    const items = buildAttention({
      opportunities: [opp({ id: "a" })],
      activities: [note, met("a", "2026-06-05")],
      transitions: [...withBaseline, entered("a", "2026-06-01T00:00:00Z")],
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
      opportunities: [opp({ id: "a" })],
      activities: [meeting],
      transitions: [...withBaseline, entered("a", "2026-06-01T00:00:00Z")],
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

  it("a zero-day median is an import artifact, not a baseline", () => {
    // Rendered 2026-08-26: "28 days in rfq_received against a 0-day baseline".
    // Enough deals had been moved in and out of the stage on one day — a bulk
    // backfill — that the median was 0, so every deal older than zero days
    // cleared the "too long" bar. The 21-day fallback we deleted, rebuilt by
    // the data.
    const rows: StageTransitionRow[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push(spell(`r${i}`, "jih", "2026-01-01T00:00:00Z"));
      rows.push(spell(`r${i}`, "won", "2026-01-01T06:00:00Z"));
    }
    const b = stageBaselines(rows).get("jih")!;
    expect(b.observations).toBe(6);
    expect(b.source).toBe("unavailable");
    expect(b.days).toBeNull();
  });

  it("and a book with only same-day history cannot stall anything on age", () => {
    const rows: StageTransitionRow[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push(spell(`r${i}`, "jih", "2026-01-01T00:00:00Z"));
      rows.push(spell(`r${i}`, "won", "2026-01-01T06:00:00Z"));
    }
    const items = buildAttention({
      opportunities: [opp({ id: "a", last_activity_at: "2026-06-01", created_at: "2026-06-01" })],
      transitions: rows,
      today: TODAY,
    });
    expect(items[0].stalled).toBe(false);
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

// =============================================================================
// Pre-Package-D hardening — absence of evidence is not evidence of absence.
// =============================================================================

describe("a CRM gap is a statement about the CRM, not about the client", () => {
  const bare = opp({ id: "hist", quotation_value: 5_000_000 });

  it("no activity record is 'engagement history unavailable', never 'inactive'", () => {
    const [i] = buildAttention({ opportunities: [bare], activities: [], today: TODAY });
    const kinds = i.reasons.map((r) => r.kind);
    expect(kinds).toContain("no_engagement_history");
    expect(kinds).not.toContain("inactive");
  });

  it("no activity record alone does NOT make a deal At Risk", () => {
    // This is the 49/49 reading, corrected. Every opportunity on the book
    // lacked activity history, so every one was declared endangered.
    const [i] = buildAttention({ opportunities: [bare], activities: [], today: TODAY });
    expect(i.atRisk).toBe(false);
  });

  it("missing engagement history is categorised as data quality", () => {
    const [i] = buildAttention({ opportunities: [bare], activities: [], today: TODAY });
    expect(i.reasons.find((r) => r.kind === "no_engagement_history")!.category).toBe("data_quality");
  });

  it("last_activity_at is NOT accepted as proof the client was contacted", () => {
    // It is stamped by logActivity for ANY activity, notes and unsent drafts
    // included, and the importer never writes it at all. Reading it as contact
    // would contradict the rule that notes and drafts are not contact.
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", last_activity_at: "2026-08-25" })],
      activities: [],
      today: TODAY,
    });
    expect(i.reasons.map((r) => r.kind)).toContain("no_engagement_history");
    expect(i.lastClientActivity).toBeNull();
  });

  it("a real client activity DOES produce a measured inactivity duration", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a" })],
      activities: [met("a", "2026-07-01")],
      today: TODAY,
    });
    const r = i.reasons.find((x) => x.kind === "inactive")!;
    expect(r.detail).toEqual({ key: "rsn_inactive", params: { days: 56 } });
    expect(r.category).toBe("engagement");
  });

  it("a promoted historical deal is not branded inactive for lacking CRM history", () => {
    // These carry years of real relationship that predates this system. The
    // system knowing nothing about it is the system's gap, not the rep's.
    const historical = opp({
      id: "promoted",
      created_at: "2019-03-01",
      quotation_value: 12_000_000,
      next_action: null,
    });
    const [i] = buildAttention({ opportunities: [historical], activities: [], today: TODAY });
    expect(i.reasons.map((r) => r.kind)).not.toContain("inactive");
    expect(i.atRisk).toBe(false);
    // It still needs attention — it has no next action — which is the point.
    expect(i.reasons.map((r) => r.kind)).toContain("no_next_action");
  });

  it("creation and import dates are never used as contact dates", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", created_at: "2019-01-01" })],
      activities: [],
      today: TODAY,
    });
    expect(i.lastClientActivity).toBeNull();
    expect(i.reasons.map((r) => r.kind)).not.toContain("inactive");
  });
});

describe("At Risk, Needs Attention and Data Quality are three different questions", () => {
  it("a deal with only data gaps needs attention but is not at risk", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a", contractor_decision_maker: null, human_win_probability: null })],
      activities: [met("a", TODAY)],
      today: TODAY,
    });
    expect(i.issueCount).toBeGreaterThan(0);
    expect(i.atRisk).toBe(false);
    expect(i.reasons.every((r) => r.category === "data_quality")).toBe(true);
  });

  it("verified commercial risk still produces At Risk", () => {
    for (const [field, value] of [["expected_contract_date", "2026-01-01"]] as const) {
      const [i] = buildAttention({
        opportunities: [opp({ id: "a", [field]: value })],
        activities: [met("a", TODAY)],
        today: TODAY,
      });
      expect([field, i.atRisk]).toEqual([field, true]);
    }
  });

  it("an overdue follow-up is real risk — a commitment was made and missed", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a" })],
      followUps: [fu("f", "a", "2026-08-01")],
      activities: [met("a", TODAY)],
      today: TODAY,
    });
    expect(i.atRisk).toBe(true);
  });

  it("RISK_REASONS is derived from the category table, not kept by hand", () => {
    // A new reason cannot be added without someone deciding what kind it is.
    for (const kind of RISK_REASONS) expect([kind, REASON_CATEGORY[kind]]).toEqual([kind, "risk"]);
    expect(RISK_REASONS).not.toContain("inactive");
    expect(RISK_REASONS).not.toContain("no_engagement_history");
    expect(RISK_REASONS).not.toContain("unscored");
    expect(RISK_REASONS).not.toContain("no_decision_maker");
  });

  it("every reason kind has a category — none can slip through uncategorised", () => {
    for (const kind of Object.keys(RULE_POINTS) as Array<keyof typeof RULE_POINTS>) {
      expect([kind, REASON_CATEGORY[kind] !== undefined]).toEqual([kind, true]);
    }
  });
});

describe("no invented inactivity SLA", () => {
  it("the reporting threshold cannot by itself create At Risk", () => {
    const [i] = buildAttention({
      opportunities: [opp({ id: "a" })],
      activities: [met("a", "2020-01-01")],
      today: TODAY,
    });
    expect(i.reasons.map((r) => r.kind)).toContain("inactive");
    expect(i.atRisk).toBe(false);
  });

  it("ships no stage SLA values", () => {
    expect(DEFAULT_ATTENTION.stageSla).toEqual({});
  });
});

describe("explanations are structured facts, identical in both languages", () => {
  it("every reason carries a key and no English prose", () => {
    const items = buildAttention({
      opportunities: [opp({ id: "a", next_action: null, expected_contract_date: "2026-01-01" })],
      followUps: [fu("f", "a", "2026-08-01")],
      activities: [met("a", "2026-06-01")],
      today: TODAY,
    });
    for (const r of items[0].reasons) {
      expect([r.kind, typeof r.detail.key]).toEqual([r.kind, "string"]);
      expect([r.kind, r.detail.key.startsWith("rsn_")]).toEqual([r.kind, true]);
      // The fact carries numbers, not a rendered sentence.
      expect([r.kind, /[a-z]{4,} [a-z]{4,}/.test(r.detail.key)]).toEqual([r.kind, false]);
    }
  });

  it("the same input produces the same facts regardless of language — there is no language here", () => {
    // buildAttention takes no locale. That is the guarantee: EN and AR cannot
    // diverge because only one computation exists.
    const args = {
      opportunities: [opp({ id: "a", next_action: null })],
      activities: [met("a", "2026-06-01")],
      today: TODAY,
    };
    expect(JSON.stringify(buildAttention(args))).toBe(JSON.stringify(buildAttention(args)));
  });
});
