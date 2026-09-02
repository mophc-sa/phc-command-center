// =============================================================================
// The review asked for a weighted forecast, coverage, probability and a
// 30/60/90 outlook. None of those inputs exists on a single production row.
//
// So most of what follows is about the discipline that makes the rest usable:
// refusing to answer, in a way that names what is missing. A screen on a wall
// cannot be interrogated, and a confident zero there is worse than a blank.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  attentionItems,
  hotOpportunities,
  horizonForecast,
  pipelineBuckets,
  pipelineCoverage,
  weightedPipeline,
  upcoming,
  movement,
  wireItems,
  sharedReason,
  oldestOverdueDays,
  pulseSentences,
  type IntelOpp,
} from "@/lib/board-intel";

const NOW = new Date("2026-08-31T09:00:00Z");

const opp = (o: Partial<IntelOpp> & { id: string }): IntelOpp => ({
  owner_id: null,
  stage: "qualification",
  sales_stage: "jih",
  contract_value: null,
  quotation_value: null,
  estimated_value_max: null,
  ...o,
});

describe("the pipeline is split by commercial position", () => {
  it("keeps JIH in open pipeline, because JIH is the CONTRACTOR's situation", () => {
    // The brief assumed JIH means awarded to us and should leave open pipeline.
    // In this system it means the contractor already holds the main project --
    // the opposite of Tender, where they are still bidding. Moving it out would
    // understate the open book by most of its value.
    const b = pipelineBuckets([opp({ id: "a", sales_stage: "jih", contract_value: 1000 })]);
    expect(b.find((x) => x.key === "open")?.value).toBe(1000);
    expect(b.find((x) => x.key === "contractedBacklog")?.value).toBe(0);
  });

  it("separates a handshake from a signature", () => {
    // "Verbally awarded" is won and still losable; a signed contract is not.
    // One bucket for both would let a forecast count money nobody can invoice.
    const b = pipelineBuckets([
      opp({ id: "a", sales_stage: "verbally_awarded", contract_value: 400 }),
      opp({ id: "b", sales_stage: "contract_signed", contract_value: 600 }),
    ]);
    expect(b.find((x) => x.key === "awardedPendingContract")?.value).toBe(400);
    expect(b.find((x) => x.key === "contractedBacklog")?.value).toBe(600);
  });

  it("counts deals carrying no value instead of treating them as worthless", () => {
    const b = pipelineBuckets([
      opp({ id: "a", sales_stage: "jih", contract_value: 500 }),
      opp({ id: "b", sales_stage: "jih" }),
    ]);
    const open = b.find((x) => x.key === "open")!;
    expect(open.value).toBe(500);
    expect(open.count).toBe(2);
    expect(open.unvalued).toBe(1);
  });
});

describe("weighted pipeline refuses to be zero", () => {
  it("says no probability is entered rather than returning 0", () => {
    // "SAR 0 weighted" reads as "nothing is likely to close". The truth is
    // "nobody has said how likely anything is". Different facts.
    const w = weightedPipeline([
      opp({ id: "a", sales_stage: "jih", contract_value: 1000 }),
      opp({ id: "b", sales_stage: "under_negotiation", contract_value: 2000 }),
    ]);
    expect(w.value).toBeNull();
    expect(w.state).toBe("no_data");
    expect(w.missing).toBe(2);
    expect(w.reasonEn).toContain("No probability");
  });

  it("weights by probability once one exists, and reports the rest as missing", () => {
    const w = weightedPipeline([
      opp({ id: "a", sales_stage: "jih", contract_value: 1000, human_win_probability: 50 }),
      opp({ id: "b", sales_stage: "jih", contract_value: 4000 }),
    ]);
    expect(w.state).toBe("ok");
    expect(w.value).toBe(500);
    expect(w.missing).toBe(1);
  });

  it("does not count a won or lost deal as pipeline", () => {
    const w = weightedPipeline([
      opp({ id: "a", sales_stage: "won", contract_value: 9999, human_win_probability: 100 }),
    ]);
    expect(w.state).toBe("no_data");
  });
});

describe("coverage tells a missing target apart from a missing probability", () => {
  it("calls an absent target a configuration gap", () => {
    // Sending someone to enter probabilities when the real gap is a target row
    // wastes the one action the message was supposed to prompt.
    const c = pipelineCoverage({ value: 1000, state: "ok" }, null);
    expect(c.state).toBe("not_configured");
    expect(c.reasonEn).toContain("target");
  });

  it("passes the data gap through when the weighting could not be computed", () => {
    const c = pipelineCoverage(
      { value: null, state: "no_data", reasonEn: "No probability entered on any of 5 open deals" },
      25_000_000,
    );
    expect(c.state).toBe("no_data");
    expect(c.reasonEn).toContain("No probability");
  });

  it("divides when both sides are real", () => {
    expect(pipelineCoverage({ value: 50, state: "ok" }, 25).value).toBe(2);
  });
});

describe("needs attention is one row per opportunity, ranked by consequence", () => {
  const fu = (opportunity_id: string, due_date: string) => ({ opportunity_id, due_date });

  it("merges two overdue follow-ups on one project into one row", () => {
    // The old list printed the same project twice and buried everything else.
    const items = attentionItems(
      [opp({ id: "a", project_name: "MURABBA", sales_stage: "jih", contract_value: 1_000_000 })],
      [fu("a", "2026-08-08"), fu("a", "2026-08-20")],
      NOW,
    );
    expect(items.length).toBe(1);
    expect(items[0].overdueCount).toBe(2);
    expect(items[0].worstAgeDays).toBe(23);
  });

  it("ranks an 8M deal two days late above a 100K deal ten days late", () => {
    // The review's own example, and the reason date-sorting is wrong.
    const items = attentionItems(
      [
        opp({ id: "big", project_name: "BIG", sales_stage: "jih", contract_value: 8_000_000 }),
        opp({ id: "small", project_name: "SMALL", sales_stage: "jih", contract_value: 100_000 }),
      ],
      [fu("big", "2026-08-29"), fu("small", "2026-08-21")],
      NOW,
    );
    expect(items[0].opportunityId).toBe("big");
    expect(items[0].priority).toBe("critical");
  });

  it("weights a late-stage deal above an enquiry of the same size and age", () => {
    const items = attentionItems(
      [
        opp({ id: "late", sales_stage: "under_negotiation", contract_value: 1_000_000 }),
        opp({ id: "early", sales_stage: "rfq_received", contract_value: 1_000_000 }),
      ],
      [fu("late", "2026-08-25"), fu("early", "2026-08-25")],
      NOW,
    );
    expect(items[0].opportunityId).toBe("late");
  });

  it("never lists a won or lost deal", () => {
    const items = attentionItems(
      [opp({ id: "a", sales_stage: "won" }), opp({ id: "b", sales_stage: "lost" })],
      [fu("a", "2026-01-01"), fu("b", "2026-01-01")],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("does not flag 'no next action' when NO deal has one", () => {
    // The column is empty on all 739 rows. Flagging every one turns the list
    // into noise and buries the deals that have a real, specific problem --
    // it is one configuration gap, not 739 individual failures.
    const items = attentionItems(
      [
        opp({ id: "a", sales_stage: "jih", contract_value: 100 }),
        opp({ id: "b", sales_stage: "jih", contract_value: 100 }),
      ],
      [],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("does flag it once some deals have a next action and one does not", () => {
    const items = attentionItems(
      [
        opp({ id: "a", sales_stage: "jih", contract_value: 100, next_action: "Call client" }),
        opp({ id: "b", sales_stage: "jih", contract_value: 100 }),
      ],
      [],
      NOW,
    );
    expect(items.map((i) => i.opportunityId)).toEqual(["b"]);
    expect(items[0].reasons).toContain("no_next_action");
  });

  it("treats a long silence as stalled, and says how long", () => {
    const items = attentionItems(
      [opp({ id: "a", sales_stage: "jih", contract_value: 500_000, last_activity_at: "2026-08-10" })],
      [],
      NOW,
    );
    expect(items[0].reasons).toContain("stalled");
    expect(items[0].worstAgeDays).toBe(21);
  });
});

describe("top opportunities", () => {
  it("ranks open deals by value and carries no invented probability", () => {
    const hot = hotOpportunities([
      opp({ id: "a", project_name: "A", sales_stage: "jih", contract_value: 1000 }),
      opp({ id: "b", project_name: "B", sales_stage: "under_negotiation", contract_value: 3000 }),
      opp({ id: "c", project_name: "C", sales_stage: "won", contract_value: 9000 }),
    ]);
    expect(hot.map((h) => h.id)).toEqual(["b", "a"]);
    expect(hot[0].probability).toBeNull();
  });

  it("leaves out a deal with no value rather than sorting it as zero", () => {
    const hot = hotOpportunities([opp({ id: "a", sales_stage: "jih" })]);
    expect(hot).toEqual([]);
  });
});

describe("the 30/60/90 outlook", () => {
  const d = (days: number) =>
    new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);

  it("refuses all three and names BOTH missing inputs when neither exists", () => {
    // Three confident zeros in a row is the worst thing this screen could show,
    // because nobody standing in front of a wall can ask it why.
    const f = horizonForecast([opp({ id: "a", sales_stage: "jih", contract_value: 1000 })], NOW);
    for (const h of [f.d30, f.d60, f.d90]) {
      expect(h.value).toBeNull();
      expect(h.state).toBe("no_data");
      expect(h.reasonEn).toContain("neither is entered");
    }
  });

  it("names only what is actually missing once one input arrives", () => {
    // The old text said "neither is entered" unconditionally, so the moment a
    // probability was filled in the board would have gone on reporting that
    // none existed -- the precise failure this module exists to avoid.
    const withProb = horizonForecast(
      [opp({ id: "a", sales_stage: "jih", contract_value: 1000, human_win_probability: 50 })],
      NOW,
    );
    expect(withProb.d30.reasonEn).toContain("expected close date");
    expect(withProb.d30.reasonEn).not.toContain("neither");

    const withDate = horizonForecast(
      [opp({ id: "a", sales_stage: "jih", contract_value: 1000, expected_contract_date: d(10) })],
      NOW,
    );
    expect(withDate.d30.reasonEn).toContain("probability");
    expect(withDate.d30.reasonEn).not.toContain("neither");
  });

  it("weights value by probability and nests the three windows", () => {
    // Cumulative, not partitioned: what closes inside 30 days also closes
    // inside 60. A reader comparing 30 to 90 is asking "how much more".
    const f = horizonForecast(
      [
        opp({ id: "a", sales_stage: "jih", contract_value: 1_000_000, human_win_probability: 50, expected_contract_date: d(10) }),
        opp({ id: "b", sales_stage: "jih", contract_value: 2_000_000, human_win_probability: 25, expected_contract_date: d(45) }),
        opp({ id: "c", sales_stage: "jih", contract_value: 4_000_000, human_win_probability: 10, expected_contract_date: d(80) }),
      ],
      NOW,
    );
    expect(f.d30.value).toBe(500_000);
    expect(f.d60.value).toBe(1_000_000);
    expect(f.d90.value).toBe(1_400_000);
  });

  it("keeps a deal whose close date already slipped in the nearest window", () => {
    // It has not left the pipeline, and dropping it would quietly shrink the
    // horizon people actually act on.
    const f = horizonForecast(
      [opp({ id: "a", sales_stage: "jih", contract_value: 1_000_000, human_win_probability: 40, expected_contract_date: d(-20) })],
      NOW,
    );
    expect(f.d30.value).toBe(400_000);
  });

  it("says how many open deals it could not use", () => {
    const f = horizonForecast(
      [
        opp({ id: "a", sales_stage: "jih", contract_value: 1_000_000, human_win_probability: 50, expected_contract_date: d(5) }),
        opp({ id: "b", sales_stage: "jih", contract_value: 9_000_000 }),
      ],
      NOW,
    );
    expect(f.d30.state).toBe("ok");
    expect(f.d30.missing).toBe(1);
  });

  it("does not count a deal that carries no value, and says so", () => {
    const f = horizonForecast(
      [
        opp({ id: "a", sales_stage: "jih", contract_value: 1_000_000, human_win_probability: 50, expected_contract_date: d(5) }),
        opp({ id: "b", sales_stage: "jih", human_win_probability: 90, expected_contract_date: d(5) }),
      ],
      NOW,
    );
    expect(f.d30.value).toBe(500_000);
    expect(f.d30.reasonEn).toContain("no value");
  });

  it("ignores next_action_due, which is not a close date", () => {
    // "Call them Tuesday" is a next action. A forecast built on it puts a deal
    // in the 30-day column because somebody scheduled a phone call.
    const f = horizonForecast(
      [opp({ id: "a", sales_stage: "jih", contract_value: 1_000_000, human_win_probability: 50, next_action_due: d(5) })],
      NOW,
    );
    expect(f.d30.state).toBe("no_data");
    expect(f.d30.reasonEn).toContain("expected close date");
  });
});

describe("today and the next seven days", () => {
  it("returns null when nothing at all is scheduled ahead", () => {
    // Production state: every follow-up in the system is already overdue.
    // "0 / 0 / 0" reads as a clear week; an empty calendar is the opposite
    // problem, and a wall cannot be asked which one it means.
    expect(upcoming(["2026-08-01", "2026-08-20", null], NOW)).toBeNull();
  });

  it("splits today, tomorrow and the rest of the week without double-counting", () => {
    const h = upcoming(
      ["2026-08-31", "2026-09-01", "2026-09-04", "2026-09-30", "2026-08-01"],
      NOW,
    )!;
    expect(h.todayCount).toBe(1);
    expect(h.tomorrowCount).toBe(1);
    expect(h.weekCount).toBe(1);
  });
});

describe("what moved", () => {
  it("does not count imported rows as new business", () => {
    // 88 rows arrived with no received date and were stamped with the import
    // time. Counting them as "new this week" reports record-keeping as selling.
    const imported = {
      ...opp({ id: "i", created_at: "2026-08-31" }),
      extra_data: { source: "PHC Quotation List 2022-2026" },
    } as IntelOpp;
    const real = opp({ id: "r", created_at: "2026-08-31" });
    const m = movement([imported, real], [], NOW, 7, {
      importedSource: "PHC Quotation List 2022-2026",
    });
    expect(m.newDeals).toBe(1);
  });

  it("counts wins by when they were won, and carries their value", () => {
    const m = movement(
      [opp({ id: "a", sales_stage: "won", won_at: "2026-08-30T10:00:00Z", contract_value: 2_900_000 })],
      [],
      NOW,
      7,
    );
    expect(m.won).toBe(1);
    expect(m.wonValue).toBe(2_900_000);
  });

  it("counts stage moves inside the window only", () => {
    const m = movement([], [{ changed_at: "2026-08-30T10:00:00Z" }, { changed_at: "2026-01-01T00:00:00Z" }], NOW, 7);
    expect(m.advanced).toBe(1);
  });
});

describe("the news wire", () => {
  const M = (o: Partial<import("@/lib/board-intel").WireInput> = {}) => ({
    attention: [],
    hot: [],
    movement: { advanced: 0, won: 0, wonValue: 0, lost: 0, newDeals: 0 },
    year: { ratio: null, target: null },
    upcoming: null,
    ...o,
  });
  const sar = (n: number) => `SAR ${n}`;

  it("leads with what is late and large, before what is merely big", () => {
    // A ticker is read in fragments. The fragment most likely to be caught has
    // to be the one that costs money if it is missed.
    const w = wireItems(
      M({
        attention: [
          { opportunityId: "a", projectName: "MURABBA", client: null, ownerId: null, value: 8_000_000,
            reasons: ["overdue_follow_up"], worstAgeDays: 12, overdueCount: 2, score: 20, priority: "critical" },
        ],
        hot: [{ id: "b", projectName: "BIGGER", client: null, ownerId: null, value: 99_000_000, stage: "jih", probability: null }],
      }),
      "en",
      sar,
    );
    expect(w[0]).toContain("MURABBA");
    expect(w[0]).toContain("12 days late");
    expect(w[1]).toContain("BIGGER");
  });

  it("says something rather than nothing when the board knows nothing", () => {
    // A blank strip on a wall reads as a broken screen; a strip of dashes reads
    // as bad news. Neither is what an empty round means.
    expect(wireItems(M(), "ar", sar)).toEqual(["لا مستجدّات في هذه الجولة"]);
    expect(wireItems(M(), "en", sar)).toEqual(["Nothing new this round"]);
  });

  it("omits a movement line entirely rather than printing a zero", () => {
    const w = wireItems(M({ movement: { advanced: 0, won: 2, wonValue: 5_000, lost: 1, newDeals: 0 } }), "en", sar);
    expect(w.some((x) => x.includes("Won since yesterday"))).toBe(true);
    expect(w.some((x) => x.includes("New opportunities"))).toBe(false);
    expect(w.some((x) => x.includes("Advanced"))).toBe(false);
  });

  it("carries no target line when no target is set", () => {
    expect(wireItems(M({ year: { ratio: null, target: null } }), "en", sar)
      .some((x) => x.includes("Target achievement"))).toBe(false);
    expect(wireItems(M({ year: { ratio: 0.4, target: 100 } }), "en", sar)
      .some((x) => x.includes("Target achievement 40% of SAR 100"))).toBe(true);
  });

  it("names a critical deal that carries no value without inventing one", () => {
    const w = wireItems(
      M({
        attention: [
          { opportunityId: "a", projectName: "NO VALUE", client: null, ownerId: null, value: null,
            reasons: ["stalled"], worstAgeDays: 40, overdueCount: 0, score: 9, priority: "critical" },
        ],
      }),
      "en",
      sar,
    );
    expect(w[0]).toBe("⚠ NO VALUE · 40 days late");
  });
});

describe("one reason printed once", () => {
  const F = (state: "ok" | "no_data" | "not_configured", ar: string, en: string, value: number | null = null) =>
    ({ value, state, reasonAr: ar, reasonEn: en }) as import("@/lib/board-intel").Figure;

  it("collapses three identical reasons into one line", () => {
    const same = F("no_data", "لا احتمال", "No probability");
    expect(sharedReason([same, same, same], "ar")).toBe("لا احتمال");
    expect(sharedReason([same, same, same], "en")).toBe("No probability");
  });

  it("refuses to collapse when the reasons differ", () => {
    // Two horizons failing for two causes is two facts. One line would name a
    // situation that does not exist.
    expect(sharedReason(
      [F("no_data", "لا احتمال", "No probability"), F("not_configured", "لا هدف", "No target"), F("no_data", "لا احتمال", "No probability")],
      "en",
    )).toBeNull();
  });

  it("refuses to collapse when any horizon can actually be computed", () => {
    // A shared footnote under a real number reads as applying to it too.
    expect(sharedReason(
      [F("ok", "", "", 500), F("no_data", "لا احتمال", "No probability"), F("no_data", "لا احتمال", "No probability")],
      "en",
    )).toBeNull();
  });

  it("refuses to collapse when a reason is missing entirely", () => {
    expect(sharedReason([F("no_data", "", ""), F("no_data", "س", "x")], "en")).toBeNull();
    expect(sharedReason([], "en")).toBeNull();
  });
});

describe("the age of the oldest overdue follow-up", () => {
  it("reports the worst, not the first or the average", () => {
    expect(oldestOverdueDays(["2026-08-29", "2026-03-24", "2026-08-30"], NOW)).toBe(160);
  });

  it("ignores what is not yet due, and says null when nothing is late", () => {
    // Zero would read as "the oldest is today". Nothing being late is a
    // different fact, and the chip prints no note rather than a false one.
    expect(oldestOverdueDays(["2026-09-30", "2026-12-01"], NOW)).toBeNull();
    expect(oldestOverdueDays([null, null], NOW)).toBeNull();
    expect(oldestOverdueDays([], NOW)).toBeNull();
  });
});

describe("new deals carry a value too", () => {
  it("sums what the new deals are worth, excluding imported rows from both", () => {
    // The tile printed a count with a blank line beneath it, which left its
    // content sitting 11.5px above its neighbours' -- and, more to the point,
    // said how many without saying how much.
    const m = movement(
      [
        opp({ id: "a", created_at: "2026-08-31", contract_value: 3_000_000 }),
        opp({ id: "b", created_at: "2026-08-31", contract_value: 1_000_000 }),
        { ...opp({ id: "i", created_at: "2026-08-31", contract_value: 9_000_000 }),
          extra_data: { source: "PHC Quotation List 2022-2026" } } as IntelOpp,
      ],
      [], NOW, 7, { importedSource: "PHC Quotation List 2022-2026" },
    );
    expect(m.newDeals).toBe(2);
    expect(m.newValue).toBe(4_000_000);
  });

  it("returns 0 when the new deals carry no value at all", () => {
    const m = movement([opp({ id: "a", created_at: "2026-08-31" })], [], NOW, 7);
    expect(m.newDeals).toBe(1);
    expect(m.newValue).toBe(0);
  });
});

describe("the pulse writes a briefing, and only from what it measured", () => {
  const sar = (n: number) => `SAR ${(n / 1e6).toFixed(1)}M`;
  const base = {
    criticalCount: 0, criticalValue: null, staleCount: 0, staleAfterDays: 7,
    weighted: { value: null, state: "no_data", reasonEn: "No probability entered" } as import("@/lib/board-intel").Figure,
    target: null, wonYtd: 0,
  };

  it("says what needs doing, with what it is worth", () => {
    const s = pulseSentences({ ...base, criticalCount: 3, criticalValue: 11_200_000 }, "en", sar);
    expect(s[0]).toBe("3 deals worth SAR 11.2M need action today.");
  });

  it("leaves out the value when nothing carries one", () => {
    // "3 deals worth SAR 0.0M" is a sentence that reads as a fact and is not.
    expect(pulseSentences({ ...base, criticalCount: 3 }, "en", sar)[0])
      .toBe("3 deals need action today.");
  });

  it("does not claim the forecast is short while it cannot be computed", () => {
    // The clause the reference design shows -- "the forecast is still below
    // what the annual target needs" -- asserts exactly what this board refuses
    // to assert everywhere else when no probability exists.
    const s = pulseSentences({ ...base, criticalCount: 1, target: 25_000_000 }, "en", sar);
    expect(s.join(" ")).not.toContain("below the annual target");
    expect(s.join(" ")).toContain("cannot be computed yet");
  });

  it("does say it once the forecast is real", () => {
    const s = pulseSentences({
      ...base, criticalCount: 1,
      weighted: { value: 18_400_000, state: "ok" },
      target: 25_000_000,
    }, "en", sar);
    expect(s.join(" ")).toContain("below the annual target");
  });

  it("does not call a forecast short when it is not", () => {
    const s = pulseSentences({
      ...base, criticalCount: 1,
      weighted: { value: 30_000_000, state: "ok" },
      target: 25_000_000,
    }, "en", sar);
    expect(s.join(" ")).toContain("at or above");
  });

  it("says nothing needs doing rather than filling the space", () => {
    // A panel that writes plausible prose about data it does not have is worse
    // than a blank one, because a blank one is obviously blank.
    expect(pulseSentences({ ...base, weighted: { value: null, state: "ok" } }, "en", sar))
      .toEqual(["Nothing needs action today."]);
  });

  it("counts one deal as a deal", () => {
    expect(pulseSentences({ ...base, criticalCount: 1 }, "en", sar)[0]).toContain("1 deal need");
  });
});
