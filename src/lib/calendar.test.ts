// =============================================================================
// The calendar arranges dates. It must not invent one.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { buildCalendar, byDay, calendarSummary, monthGrid, monthOf, ymd } from "@/lib/calendar";

const TODAY = "2026-08-27";

describe("only dated, still-open work reaches the grid", () => {
  it("an undated record does not appear at all", () => {
    // The alternative — placing it on today, or on the created date — would be
    // inventing a commitment nobody made.
    const out = buildCalendar({
      today: TODAY,
      followUps: [{ id: "f", opportunity_id: "o", due_date: null, status: "scheduled" }],
      rfqs: [{ id: "r", response_due_date: null }],
      opportunities: [{ id: "o", next_action: "Call", next_action_due: null }],
    });
    expect(out).toEqual([]);
  });

  it("a completed follow-up is gone, however old", () => {
    const out = buildCalendar({
      today: TODAY,
      followUps: [{ id: "f", opportunity_id: "o", due_date: "2026-01-01", status: "completed" }],
    });
    expect(out).toEqual([]);
  });

  it("a closed deal's next action is not something anyone owes", () => {
    // Showing it greyed teaches the reader to skim past rows, which is how a
    // real one gets missed.
    for (const stage of ["won", "lost", "archived"]) {
      const out = buildCalendar({
        today: TODAY,
        opportunities: [{ id: "o", next_action: "Call", next_action_due: "2026-09-01", sales_stage: stage }],
      });
      expect([stage, out.length]).toEqual([stage, 0]);
    }
  });

  it("an open deal's next action does appear", () => {
    const out = buildCalendar({
      today: TODAY,
      opportunities: [{ id: "o", next_action: "Call", next_action_due: "2026-09-01", sales_stage: "jih" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("next_action");
  });

  it("a quoted RFQ has no deadline left to meet", () => {
    const out = buildCalendar({
      today: TODAY,
      rfqs: [{ id: "r", response_due_date: "2026-09-01", status: "quoted" }],
    });
    expect(out).toEqual([]);
  });
});

describe("state is a fact about the date, measured against a supplied today", () => {
  const at = (due: string) =>
    buildCalendar({ today: TODAY, followUps: [{ id: "f", opportunity_id: "o", due_date: due, status: "scheduled" }] })[0];

  it("yesterday is overdue, today is due, tomorrow is upcoming", () => {
    expect(at("2026-08-26").state).toBe("overdue");
    expect(at("2026-08-27").state).toBe("due");
    expect(at("2026-08-28").state).toBe("upcoming");
  });

  it("no clock is read inside the module — the caller owns 'today'", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "./calendar.ts"), "utf8");
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });

  it("a timestamp is accepted and reduced to its day", () => {
    expect(at("2026-08-28T22:00:00Z").date).toBe("2026-08-28");
  });
});

describe("the three sources land on one list", () => {
  const out = buildCalendar({
    today: TODAY,
    followUps: [{ id: "f", opportunity_id: "o1", due_date: "2026-09-02", status: "scheduled" }],
    rfqs: [{ id: "r", rfq_number: "RFQ-1", response_due_date: "2026-09-02", status: "open" }],
    opportunities: [{ id: "o2", project_name: "BLVD", next_action: "Call", next_action_due: "2026-09-01", sales_stage: "jih" }],
  });

  it("sorted by date first", () => {
    expect(out.map((e) => e.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-02"]);
  });

  it("a deadline outranks a follow-up on the same day — it cannot be moved", () => {
    const sameDay = out.filter((e) => e.date === "2026-09-02");
    expect(sameDay.map((e) => e.source)).toEqual(["rfq_deadline", "follow_up"]);
  });

  it("every event carries the record it opens", () => {
    for (const e of out) expect([e.id, e.entityId.length > 0]).toEqual([e.id, true]);
  });

  it("labels are MessageRefs, translated at the surface", () => {
    // The engine knows the fact; the screen knows the language.
    for (const e of out) expect(typeof e.label).toBe("object");
  });
});

describe("the month grid", () => {
  it("is always six weeks, so paging does not change its height", () => {
    for (const [y, m] of [[2026, 2], [2026, 8], [2027, 1]] as Array<[number, number]>) {
      const g = monthGrid(y, m);
      expect([y, m, g.length]).toEqual([y, m, 6]);
      for (const w of g) expect(w).toHaveLength(7);
    }
  });

  it("starts on a Monday and contains the whole month", () => {
    const g = monthGrid(2026, 8);
    const flat = g.flat();
    expect(flat).toContain("2026-08-01");
    expect(flat).toContain("2026-08-31");
    // The 1st of August 2026 is a Saturday, so the grid leads with July.
    expect(flat[0] < "2026-08-01").toBe(true);
  });

  it("days are continuous with no gap or repeat", () => {
    const flat = monthGrid(2026, 8).flat();
    expect(new Set(flat).size).toBe(42);
    for (let i = 1; i < flat.length; i++) {
      const prev = new Date(flat[i - 1] + "T00:00:00Z");
      prev.setUTCDate(prev.getUTCDate() + 1);
      expect(flat[i]).toBe(prev.toISOString().slice(0, 10));
    }
  });

  it("crosses a year boundary without losing a day", () => {
    const flat = monthGrid(2026, 12).flat();
    expect(flat).toContain("2026-12-31");
    expect(flat.some((d) => d.startsWith("2027-01"))).toBe(true);
  });

  it("handles a leap February", () => {
    expect(monthGrid(2028, 2).flat()).toContain("2028-02-29");
  });

  it("ymd pads, so string comparison stays date comparison", () => {
    expect(ymd(2026, 1, 5)).toBe("2026-01-05");
    expect(ymd(2026, 1, 5) < ymd(2026, 1, 12)).toBe(true);
    expect(monthOf("2026-09-14")).toBe(9);
  });
});

describe("what the reader is told at a glance", () => {
  const events = buildCalendar({
    today: TODAY,
    followUps: [
      { id: "a", opportunity_id: "o", due_date: "2026-08-01", status: "scheduled" },
      { id: "b", opportunity_id: "o", due_date: "2026-08-27", status: "scheduled" },
      { id: "c", opportunity_id: "o", due_date: "2026-09-10", status: "scheduled" },
    ],
  });

  it("counts late, today and ahead separately", () => {
    expect(calendarSummary(events)).toEqual({ overdue: 1, today: 1, upcoming: 1, total: 3 });
  });

  it("byDay keys every event to its own day", () => {
    const m = byDay(events);
    expect(m.get("2026-08-27")).toHaveLength(1);
    expect(m.get("2026-08-02")).toBeUndefined();
    expect([...m.values()].flat()).toHaveLength(events.length);
  });

  it("an empty book summarises to zero rather than throwing", () => {
    expect(calendarSummary([])).toEqual({ overdue: 0, today: 0, upcoming: 0, total: 0 });
    expect(byDay([]).size).toBe(0);
  });
});

describe("this module cannot write", () => {
  it("holds no database client", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "./calendar.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"@\/integrations\/supabase/);
    for (const w of [".insert(", ".update(", ".delete("]) {
      expect([w, src.includes(w)]).toEqual([w, false]);
    }
  });
});
