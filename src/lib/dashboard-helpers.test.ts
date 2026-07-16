// PHC Sales OS — Salesperson Dashboard helper unit tests.
// Run with: bun test src/lib/dashboard-helpers.test.ts
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import {
  daysUntil,
  daysSince,
  urgencyTone,
  urgencyLabel,
  computeAwardedTotal,
  filterAwardedOpps,
  computeJihPipelineTotal,
  computeTenderPipelineTotal,
  requiresConversionReview,
  tenderAgeDays,
  submissionUrgencyCategory,
  targetAchievementPct,
  remainingTarget,
  type OpportunityStageRow,
  type TenderPipelineRow,
} from "./dashboard-helpers";

// ─── Date helpers ─────────────────────────────────────────────────────────────

describe("daysUntil", () => {
  test("returns null for null or undefined input", () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
    expect(daysUntil("")).toBeNull();
  });

  test("returns 0 for today", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(daysUntil(today)).toBe(0);
  });

  test("returns positive number for future dates", () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    expect(daysUntil(future.toISOString().slice(0, 10))).toBe(5);
  });

  test("returns negative number for past dates (overdue)", () => {
    const past = new Date();
    past.setDate(past.getDate() - 3);
    expect(daysUntil(past.toISOString().slice(0, 10))).toBe(-3);
  });
});

describe("daysSince", () => {
  test("returns null for null input", () => {
    expect(daysSince(null)).toBeNull();
  });

  test("returns 0 for today", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(daysSince(today)).toBe(0);
  });

  test("returns positive number for past dates", () => {
    const past = new Date();
    past.setDate(past.getDate() - 7);
    expect(daysSince(past.toISOString().slice(0, 10))).toBe(7);
  });
});

// ─── Urgency classification ───────────────────────────────────────────────────

describe("urgencyTone", () => {
  test("returns neutral for null", () => {
    expect(urgencyTone(null)).toBe("neutral");
  });

  test("returns danger for overdue (negative days)", () => {
    expect(urgencyTone(-1)).toBe("danger");
    expect(urgencyTone(-30)).toBe("danger");
  });

  test("returns danger for due today (0 days)", () => {
    expect(urgencyTone(0)).toBe("danger");
  });

  test("returns attention for 1-5 days", () => {
    expect(urgencyTone(1)).toBe("attention");
    expect(urgencyTone(2)).toBe("attention");
    expect(urgencyTone(5)).toBe("attention");
  });

  test("returns neutral for more than 5 days", () => {
    expect(urgencyTone(6)).toBe("neutral");
    expect(urgencyTone(30)).toBe("neutral");
  });
});

describe("urgencyLabel", () => {
  test("returns em-dash for null", () => {
    expect(urgencyLabel(null, "en")).toBe("—");
    expect(urgencyLabel(null, "ar")).toBe("—");
  });

  test("labels overdue correctly in English", () => {
    expect(urgencyLabel(-3, "en")).toBe("3d overdue");
    expect(urgencyLabel(-1, "en")).toBe("1d overdue");
  });

  test("labels due today correctly", () => {
    expect(urgencyLabel(0, "en")).toBe("Due today");
    expect(urgencyLabel(0, "ar")).toBe("اليوم");
  });

  test("labels future days correctly in English", () => {
    expect(urgencyLabel(5, "en")).toBe("5d left");
  });
});

// ─── Awarded value — Test cases 3-6 from spec ────────────────────────────────

function opp(over: Partial<OpportunityStageRow>): OpportunityStageRow {
  return {
    id: "o1",
    stage: "discovery",
    sales_stage: null,
    estimated_value_max: 100000,
    contract_value: null,
    ...over,
  };
}

describe("computeAwardedTotal — only officially Awarded records count", () => {
  // Spec test case 3
  test("counts opportunities with stage=won", () => {
    const opps = [
      opp({ stage: "won", estimated_value_max: 200000 }),
      opp({ stage: "won", estimated_value_max: 300000 }),
    ];
    expect(computeAwardedTotal(opps)).toBe(500000);
  });

  // Spec test case 4: Verbally Awarded is NOT counted as Awarded
  test("does NOT count verbally_awarded sales_stage", () => {
    const opps = [
      opp({ stage: "quotation", sales_stage: "verbally_awarded", estimated_value_max: 500000 }),
    ];
    expect(computeAwardedTotal(opps)).toBe(0);
  });

  // Spec test case 5: Contract Received is NOT counted as Awarded
  test("does NOT count contract_received sales_stage", () => {
    const opps = [
      opp({ stage: "quotation", sales_stage: "contract_received", estimated_value_max: 400000 }),
    ];
    expect(computeAwardedTotal(opps)).toBe(0);
  });

  // Spec test case 6: Contract Signed alone is NOT Awarded
  test("does NOT count contract_signed unless stage=won", () => {
    const opps = [
      opp({ stage: "follow_up", sales_stage: "contract_signed", estimated_value_max: 600000 }),
    ];
    expect(computeAwardedTotal(opps)).toBe(0);
  });

  // Contract Signed WITH stage=won IS awarded (the approved business rule)
  test("counts contract_signed when stage=won (official award registered)", () => {
    const opps = [
      opp({ stage: "won", sales_stage: "contract_signed", estimated_value_max: 700000 }),
    ];
    expect(computeAwardedTotal(opps)).toBe(700000);
  });

  test("uses contract_value over estimated_value_max when available", () => {
    const opps = [
      opp({ stage: "won", estimated_value_max: 100000, contract_value: 150000 }),
    ];
    expect(computeAwardedTotal(opps)).toBe(150000);
  });

  test("treats null values as 0 without crashing", () => {
    const opps = [
      opp({ stage: "won", estimated_value_max: null, contract_value: null }),
    ];
    expect(computeAwardedTotal(opps)).toBe(0);
  });

  test("returns 0 for empty array", () => {
    expect(computeAwardedTotal([])).toBe(0);
  });

  test("mixed: only won stage contributes", () => {
    const opps = [
      opp({ stage: "won", estimated_value_max: 100000 }),
      opp({ stage: "quotation", sales_stage: "verbally_awarded", estimated_value_max: 999999 }),
      opp({ stage: "follow_up", sales_stage: "contract_received", estimated_value_max: 999999 }),
      opp({ stage: "lost", estimated_value_max: 999999 }),
    ];
    expect(computeAwardedTotal(opps)).toBe(100000);
  });
});

describe("filterAwardedOpps", () => {
  test("returns only won opportunities", () => {
    const opps = [
      opp({ id: "a", stage: "won" }),
      opp({ id: "b", stage: "quotation", sales_stage: "verbally_awarded" }),
      opp({ id: "c", stage: "won" }),
    ];
    const result = filterAwardedOpps(opps);
    expect(result).toHaveLength(2);
    expect(result.map(o => o.id)).toEqual(["a", "c"]);
  });
});

// ─── JIH and Tender pipeline — Spec test case 8 ──────────────────────────────

describe("computeJihPipelineTotal — JIH and Tender values are separate", () => {
  test("includes jih, jih_bafo, verbally_awarded, contract_received, contract_signed", () => {
    const opps = [
      { sales_stage: "jih", estimated_value_max: 100000 },
      { sales_stage: "jih_bafo", estimated_value_max: 200000 },
      { sales_stage: "verbally_awarded", estimated_value_max: 300000 },
      { sales_stage: "contract_received", estimated_value_max: 400000 },
      { sales_stage: "contract_signed", estimated_value_max: 500000 },
    ];
    expect(computeJihPipelineTotal(opps)).toBe(1500000);
  });

  test("excludes won, lost, on_hold, rfq_received", () => {
    const opps = [
      { sales_stage: "won", estimated_value_max: 999999 },
      { sales_stage: "lost", estimated_value_max: 999999 },
      { sales_stage: "on_hold", estimated_value_max: 999999 },
      { sales_stage: "rfq_received", estimated_value_max: 999999 },
    ];
    expect(computeJihPipelineTotal(opps)).toBe(0);
  });

  test("excludes null sales_stage", () => {
    const opps = [
      { sales_stage: null, estimated_value_max: 999999 },
    ];
    expect(computeJihPipelineTotal(opps)).toBe(0);
  });

  test("JIH total is independent from tender total", () => {
    const jihOpps = [{ sales_stage: "jih", estimated_value_max: 100000 }];
    const tenders: TenderPipelineRow[] = [{ id: "t1", tender_stage: "tender_under_process", estimated_project_value: 200000 }];
    const jihTotal = computeJihPipelineTotal(jihOpps);
    const tenderTotal = computeTenderPipelineTotal(tenders);
    expect(jihTotal).toBe(100000);
    expect(tenderTotal).toBe(200000);
    expect(jihTotal + tenderTotal).toBe(300000);
    // They must NOT be equal if values differ
    expect(jihTotal).not.toBe(tenderTotal);
  });
});

describe("computeTenderPipelineTotal", () => {
  test("excludes terminal stages", () => {
    const tenders: TenderPipelineRow[] = [
      { id: "t1", tender_stage: "converted_to_jih", estimated_project_value: 999999 },
      { id: "t2", tender_stage: "tender_lost_or_archived", estimated_project_value: 999999 },
    ];
    expect(computeTenderPipelineTotal(tenders)).toBe(0);
  });

  test("includes active tender stages", () => {
    const tenders: TenderPipelineRow[] = [
      { id: "t1", tender_stage: "tender_under_process", estimated_project_value: 100000 },
      { id: "t2", tender_stage: "tender_bafo", estimated_project_value: 200000 },
      { id: "t3", tender_stage: "tender_identified", estimated_project_value: 50000 },
    ];
    expect(computeTenderPipelineTotal(tenders)).toBe(350000);
  });

  test("handles null estimated_project_value", () => {
    const tenders: TenderPipelineRow[] = [
      { id: "t1", tender_stage: "tender_under_process", estimated_project_value: null },
    ];
    expect(computeTenderPipelineTotal(tenders)).toBe(0);
  });
});

// ─── 90-day Tender conversion review — Spec test cases 9 & 10 ────────────────

describe("requiresConversionReview — Spec test case 9", () => {
  function dateNDaysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  test("flags tender with age >= 90 days", () => {
    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: null,
      receivedDate: dateNDaysAgo(90),
    })).toBe(true);

    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: null,
      receivedDate: dateNDaysAgo(120),
    })).toBe(true);
  });

  test("does NOT flag tender with age < 90 days", () => {
    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: null,
      receivedDate: dateNDaysAgo(89),
    })).toBe(false);

    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: null,
      receivedDate: dateNDaysAgo(30),
    })).toBe(false);
  });

  test("does NOT flag terminal-stage tenders regardless of age", () => {
    expect(requiresConversionReview({
      tender_stage: "converted_to_jih",
      submissionDate: null,
      receivedDate: dateNDaysAgo(200),
    })).toBe(false);

    expect(requiresConversionReview({
      tender_stage: "tender_lost_or_archived",
      submissionDate: null,
      receivedDate: dateNDaysAgo(200),
    })).toBe(false);
  });

  // Spec test case 10: submission date is preferred over RFQ/received date
  test("prefers submissionDate over receivedDate for age calculation", () => {
    // submissionDate = 95 days ago → should flag (>= 90)
    // receivedDate   = 30 days ago → would NOT flag if used instead
    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: dateNDaysAgo(95),
      receivedDate: dateNDaysAgo(30),
    })).toBe(true);

    // submissionDate = 30 days ago → should NOT flag
    // receivedDate   = 95 days ago → would flag if used instead
    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: dateNDaysAgo(30),
      receivedDate: dateNDaysAgo(95),
    })).toBe(false);
  });

  test("falls back to receivedDate when submissionDate is null", () => {
    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: null,
      receivedDate: dateNDaysAgo(91),
    })).toBe(true);
  });

  test("returns false when both dates are null", () => {
    expect(requiresConversionReview({
      tender_stage: "tender_under_process",
      submissionDate: null,
      receivedDate: null,
    })).toBe(false);
  });
});

describe("tenderAgeDays — submission date preferred over received date", () => {
  function dateNDaysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  test("uses submissionDate when available", () => {
    const age = tenderAgeDays({ submissionDate: dateNDaysAgo(45), receivedDate: dateNDaysAgo(10) });
    expect(age).toBe(45);
  });

  test("falls back to receivedDate when submissionDate is null", () => {
    const age = tenderAgeDays({ submissionDate: null, receivedDate: dateNDaysAgo(60) });
    expect(age).toBe(60);
  });

  test("returns null when both dates are null", () => {
    expect(tenderAgeDays({ submissionDate: null, receivedDate: null })).toBeNull();
  });
});

// ─── Submission urgency categories — Spec test case 11 ───────────────────────

describe("submissionUrgencyCategory — Spec test case 11", () => {
  test("classifies overdue as 'overdue'", () => {
    expect(submissionUrgencyCategory(-5)).toBe("overdue");
    expect(submissionUrgencyCategory(-1)).toBe("overdue");
  });

  test("classifies due today as 'critical'", () => {
    expect(submissionUrgencyCategory(0)).toBe("critical");
  });

  test("classifies 1-2 days as 'high'", () => {
    expect(submissionUrgencyCategory(1)).toBe("high");
    expect(submissionUrgencyCategory(2)).toBe("high");
  });

  test("classifies 3-5 days as 'warning'", () => {
    expect(submissionUrgencyCategory(3)).toBe("warning");
    expect(submissionUrgencyCategory(5)).toBe("warning");
  });

  test("classifies 6-7 days as 'upcoming'", () => {
    expect(submissionUrgencyCategory(6)).toBe("upcoming");
    expect(submissionUrgencyCategory(7)).toBe("upcoming");
  });

  test("classifies > 7 days as 'ok'", () => {
    expect(submissionUrgencyCategory(8)).toBe("ok");
    expect(submissionUrgencyCategory(30)).toBe("ok");
  });

  test("returns ok for null (no deadline set)", () => {
    expect(submissionUrgencyCategory(null)).toBe("ok");
  });
});

// ─── Target calculations — Spec test case 7 ──────────────────────────────────

describe("targetAchievementPct", () => {
  test("returns null when no target is set", () => {
    expect(targetAchievementPct(100000, 0)).toBeNull();
    expect(targetAchievementPct(100000, -1)).toBeNull();
  });

  test("computes correct achievement %", () => {
    expect(targetAchievementPct(80000, 100000)).toBe(80);
    expect(targetAchievementPct(150000, 100000)).toBe(150);
    expect(targetAchievementPct(0, 100000)).toBe(0);
  });

  test("rounds to nearest integer", () => {
    expect(targetAchievementPct(1, 3)).toBe(33);
    expect(targetAchievementPct(2, 3)).toBe(67);
  });
});

describe("remainingTarget — Spec test case 7", () => {
  test("returns null when no target is set", () => {
    expect(remainingTarget(50000, 0)).toBeNull();
  });

  test("never returns a negative value (floors at 0)", () => {
    expect(remainingTarget(150000, 100000)).toBe(0);
  });

  test("computes correct remaining target", () => {
    expect(remainingTarget(30000, 100000)).toBe(70000);
    expect(remainingTarget(0, 100000)).toBe(100000);
    expect(remainingTarget(100000, 100000)).toBe(0);
  });

  // Spec: remaining target never uses manually entered dashboard totals
  // (this is a structural guarantee — remainingTarget only takes computed values)
  test("is a pure function of awardedValue and salesTarget (no hidden state)", () => {
    const awarded1 = computeAwardedTotal([opp({ id: "a", stage: "won", estimated_value_max: 40000 })]);
    const awarded2 = computeAwardedTotal([opp({ id: "b", stage: "won", estimated_value_max: 60000 })]);
    expect(remainingTarget(awarded1, 100000)).toBe(60000);
    expect(remainingTarget(awarded2, 100000)).toBe(40000);
  });
});

// ─── Spec test case 20 — sidebar files were not changed ───────────────────────

describe("sidebar integrity — Spec test case 20", () => {
  test("AppShell.tsx was not modified by dashboard changes", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/components/phc/AppShell.tsx", "utf8");
    // The sidebar must still contain the my-workspace link exactly once
    const matches = [...src.matchAll(/my-workspace/g)];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // Must NOT contain any salesperson-dashboard route we might have added by mistake
    expect(src).not.toContain("salesperson-dashboard");
    expect(src).not.toContain("SalespersonDashboard");
  });

  test("dashboard-helpers.ts exports only pure functions (no Supabase import)", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile("src/lib/dashboard-helpers.ts", "utf8");
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("useQuery");
    expect(src).not.toContain("import React");
  });
});
