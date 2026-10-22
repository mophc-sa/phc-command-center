import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { addBusinessDays, formatDecisionTime, meetingMetrics, weekStart } from "./meetings-metrics";

describe("the default due date: three Saudi business days", () => {
  it("skips Friday and Saturday, as public.add_business_days does", () => {
    expect(addBusinessDays("2026-10-22", 3)).toBe("2026-10-27"); // Thu -> Tue
    expect(addBusinessDays("2026-10-23", 1)).toBe("2026-10-25"); // Fri -> Sun
    expect(addBusinessDays("2026-10-25", 3)).toBe("2026-10-28"); // Sun -> Wed
    expect(addBusinessDays("2026-10-25", 0)).toBe("2026-10-25");
  });

  it("the SQL twin is the one the database uses, and the pgTAP test pins the same dates", () => {
    const sql = readFileSync("supabase/migrations/20261028100000_meetings_phase1.sql", "utf8");
    expect(sql).toContain("extract(isodow FROM d) NOT IN (5, 6)");
    expect(sql).toContain("public.add_business_days((now() AT TIME ZONE 'Asia/Riyadh')::date, 3)");
    const test = readFileSync("supabase/tests/meetings_phase1.test.sql", "utf8");
    expect(test).toContain("public.add_business_days('2026-10-22', 3), '2026-10-27'::date");
  });
});

describe("the numbers on /meetings", () => {
  const now = new Date("2026-10-22T09:00:00Z"); // Thursday; the week began Sunday 18 Oct
  const item = (status: string, created: string, decided: string | null = null, by: string | null = decided ? "u1" : null) => ({
    status, created_at: created, decided_at: decided, decided_by: by,
  });

  it("the week starts on Sunday in Riyadh", () => {
    expect(weekStart(now)).toBe("2026-10-18");
    expect(weekStart(new Date("2026-10-17T22:30:00Z"))).toBe("2026-10-18"); // Sun 01:30 Riyadh
  });

  it("counts this week's meetings, the approved share, decision time and old pending items", () => {
    const m = meetingMetrics(
      [
        { occurred_at: "2026-10-19T08:00:00Z", meeting_action_items: [
          item("approved", "2026-10-19T09:00:00Z", "2026-10-19T15:00:00Z"),
          item("dismissed", "2026-10-19T09:00:00Z", "2026-10-20T09:00:00Z"),
          item("pending", "2026-10-19T09:00:00Z"),
        ] },
        { occurred_at: "2026-10-07T08:00:00Z", meeting_action_items: [
          item("pending", "2026-10-07T09:00:00Z"),
          item("dismissed", "2026-10-07T09:00:00Z", "2026-10-21T09:00:00Z", null), // auto-dismissed
        ] },
        { occurred_at: null, meeting_action_items: [] },
      ],
      now,
    );
    expect(m.meetingsThisWeek).toBe(1);
    expect(m.approvedPct).toBe(20);
    expect(m.avgDecisionHours).toBe(15); // (6 h + 24 h) / 2; the auto-dismissal is not a decision
    expect(m.pendingOver7Days).toBe(1);
  });

  it("says nothing rather than zero when there is nothing to measure", () => {
    expect(meetingMetrics([], now)).toEqual({ meetingsThisWeek: 0, approvedPct: null, avgDecisionHours: null, pendingOver7Days: 0 });
    expect(formatDecisionTime(null, "en")).toBe("—");
    expect(formatDecisionTime(0.2, "en")).toBe("< 1 h");
    expect(formatDecisionTime(5.4, "en")).toBe("5 h");
    expect(formatDecisionTime(84, "en")).toBe("3.5 d");
    expect(formatDecisionTime(84, "ar")).not.toMatch(/[٠-٩]/);
  });
});
