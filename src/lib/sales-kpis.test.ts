import { describe, expect, it } from "bun:test";
import {
  concentrationBy,
  wonUndated,
  customRange,
  DEFAULT_HEALTH,
  executiveKpis,
  inPeriod,
  lateStageExposure,
  lossRate,
  lostByReason,
  lostByStage,
  lostToCompetitor,
  lostValue,
  openPipeline,
  opportunityValue,
  pipelineHealth,
  resolveProbability,
  stageCount,
  targetKpis,
  thisMonth,
  thisQuarter,
  weightedPipeline,
  winRate,
  wonValue,
  yearToDate,
  type KpiContext,
  type OppRow,
} from "@/lib/sales-kpis";

const TODAY = "2026-08-20";
const SNAPSHOT: KpiContext = { today: TODAY, period: null };
const MONTH: KpiContext = { today: TODAY, period: thisMonth(TODAY) };

function opp(over: Partial<OppRow> = {}): OppRow {
  return { id: `o${Math.random().toString(36).slice(2, 8)}`, ...over };
}

// ---- §4 Official definitions ------------------------------------------------

describe("Official Won — only sales_stage = won", () => {
  const rows = [
    opp({ id: "won", sales_stage: "won", contract_value: 100 }),
    opp({ id: "verbal", sales_stage: "verbally_awarded", contract_value: 1000 }),
    opp({ id: "received", sales_stage: "contract_received", contract_value: 2000 }),
    opp({ id: "signed", sales_stage: "contract_signed", contract_value: 4000 }),
    opp({ id: "lost", sales_stage: "lost", contract_value: 8000 }),
  ];

  it("counts only won", () => {
    const k = wonValue(rows, SNAPSHOT);
    expect(k.value).toBe(100);
    expect(k.recordIds).toEqual(["won"]);
  });

  it("excludes verbally_awarded from Actual", () => {
    expect(wonValue(rows, SNAPSHOT).recordIds).not.toContain("verbal");
  });

  it("excludes contract_received from Actual", () => {
    expect(wonValue(rows, SNAPSHOT).recordIds).not.toContain("received");
  });

  it("excludes contract_signed from Actual", () => {
    expect(wonValue(rows, SNAPSHOT).recordIds).not.toContain("signed");
  });

  // The three excluded stages must still be visible — as exposure, not revenue.
  it("reports them as late-stage exposure instead, clearly not revenue", () => {
    const k = lateStageExposure(rows, SNAPSHOT);
    expect(k.value).toBe(7000);
    expect(k.recordIds.sort()).toEqual(["received", "signed", "verbal"]);
    expect(k.filters.join(" ")).toContain("not revenue");
  });
});

describe("Win rate", () => {
  const rows = [
    opp({ id: "w1", sales_stage: "won" }),
    opp({ id: "w2", sales_stage: "won" }),
    opp({ id: "w3", sales_stage: "won" }),
    opp({ id: "l1", sales_stage: "lost" }),
    opp({ id: "open1", sales_stage: "jih" }),
    opp({ id: "open2", sales_stage: "under_negotiation" }),
    opp({ id: "hold", sales_stage: "on_hold" }),
  ];

  it("is Won / (Won + Lost)", () => {
    expect(winRate(rows, SNAPSHOT).value).toBe(75);
  });

  it("excludes open opportunities from the denominator", () => {
    const ids = winRate(rows, SNAPSHOT).recordIds;
    expect(ids).not.toContain("open1");
    expect(ids).not.toContain("open2");
    expect(ids).not.toContain("hold");
    expect(ids).toHaveLength(4);
  });

  it("says so rather than reporting 0% when nothing has closed", () => {
    const k = winRate([opp({ sales_stage: "jih" })], SNAPSHOT);
    expect(k.value).toBeNull();
    expect(k.caveat?.key).toBe("cav_nothing_closed");
  });

  it("is not derived from quotations", () => {
    expect(winRate(rows, SNAPSHOT).filters.join(" ")).toContain("Not derived from quotations");
  });

  it("loss rate is the complement", () => {
    expect(lossRate(rows, SNAPSHOT).value).toBe(25);
    expect(lossRate([opp({ sales_stage: "jih" })], SNAPSHOT).value).toBeNull();
  });
});

describe("Open pipeline", () => {
  const rows = [
    opp({ id: "a", sales_stage: "rfq_received", estimated_value_max: 10 }),
    opp({ id: "b", sales_stage: "jih", estimated_value_max: 20 }),
    opp({ id: "c", sales_stage: "contract_signed", estimated_value_max: 40 }),
    opp({ id: "hold", sales_stage: "on_hold", estimated_value_max: 80 }),
    opp({ id: "w", sales_stage: "won", estimated_value_max: 160 }),
    opp({ id: "l", sales_stage: "lost", estimated_value_max: 320 }),
  ];

  it("is everything that is neither won nor lost", () => {
    const k = openPipeline(rows, SNAPSHOT);
    expect(k.value).toBe(150);
    expect(k.recordIds.sort()).toEqual(["a", "b", "c", "hold"]);
  });

  // A paused deal is still in the pipeline; dropping it would read as progress.
  it("includes on_hold and says why", () => {
    expect(openPipeline(rows, SNAPSHOT).filters.join(" ")).toContain("paused is still in the pipeline");
  });

  it("is a snapshot — never period-bounded", () => {
    expect(openPipeline(rows, MONTH).dateField).toBeNull();
    expect(openPipeline(rows, MONTH).value).toBe(150);
  });

  it("flags unvalued deals instead of hiding them", () => {
    const k = openPipeline([opp({ sales_stage: "jih" })], SNAPSHOT);
    expect(k.caveat?.key).toBe("cav_unvalued_contribute_zero");
  });
});

describe("Lost value", () => {
  it("sums lost opportunities only", () => {
    const k = lostValue(
      [opp({ id: "l", sales_stage: "lost", contract_value: 500 }), opp({ sales_stage: "won", contract_value: 900 })],
      SNAPSHOT,
    );
    expect(k.value).toBe(500);
    expect(k.recordIds).toEqual(["l"]);
  });
});

// ---- §5 / §38 Probability ---------------------------------------------------

describe("AI vs human probability stay separate", () => {
  it("prefers the manager number and reports the source", () => {
    const p = resolveProbability(opp({ human_win_probability: 70, score: 42 }));
    expect(p.value).toBeCloseTo(0.7);
    expect(p.source).toBe("human");
    expect(p.human).toBe(70);
    expect(p.ai).toBe(42);
    expect(p.delta).toBe(28);
  });

  it("falls back to AI and labels it as estimated", () => {
    const p = resolveProbability(opp({ score: 42 }));
    expect(p.value).toBeCloseTo(0.42);
    expect(p.source).toBe("ai");
    expect(p.label).toContain("AI-estimated");
  });

  it("never invents a probability", () => {
    const p = resolveProbability(opp({}));
    expect(p.value).toBeNull();
    expect(p.source).toBe("none");
    expect(p.label).toBe("Unscored");
    expect(p.delta).toBeNull();
  });

  it("never averages the two", () => {
    const p = resolveProbability(opp({ human_win_probability: 80, score: 20 }));
    expect(p.value).toBeCloseTo(0.8);
  });
});

describe("Weighted pipeline", () => {
  it("weights on the selected probability", () => {
    const k = weightedPipeline(
      [
        opp({ id: "h", sales_stage: "jih", estimated_value_max: 1000, human_win_probability: 50 }),
        opp({ id: "a", sales_stage: "jih", estimated_value_max: 1000, score: 25 }),
      ],
      SNAPSHOT,
    );
    expect(k.value).toBe(750);
  });

  // The old implementation applied a flat 0.2 to unscored deals, manufacturing
  // forecast out of ignorance.
  it("excludes unscored deals instead of assuming a default weight", () => {
    const k = weightedPipeline(
      [
        opp({ id: "scored", sales_stage: "jih", estimated_value_max: 1000, human_win_probability: 50 }),
        opp({ id: "unscored", sales_stage: "jih", estimated_value_max: 9999 }),
      ],
      SNAPSHOT,
    );
    expect(k.value).toBe(500);
    expect(k.recordIds).toEqual(["scored"]);
    expect(k.caveat?.key).toBe("cav_probability_missing");
  });

  it("is null, not zero, when nothing is scored", () => {
    const k = weightedPipeline([opp({ sales_stage: "jih", estimated_value_max: 1000 })], SNAPSHOT);
    expect(k.value).toBeNull();
  });

  it("reports how many used manager vs AI probability", () => {
    const k = weightedPipeline(
      [
        opp({ sales_stage: "jih", estimated_value_max: 100, human_win_probability: 50 }),
        opp({ sales_stage: "jih", estimated_value_max: 100, score: 50 }),
      ],
      SNAPSHOT,
    );
    expect(k.filters.join(" ")).toContain("1 weighted on manager probability, 1 on AI");
  });
});

// ---- §3 Canonical stage -----------------------------------------------------

describe("canonical stage is the source of truth", () => {
  it("sales_stage wins over the legacy column", () => {
    const rows = [opp({ id: "x", sales_stage: "jih", stage: "won", estimated_value_max: 100 })];
    expect(wonValue(rows, SNAPSHOT).value).toBe(0);
    expect(openPipeline(rows, SNAPSHOT).value).toBe(100);
  });

  // Legacy rows have no sales_stage; dropping them would silently shrink history.
  it("still counts a legacy won row that has no sales_stage", () => {
    expect(wonValue([opp({ id: "old", stage: "won", contract_value: 250 })], SNAPSHOT).value).toBe(250);
  });

  it("treats a legacy CRM bucket as pipeline entry, not as won", () => {
    const rows = [opp({ id: "q", stage: "quotation", estimated_value_max: 70 })];
    expect(wonValue(rows, SNAPSHOT).value).toBe(0);
    expect(openPipeline(rows, SNAPSHOT).value).toBe(70);
  });

  it("excludes archived rows from every bucket", () => {
    const rows = [opp({ id: "arch", stage: "archived", estimated_value_max: 500 })];
    expect(openPipeline(rows, SNAPSHOT).value).toBe(0);
    expect(wonValue(rows, SNAPSHOT).value).toBe(0);
  });
});

// ---- §16 Date filtering -----------------------------------------------------

describe("period windows", () => {
  it("builds month, quarter and YTD half-open windows", () => {
    expect(thisMonth("2026-08-20")).toMatchObject({ from: "2026-08-01", to: "2026-09-01" });
    expect(thisQuarter("2026-08-20")).toMatchObject({ from: "2026-07-01", to: "2026-10-01" });
    expect(yearToDate("2026-08-20")).toMatchObject({ from: "2026-01-01", to: "2027-01-01" });
  });

  it("rolls over year boundaries", () => {
    expect(thisMonth("2026-12-05").to).toBe("2027-01-01");
    expect(thisQuarter("2026-11-05")).toMatchObject({ from: "2026-10-01", to: "2027-01-01" });
  });

  it("is half-open so a boundary date lands in exactly one period", () => {
    const aug = thisMonth("2026-08-20");
    expect(inPeriod("2026-08-01", aug)).toBe(true);
    expect(inPeriod("2026-09-01", aug)).toBe(false);
    expect(inPeriod("2026-07-31T23:59:59Z", aug)).toBe(false);
  });

  it("excludes rows with no date rather than guessing", () => {
    expect(inPeriod(null, thisMonth(TODAY))).toBe(false);
  });

  it("uses the won transition date, not created_at", () => {
    const rows = [
      opp({ id: "in", sales_stage: "won", contract_value: 10, created_at: "2020-01-01", won_at: "2026-08-05" }),
      opp({ id: "out", sales_stage: "won", contract_value: 99, created_at: "2026-08-05", won_at: "2024-01-01" }),
    ];
    const k = wonValue(rows, MONTH);
    expect(k.recordIds).toEqual(["in"]);
    expect(k.value).toBe(10);
  });

  // The old implementation fell back to updated_at, so a deal won in March and
  // re-saved in August reported as an August win. It now refuses to guess.
  it("never uses updated_at as an award date", () => {
    const k = wonValue([opp({ sales_stage: "won", contract_value: 10, updated_at: "2026-08-05" })], MONTH);
    expect(k.value).toBe(0);
    expect(k.recordIds).toEqual([]);
    expect(k.caveat?.key).toMatch(/^cav_won_undated/);
  });

  it("supports a custom range", () => {
    const p = customRange("2026-03-01", "2026-04-01");
    expect(inPeriod("2026-03-15", p)).toBe(true);
    expect(inPeriod("2026-04-01", p)).toBe(false);
  });
});

// ---- §17 Targets ------------------------------------------------------------

describe("target achievement", () => {
  const rows = [
    opp({ sales_stage: "won", contract_value: 400, won_at: "2026-08-02" }),
    opp({ sales_stage: "verbally_awarded", contract_value: 10_000 }),
    opp({ sales_stage: "contract_signed", contract_value: 10_000 }),
  ];

  it("counts Won only, never late-stage exposure", () => {
    const t = targetKpis(rows, MONTH, 1000);
    expect(t.actual.value).toBe(400);
    expect(t.achievement.value).toBe(40);
    expect(t.gap.value).toBe(600);
  });

  it("reports unknown rather than 0% when no target is set", () => {
    const t = targetKpis(rows, MONTH, null);
    expect(t.target.value).toBeNull();
    expect(t.achievement.value).toBeNull();
    expect(t.gap.value).toBeNull();
    expect(t.target.caveat?.key).toBe("cav_no_target");
  });

  it("never exceeds the gap floor of zero", () => {
    expect(targetKpis(rows, MONTH, 100).gap.value).toBe(0);
  });
});

// ---- §20 Lost analysis ------------------------------------------------------

describe("lost analysis", () => {
  const rows = [
    opp({ id: "a", sales_stage: "lost", loss_reason: "Price", lost_at_stage: "jih", contract_value: 100, lost_to_competitor: "Acme" }),
    opp({ id: "b", sales_stage: "lost", loss_reason: "Price", lost_at_stage: "jih_bafo", contract_value: 50 }),
    opp({ id: "c", sales_stage: "lost", contract_value: 25 }),
  ];

  it("groups by reason, biggest value first", () => {
    const g = lostByReason(rows, SNAPSHOT);
    expect(g[0]).toMatchObject({ label: "Price", count: 2, value: 150 });
  });

  it("keeps unrecorded reasons visible as Unknown", () => {
    expect(lostByReason(rows, SNAPSHOT).some((b) => b.label === "Reason not recorded")).toBe(true);
  });

  it("groups by the stage the deal was lost at", () => {
    expect(lostByStage(rows, SNAPSHOT).map((b) => b.label).sort()).toEqual([
      "Stage not recorded",
      "jih",
      "jih_bafo",
    ]);
  });

  // Never infer a competitor from an unexplained loss.
  it("reports only competitors that were actually named", () => {
    const g = lostToCompetitor(rows, SNAPSHOT);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("Acme");
  });
});

// ---- §19 Pipeline health ----------------------------------------------------

describe("pipeline health is deterministic", () => {
  it("flags a missing next action", () => {
    const f = pipelineHealth([opp({ id: "x", sales_stage: "jih" })], SNAPSHOT);
    expect(f.some((x) => x.issue === "no_next_action")).toBe(true);
  });

  it("flags a record nobody has touched, with the day count", () => {
    // Renamed from "stalled". This reads last_activity_at, which any logged
    // activity stamps — notes and unsent drafts included — so it measures
    // silence in the CRM, not silence with the client. Stalled has one owner
    // now, and it is the attention engine.
    const f = pipelineHealth(
      [opp({ id: "x", sales_stage: "jih", next_action: "call", last_activity_at: "2026-08-01" })],
      SNAPSHOT,
    );
    const quiet = f.find((x) => x.issue === "no_recent_crm_activity");
    expect(quiet?.detail).toContain("19 days");
    expect(f.map((x) => x.issue)).not.toContain("stalled");
  });

  it("does not flag a deal that moved yesterday", () => {
    const f = pipelineHealth(
      [opp({ sales_stage: "jih", next_action: "call", last_activity_at: "2026-08-19" })],
      SNAPSHOT,
    );
    expect(f.some((x) => x.issue === "stalled")).toBe(false);
  });

  it("flags an expected close date that has passed", () => {
    const f = pipelineHealth(
      [opp({ sales_stage: "jih", next_action: "x", expected_contract_date: "2026-07-01" })],
      SNAPSHOT,
    );
    expect(f.some((x) => x.issue === "expected_close_overdue")).toBe(true);
  });

  it("flags high value at low probability", () => {
    const f = pipelineHealth(
      [opp({ sales_stage: "jih", next_action: "x", estimated_value_max: 900_000, human_win_probability: 10 })],
      SNAPSHOT,
      DEFAULT_HEALTH,
    );
    expect(f.some((x) => x.issue === "high_value_low_probability")).toBe(true);
  });

  it("does not double-flag an unscored deal as low probability", () => {
    const f = pipelineHealth(
      [opp({ sales_stage: "jih", next_action: "x", estimated_value_max: 900_000 })],
      SNAPSHOT,
    );
    expect(f.some((x) => x.issue === "unscored")).toBe(true);
    expect(f.some((x) => x.issue === "high_value_low_probability")).toBe(false);
  });

  it("ignores closed deals entirely", () => {
    expect(pipelineHealth([opp({ sales_stage: "won" }), opp({ sales_stage: "lost" })], SNAPSHOT)).toEqual([]);
  });
});

describe("concentration", () => {
  it("reports share of open pipeline by owner", () => {
    const c = concentrationBy(
      [
        opp({ sales_stage: "jih", owner_id: "u1", estimated_value_max: 750 }),
        opp({ sales_stage: "jih", owner_id: "u2", estimated_value_max: 250 }),
      ],
      SNAPSHOT,
      (o) => o.owner_id ?? null,
    );
    expect(c[0]).toMatchObject({ key: "u1", value: 750, sharePct: 75 });
  });
});

// ---- §42 Every number explains itself ---------------------------------------

describe("every KPI explains itself", () => {
  const rows = [
    opp({ id: "w", sales_stage: "won", contract_value: 100, won_at: "2026-08-02" }),
    opp({ id: "o", sales_stage: "jih", estimated_value_max: 200, human_win_probability: 50 }),
    opp({ id: "l", sales_stage: "lost", contract_value: 300, lost_at: "2026-08-03" }),
  ];
  const exec = executiveKpis(rows, MONTH);
  const all = [
    exec.openPipeline, exec.weightedPipeline, exec.wonValue, exec.lostValue,
    exec.winRate, exec.lossRate, exec.lateStageExposure, ...exec.byStage,
  ];

  it("carries a formula, a source and active filters", () => {
    for (const k of all) {
      expect(k.formula.length).toBeGreaterThan(10);
      expect(k.source.length).toBeGreaterThan(3);
      expect(k.filters.length).toBeGreaterThan(0);
    }
  });

  it("carries the record ids that produced it", () => {
    expect(exec.wonValue.recordIds).toEqual(["w"]);
    expect(exec.wonValue.recordCount).toBe(1);
    expect(exec.openPipeline.recordIds).toEqual(["o"]);
  });

  it("recordCount always matches recordIds", () => {
    for (const k of all) expect(k.recordCount).toBe(k.recordIds.length);
  });

  it("offers a drilldown target for every value KPI", () => {
    for (const k of [exec.openPipeline, exec.wonValue, exec.lostValue, exec.lateStageExposure]) {
      expect(k.drilldown).not.toBeNull();
      expect(k.drilldown!.to).toBe("/opportunities");
    }
  });

  it("states which date field bounded the period", () => {
    expect(exec.wonValue.dateField).toContain("won_at");
    expect(exec.openPipeline.dateField).toBeNull();
  });
});

// ---- Role scoping -----------------------------------------------------------

describe("owner scoping", () => {
  const rows = [
    opp({ id: "mine", sales_stage: "jih", owner_id: "me", estimated_value_max: 100 }),
    opp({ id: "theirs", sales_stage: "jih", owner_id: "them", estimated_value_max: 900 }),
  ];

  it("restricts every KPI to one owner when asked", () => {
    const k = openPipeline(rows, { today: TODAY, period: null, ownerId: "me" });
    expect(k.value).toBe(100);
    expect(k.recordIds).toEqual(["mine"]);
    expect(k.filters.join(" ")).toContain("Owner: selected salesperson");
  });

  it("covers the whole team when no owner is given", () => {
    expect(openPipeline(rows, SNAPSHOT).value).toBe(1000);
  });
});

describe("value resolution", () => {
  it("prefers contract, then quotation, then estimate", () => {
    expect(opportunityValue(opp({ contract_value: 1, quotation_value: 2, estimated_value_max: 3 }))).toBe(1);
    expect(opportunityValue(opp({ quotation_value: 2, estimated_value_max: 3 }))).toBe(2);
    expect(opportunityValue(opp({ estimated_value_max: 3 }))).toBe(3);
  });

  it("returns null — not 0 — when nothing is recorded", () => {
    expect(opportunityValue(opp({}))).toBeNull();
  });

  it("handles numeric strings from Postgres numeric columns", () => {
    expect(opportunityValue(opp({ contract_value: "1500.50" }))).toBe(1500.5);
  });
});

describe("stage counts", () => {
  it("counts a single canonical stage and links to it", () => {
    const k = stageCount([opp({ id: "a", sales_stage: "jih_bafo" }), opp({ sales_stage: "jih" })], SNAPSHOT, "jih_bafo");
    expect(k.value).toBe(1);
    expect(k.drilldown!.search).toEqual({ stage: "jih_bafo" });
  });
});


// ─── Undated Won (PRD §6) ────────────────────────────────────────────────────
// A deal closed before outcome-date tracking existed has no award date. It is
// still Won — dropping it would understate the lifetime total — but it cannot
// be placed in a month, and inventing one would corrupt every period
// comparison. So it stays in the total, leaves the period, and is counted out
// loud.

describe("Won with no recorded award date", () => {
  const rows: OppRow[] = [
    opp({ id: "dated", sales_stage: "won", contract_value: 100, won_at: "2026-08-05" }),
    opp({ id: "undated", sales_stage: "won", contract_value: 400, updated_at: "2026-08-05" }),
  ];

  it("counts toward the lifetime total", () => {
    const k = wonValue(rows, SNAPSHOT);
    expect(k.value).toBe(500);
    expect(k.recordIds.sort()).toEqual(["dated", "undated"]);
  });

  it("is excluded from a date range rather than guessed into it", () => {
    const k = wonValue(rows, MONTH);
    expect(k.value).toBe(100);
    expect(k.recordIds).toEqual(["dated"]);
  });

  it("says how many were held out, and why", () => {
    const k = wonValue(rows, MONTH);
    // The fact, not the sentence: one undated deal, held outside the period.
    expect(k.caveat).toEqual({ key: "cav_won_undated_outside_period", params: { count: 1 } });
  });

  it("has its own KPI so the months still reconcile to the total", () => {
    const u = wonUndated(rows, MONTH);
    expect(u.value).toBe(400);
    expect(u.recordIds).toEqual(["undated"]);
    expect(u.filters.join(" ")).toContain("excluded from any date range");
    expect(u.caveat?.key).toBe("cav_predate_outcome_tracking");
  });

  it("is silent when every won deal is dated", () => {
    expect(wonValue([rows[0]], MONTH).caveat).toBeUndefined();
    expect(wonUndated([rows[0]], MONTH).value).toBe(0);
  });

  it("is exposed on the executive rollup", () => {
    expect(executiveKpis(rows, MONTH).wonUndated.value).toBe(400);
  });
});

describe("Lost with no recorded close date", () => {
  const rows: OppRow[] = [
    opp({ id: "d", sales_stage: "lost", contract_value: 10, lost_at: "2026-08-05" }),
    opp({ id: "u", sales_stage: "lost", contract_value: 90, updated_at: "2026-08-05" }),
  ];

  it("behaves the same way as Won", () => {
    expect(lostValue(rows, SNAPSHOT).value).toBe(100);
    expect(lostValue(rows, MONTH).value).toBe(10);
    expect(lostValue(rows, MONTH).caveat?.key).toBe("cav_lost_undated");
  });
});

describe("Win rate with undated closures", () => {
  it("reports what the rate could not include", () => {
    const k = winRate(
      [
        opp({ sales_stage: "won", won_at: "2026-08-05" }),
        opp({ sales_stage: "lost", lost_at: "2026-08-06" }),
        opp({ sales_stage: "won", updated_at: "2026-08-05" }),
      ],
      MONTH,
    );
    expect(k.value).toBe(50);
    expect(k.caveat).toEqual({ key: "cav_closed_undated", params: { count: 1 } });
  });

  it("counts every closure when no period is applied", () => {
    const k = winRate(
      [opp({ sales_stage: "won" }), opp({ sales_stage: "lost" })],
      SNAPSHOT,
    );
    expect(k.value).toBe(50);
    expect(k.caveat).toBeUndefined();
  });
});
