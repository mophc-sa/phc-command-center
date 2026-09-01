// =============================================================================
// A wall board is the easiest surface in the system to lie from.
//
// Nobody audits it. It hangs on a wall, nobody clicks it, and the one person
// who reads it is the one person who acts on it. Every case below is about
// refusing to print a number rather than printing a comfortable one.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  computePulse,
  computeStanding,
  computeTeam,
  displayLabel,
  freshnessOf,
  monthBounds,
  compactValue,
  splitCompact,
  yearOnYear,
  wonTrend,
  yearProgress,
  type BoardOpp,
} from "@/lib/board-metrics";

const NOW = new Date("2026-08-31T09:00:00Z");

const opp = (o: Partial<BoardOpp>): BoardOpp => ({
  id: Math.random().toString(36).slice(2),
  owner_id: null,
  stage: "qualification",
  sales_stage: "jih",
  contract_value: null,
  quotation_value: null,
  estimated_value_max: null,
  ...o,
});

describe("the month window", () => {
  it("is half-open, so a deal won at midnight on the 1st lands in one month only", () => {
    expect(monthBounds(NOW)).toEqual({ start: "2026-08-01", end: "2026-09-01" });
  });

  it("crosses a year boundary without losing December", () => {
    expect(monthBounds(new Date("2026-01-15T00:00:00Z")).start).toBe("2026-01-01");
  });
});

describe("the pulse counts what is actually waiting", () => {
  it("reports no oldest-approval age when nothing is waiting", () => {
    // Math.max of an empty list is -Infinity, which renders as a number and
    // would put "-Infinity days" on an office wall.
    const p = computePulse({
      approvalsPendingAt: [],
      followUpDueDates: [],
      quotationDueDates: [],
      tendersNeedingReview: 0,
      inboxUnclassified: 0,
      now: NOW,
    });
    expect(p.oldestApprovalDays).toBeNull();
    expect(p.approvalsPending).toBe(0);
  });

  it("ages the oldest approval, not the newest", () => {
    const p = computePulse({
      approvalsPendingAt: ["2026-08-28T09:00:00Z", "2026-08-24T09:00:00Z"],
      followUpDueDates: [],
      quotationDueDates: [],
      tendersNeedingReview: 0,
      inboxUnclassified: 0,
      now: NOW,
    });
    expect(p.approvalsPending).toBe(2);
    expect(p.oldestApprovalDays).toBe(7);
  });

  it("overdue means before today, and today is not overdue", () => {
    const p = computePulse({
      approvalsPendingAt: [],
      followUpDueDates: ["2026-08-30", "2026-08-31", "2026-09-02", null],
      quotationDueDates: [],
      tendersNeedingReview: 0,
      inboxUnclassified: 0,
      now: NOW,
    });
    expect(p.followUpsOverdue).toBe(1);
  });

  it("'due soon' is the next seven days — not everything in the future", () => {
    const p = computePulse({
      approvalsPendingAt: [],
      followUpDueDates: [],
      quotationDueDates: ["2026-08-31", "2026-09-07", "2026-09-08", "2026-08-30"],
      tendersNeedingReview: 0,
      inboxUnclassified: 0,
      now: NOW,
    });
    // today and +7 count; +8 is beyond, and yesterday is overdue, not soon.
    expect(p.quotationsDueSoon).toBe(2);
  });

  it("delegates the ninety-day rule instead of re-deriving it", () => {
    // The rule (age from submission, falling back to received; terminal stages
    // exempt) belongs to `requiresConversionReview` in dashboard-helpers. The
    // board takes the count. A second implementation here is exactly how the
    // wall and the Tenders page begin disagreeing about the same tender.
    const p = computePulse({
      approvalsPendingAt: [],
      followUpDueDates: [],
      quotationDueDates: [],
      tendersNeedingReview: 3,
      inboxUnclassified: 0,
      now: NOW,
    });
    expect(p.tendersNeedingReview).toBe(3);
  });
});

describe("standing refuses to invent a rate", () => {
  it("win rate is null when nothing has been decided", () => {
    // Not 0%. A rate with no denominator is unanswerable, and "0%" on a wall
    // reads as "we lose everything".
    const s = computeStanding([opp({ sales_stage: "jih" })], NOW);
    expect(s.winRate).toBeNull();
  });

  it("win rate divides wins by decided deals, ignoring the open ones", () => {
    const s = computeStanding(
      [
        opp({ sales_stage: "won", won_at: "2026-08-10", contract_value: 100 }),
        opp({ sales_stage: "lost" }),
        opp({ sales_stage: "lost" }),
        opp({ sales_stage: "jih" }),
      ],
      NOW,
    );
    expect(s.winRate).toBeCloseTo(1 / 3, 6);
  });

  it("counts opportunities carrying no value instead of treating them as zero", () => {
    // A deal with no figure is not a deal worth nothing. The board prints the
    // count so a small total is read as incomplete, not as bad news.
    const s = computeStanding(
      [opp({ sales_stage: "jih", contract_value: 500 }), opp({ sales_stage: "jih" })],
      NOW,
    );
    expect(s.openTotal).toBe(500);
    expect(s.openCount).toBe(2);
    expect(s.openUnvalued).toBe(1);
  });

  it("only this month's wins count as this month's wins", () => {
    const s = computeStanding(
      [
        opp({ sales_stage: "won", won_at: "2026-08-05", contract_value: 300 }),
        opp({ sales_stage: "won", won_at: "2026-07-31", contract_value: 999 }),
      ],
      NOW,
    );
    expect(s.wonThisMonth).toBe(300);
    expect(s.wonThisMonthCount).toBe(1);
  });

  it("composition shares sum to one, and are zero when nothing is valued", () => {
    const valued = computeStanding(
      [
        opp({ sales_stage: "jih", contract_value: 300 }),
        opp({ sales_stage: "under_negotiation", contract_value: 100 }),
      ],
      NOW,
    );
    const total = valued.composition.reduce((a, s) => a + s.share, 0);
    expect(total).toBeCloseTo(1, 6);

    const unvalued = computeStanding([opp({ sales_stage: "jih" })], NOW);
    expect(unvalued.composition.every((s) => s.share === 0)).toBe(true);
  });

  it("late-stage exposure is the committed-and-still-losable money", () => {
    const s = computeStanding(
      [
        opp({ sales_stage: "rfq_received", contract_value: 1000 }),
        opp({ sales_stage: "verbally_awarded", contract_value: 400 }),
        opp({ sales_stage: "contract_signed", contract_value: 600 }),
      ],
      NOW,
    );
    expect(s.lateStageExposure).toBe(1000);
    expect(s.openTotal).toBe(2000);
  });
});

describe("the team table", () => {
  const targets = new Map([["u1", 1000]]);
  const labels = new Map([
    ["u1", "AK"],
    ["u2", "FA"],
  ]);

  it("shows no achievement for a person with no target", () => {
    // Rather than 0%, which reads as failure when the truth is that nobody
    // set them a number.
    const rows = computeTeam(
      [opp({ owner_id: "u2", sales_stage: "won", won_at: "2026-08-04", contract_value: 500 })],
      targets,
      labels,
      NOW,
    );
    const u2 = rows.find((r) => r.ownerId === "u2");
    expect(u2?.won).toBe(500);
    expect(u2?.target).toBeNull();
    expect(u2?.achievement).toBeNull();
  });

  it("computes achievement against the target when there is one", () => {
    const rows = computeTeam(
      [opp({ owner_id: "u1", sales_stage: "won", won_at: "2026-08-04", contract_value: 250 })],
      targets,
      labels,
      NOW,
    );
    expect(rows.find((r) => r.ownerId === "u1")?.achievement).toBeCloseTo(0.25, 6);
  });

  it("keeps a person who has a target but no wins yet", () => {
    // Dropping them would quietly flatter the board.
    const rows = computeTeam([], targets, labels, NOW);
    expect(rows.map((r) => r.ownerId)).toContain("u1");
    expect(rows.find((r) => r.ownerId === "u1")?.achievement).toBe(0);
  });
});

describe("names disclose as little as the team can still read", () => {
  it("keeps a single name whole and initialises the rest", () => {
    expect(displayLabel("Omar")).toBe("Omar");
    expect(displayLabel("Faisal Abdelkhader")).toBe("FA");
    expect(displayLabel("  Abdelrahman   Jarrah  ")).toBe("AJ");
  });

  it("never renders an empty label", () => {
    expect(displayLabel(null)).toBe("—");
    expect(displayLabel("   ")).toBe("—");
  });
});

describe("the board admits when it has stopped knowing", () => {
  const POLL = 60_000;

  it("is stale before the first successful fetch", () => {
    // Not "live with zeros". A board that has never loaded must not look loaded.
    expect(freshnessOf(null, 1_000_000, POLL)).toBe("stale");
  });

  it("one missed poll is a blip, three is a problem", () => {
    const t = 1_000_000;
    expect(freshnessOf(t, t + POLL, POLL)).toBe("live");
    expect(freshnessOf(t, t + POLL * 3, POLL)).toBe("slow");
    expect(freshnessOf(t, t + POLL * 5, POLL)).toBe("stale");
  });
});

describe("the trend gives a total its direction", () => {
  it("returns one bucket per month, oldest first, including empty ones", () => {
    // An empty month dropped rather than drawn would flatter the slope.
    const t = wonTrend([], NOW, 6);
    expect(t.map((p) => p.key)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(t.every((p) => p.value === 0 && p.count === 0)).toBe(true);
  });

  it("buckets a win into the month it was won, not the month it was created", () => {
    const t = wonTrend(
      [
        opp({ sales_stage: "won", won_at: "2026-06-20", created_at: "2026-01-01", contract_value: 700 }),
        opp({ sales_stage: "won", won_at: "2026-08-02", contract_value: 300 }),
        opp({ sales_stage: "jih", contract_value: 999 }),
      ],
      NOW,
      6,
    );
    expect(t.find((p) => p.key === "2026-06")?.value).toBe(700);
    expect(t.find((p) => p.key === "2026-08")?.value).toBe(300);
    expect(t.reduce((a, p) => a + p.count, 0)).toBe(2);
  });

  it("crosses a year boundary without collapsing two Januaries", () => {
    const t = wonTrend([], new Date("2026-02-10T00:00:00Z"), 4);
    expect(t.map((p) => p.key)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("year progress is judged against pace, not against 100%", () => {
  it("has no ratio when no annual target exists", () => {
    const p = yearProgress(
      [opp({ sales_stage: "won", won_at: "2026-05-01", contract_value: 100 })],
      null,
      NOW,
    );
    expect(p.won).toBe(100);
    expect(p.ratio).toBeNull();
  });

  it("counts the whole year to date, not just this month", () => {
    const p = yearProgress(
      [
        opp({ sales_stage: "won", won_at: "2026-02-01", contract_value: 400 }),
        opp({ sales_stage: "won", won_at: "2026-08-01", contract_value: 600 }),
        opp({ sales_stage: "won", won_at: "2025-12-31", contract_value: 999 }),
      ],
      2000,
      NOW,
    );
    expect(p.won).toBe(1000);
    expect(p.ratio).toBeCloseTo(0.5, 6);
  });

  it("reports how much of the year has elapsed, so 40% can be read as ahead or behind", () => {
    const jan = yearProgress([], 100, new Date("2026-01-15T00:00:00Z"));
    const nov = yearProgress([], 100, new Date("2026-11-15T00:00:00Z"));
    expect(jan.yearElapsed).toBeLessThan(0.06);
    expect(nov.yearElapsed).toBeGreaterThan(0.85);
  });
});

describe("big money reads as a magnitude, not a row of digits", () => {
  it("compacts millions and billions, keeping one useful decimal", () => {
    expect(compactValue(633_705_805, "en")).toBe("633.7M");
    expect(compactValue(2_890_795, "en")).toBe("2.9M");
    expect(compactValue(1_087_086_158, "en")).toBe("1.09B");
  });

  it("keeps small figures exact, where rounding would be all the reader sees", () => {
    expect(compactValue(940, "en")).toBe("940");
    expect(compactValue(0, "en")).toBe("0");
  });

  it("returns null rather than a zero for an absent value", () => {
    expect(compactValue(null, "en")).toBeNull();
    expect(compactValue(undefined, "en")).toBeNull();
  });

  it("uses Western digits in Arabic, as the rest of the app does", () => {
    expect(compactValue(633_705_805, "ar")).toBe("633.7 مليون");
  });
});

describe("open pipeline is bounded by a window, and says what it left out", () => {
  const old = opp({ sales_stage: "jih", created_at: "2023-04-01", contract_value: 900 });
  const recent = opp({ sales_stage: "jih", created_at: "2026-05-01", contract_value: 100 });

  it("excludes a deal that arrived before the window", () => {
    // A 2023 proposal nobody ever answered sits in an open stage because
    // nobody closed it -- a record-keeping fact, not a live opportunity.
    const s = computeStanding([old, recent], NOW, 12);
    expect(s.openTotal).toBe(100);
    expect(s.openCount).toBe(1);
  });

  it("reports what it excluded instead of dropping it silently", () => {
    const s = computeStanding([old, recent], NOW, 12);
    expect(s.openExcludedCount).toBe(1);
    expect(s.openExcludedValue).toBe(900);
  });

  it("keeps a deal with no arrival date at all", () => {
    // 88 imported rows carry no received date. Excluding them would lose live
    // work on the strength of a blank cell.
    const s = computeStanding([opp({ sales_stage: "jih", contract_value: 50 })], NOW, 12);
    expect(s.openTotal).toBe(50);
    expect(s.openExcludedCount).toBe(0);
  });

  it("keeps the excluded ones out of the ladder too, so it sums to the headline", () => {
    const s = computeStanding([old, recent], NOW, 12);
    const laddered = s.composition.reduce((a, c) => a + c.value, 0);
    expect(laddered).toBe(s.openTotal);
  });

  it("never excludes a win or a loss -- the window is about open work only", () => {
    const s = computeStanding(
      [
        opp({ sales_stage: "won", won_at: "2026-08-02", created_at: "2022-01-01", contract_value: 700 }),
        opp({ sales_stage: "lost", created_at: "2022-01-01" }),
      ],
      NOW,
      12,
    );
    expect(s.wonThisMonth).toBe(700);
    expect(s.winRate).toBeCloseTo(0.5, 6);
    expect(s.openExcludedCount).toBe(0);
  });
});

describe("a zero and an absent input are different facts", () => {
  it("returns null when NO quotation carries a validity date", () => {
    // Production state today: not one of 45 quotations has valid_until. The
    // board printed "0" here for a week, which reads as "nothing due" when the
    // truth is "nobody records expiry" -- and those send a reader to two
    // different places. This board exists to keep them apart.
    const p = computePulse({
      approvalsPendingAt: [],
      followUpDueDates: [],
      quotationDueDates: [null, null, null],
      tendersNeedingReview: 0,
      inboxUnclassified: 0,
      now: NOW,
    });
    expect(p.quotationsDueSoon).toBeNull();
    expect(p.quotationsWithDates).toBe(0);
  });

  it("returns a real zero when dates exist and none fall in the window", () => {
    const p = computePulse({
      approvalsPendingAt: [],
      followUpDueDates: [],
      quotationDueDates: ["2026-12-01", "2026-11-01"],
      tendersNeedingReview: 0,
      inboxUnclassified: 0,
      now: NOW,
    });
    expect(p.quotationsDueSoon).toBe(0);
    expect(p.quotationsWithDates).toBe(2);
  });
});

describe("a headline splits its number from its unit", () => {
  it("returns the two parts, not a glued string", () => {
    expect(splitCompact(7_909_835, "ar")).toEqual({ n: "7.9", unit: "مليون ر.س" });
    expect(splitCompact(633_705_805, "en")).toEqual({ n: "633.7", unit: "SAR m" });
  });

  it("keeps small figures whole", () => {
    expect(splitCompact(940, "en")).toEqual({ n: "940", unit: "SAR" });
  });

  it("returns null for an absent value rather than a zero", () => {
    expect(splitCompact(null, "en")).toBeNull();
  });
});

describe("year on year compares the same slice of the calendar", () => {
  it("measures last year to the same day, not its full total", () => {
    // Against a full prior year, every January looks catastrophic and every
    // December looks triumphant. Only the same window is a fair comparison.
    const y = yearOnYear(
      [
        opp({ sales_stage: "won", won_at: "2026-03-01", contract_value: 100 }),
        opp({ sales_stage: "won", won_at: "2025-03-01", contract_value: 200 }),
        opp({ sales_stage: "won", won_at: "2025-11-01", contract_value: 9999 }), // outside the window
      ],
      NOW,
    );
    expect(y.thisYear).toBe(100);
    expect(y.priorYear).toBe(200);
    expect(y.ratio).toBeCloseTo(-0.5, 6);
  });

  it("gives no ratio when last year's window was empty", () => {
    // Growth from zero is a start, not a percentage.
    const y = yearOnYear([opp({ sales_stage: "won", won_at: "2026-03-01", contract_value: 100 })], NOW);
    expect(y.thisYear).toBe(100);
    expect(y.ratio).toBeNull();
  });
});
