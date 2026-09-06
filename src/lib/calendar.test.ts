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

// =============================================================================
// Thirteen dated obligations the calendar could not see.
//
// Measured on production 2026-09-06, before this change: the three sources the
// calendar read covered 19 dated rows and missed 37 -- twelve enquiry
// follow-ups, twelve flags, eleven enquiry deadlines and two commitments. Each
// is something a person typed into this system on purpose. A date you recorded
// and cannot see is worse than one you never recorded, because you believe it
// is being watched.
// =============================================================================

describe("every recorded date reaches the grid", () => {
  const ALL = {
    today: TODAY,
    opportunities: [{
      id: "o1", project_name: "Haram", client: "MOMRA",
      expected_contract_date: "2026-09-01", hold_review_date: "2026-09-02", sales_stage: "negotiation",
    }],
    inboxItems: [{
      id: "i1", project_name: "Mataf", company_name: "Binladin",
      deadline: "2026-09-03", follow_up_date: "2026-09-04", info_due_date: "2026-09-05", status: "new",
    }],
    flags: [{ id: "g1", linked_record_type: "opportunity", linked_record_id: "o1",
              flag_kind: "risk", reason: "no contact", due_date: "2026-09-06", status: "open" }],
    commitments: [{ id: "c1", opportunity_id: "o1", description: "Send BOQ", due_date: "2026-09-07" }],
    tasks: [{ id: "t1", title: "Price it", due_date: "2026-09-08", related_opportunity_id: "o1" }],
    quotations: [{ id: "q1", quote_number: "Q-1", valid_until: "2026-09-09", status: "sent",
                   related_opportunity_id: "o1" }],
    projects: [{ id: "p1", name: "Diriyah", project_number: "P-1",
                 expected_boq_date: "2026-09-10", expected_signage_date: "2026-09-11" }],
    tenders: [{ id: "d1", tender_name: "Metro", tender_stage: "open",
                expected_award_date: "2026-09-12", next_follow_up_date: "2026-09-13" }],
  };

  it("draws all thirteen new kinds", () => {
    const sources = buildCalendar(ALL).map((e) => e.source);
    expect(sources.sort()).toEqual([
      "commitment", "expected_contract", "flag_due", "hold_review",
      "intake_deadline", "intake_follow_up", "intake_info_due",
      "project_boq", "project_signage", "quotation_expiry",
      "task", "tender_award", "tender_follow_up",
    ]);
  });

  it("routes a flag to the record that raised it", () => {
    const flag = buildCalendar(ALL).find((e) => e.source === "flag_due");
    expect(flag?.entityId).toBe("o1");
  });

  it("keeps a flag on its own row when it points at something else", () => {
    // The calendar can only open an opportunity today. A flag on a tender must
    // not send the reader to an opportunity that does not exist.
    const out = buildCalendar({
      today: TODAY,
      flags: [{ id: "g2", linked_record_type: "tender", linked_record_id: "d9",
                due_date: "2026-09-06", status: "open" }],
    });
    expect(out[0]?.entityId).toBe("g2");
  });

  it("drops work that is finished, by timestamp or by status", () => {
    const out = buildCalendar({
      today: TODAY,
      flags: [
        { id: "a", due_date: "2026-09-01", status: "completed" },
        { id: "b", due_date: "2026-09-01", status: "open", completed_at: "2026-08-01" },
      ],
      commitments: [{ id: "c", due_date: "2026-09-01", closed_at: "2026-08-01" }],
      tasks: [{ id: "t", due_date: "2026-09-01", completed_at: "2026-08-01" }],
      inboxItems: [{ id: "i", deadline: "2026-09-01", status: "converted" }],
    });
    expect(out).toEqual([]);
  });

  it("still shows an expiring quotation whatever its status", () => {
    // A quotation that runs out while nobody looked is precisely what this
    // page exists to surface -- filtering it by status would hide it.
    const out = buildCalendar({
      today: TODAY,
      quotations: [{ id: "q", quote_number: "Q-9", valid_until: "2026-09-01", status: "draft" }],
    });
    expect(out.map((e) => e.source)).toEqual(["quotation_expiry"]);
  });

  it("puts somebody else's deadline above our own reminder on the same day", () => {
    const out = buildCalendar({
      today: TODAY,
      rfqs: [{ id: "r", response_due_date: "2026-09-01" }],
      inboxItems: [{ id: "i", deadline: "2026-09-01", status: "new" }],
      projects: [{ id: "p", name: "X", expected_signage_date: "2026-09-01" }],
      quotations: [{ id: "q", valid_until: "2026-09-01" }],
    });
    expect(out.map((e) => e.source)).toEqual([
      "rfq_deadline", "intake_deadline", "quotation_expiry", "project_signage",
    ]);
  });

  it("invents no date for any of them", () => {
    const out = buildCalendar({
      today: TODAY,
      opportunities: [{ id: "o", expected_contract_date: null, hold_review_date: null }],
      inboxItems: [{ id: "i", deadline: null, follow_up_date: null, info_due_date: null }],
      flags: [{ id: "g", due_date: null }],
      commitments: [{ id: "c", due_date: null }],
      tasks: [{ id: "t", due_date: null }],
      quotations: [{ id: "q", valid_until: null }],
      projects: [{ id: "p", expected_boq_date: null, expected_signage_date: null }],
      tenders: [{ id: "d", expected_award_date: null, next_follow_up_date: null }],
    });
    expect(out).toEqual([]);
  });

  it("gives every source a label the reader can see", () => {
    // A source added without a message renders an empty pill. The engine can
    // be wrong here in a way no type catches, so the test walks all of them.
    for (const e of buildCalendar(ALL)) {
      expect([e.source, e.label.key.startsWith("cal_")]).toEqual([e.source, true]);
    }
  });
});
