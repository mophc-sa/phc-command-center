import { describe, expect, it } from "bun:test";
import {
  memberSummary,
  needsAttention,
  summarySentence,
  teamActivityFeed,
  teamDay,
  teamWorkload,
} from "@/lib/team-dashboard";
import { fromFlag, type UnifiedAction } from "@/lib/action-center";
import type { OppRow } from "@/lib/sales-kpis";
import type { TimelineEvent } from "@/lib/opportunity-timeline";

const TODAY = "2026-08-20";
const ME = "u-me";
const OTHER = "u-other";

function action(over: Partial<UnifiedAction> = {}): UnifiedAction {
  const base = fromFlag({
    id: over.sourceRecordId ?? "f1",
    linked_record_type: "opportunity",
    linked_record_id: "opp-1",
    flag_kind: "action_required",
    action_type: null,
    risk_flag: null,
    queue_action_type: "follow_up_due",
    recommended_action: null,
    action_owner_id: ME,
    due_date: null,
    priority: "B",
    reason: "Chase the client",
    status: "open",
    created_at: "2026-08-01T00:00:00Z",
  });
  return { ...base, ...over };
}

function event(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "e1",
    at: `${TODAY}T09:00:00Z`,
    category: "sales",
    type: "stage_changed",
    title: "Stage → jih bafo",
    detail: null,
    actorId: ME,
    from: "jih",
    to: "jih_bafo",
    source: "stage_transition_history",
    evidence: null,
    href: null,
    ...over,
  };
}

const opp = (over: Partial<OppRow> = {}): OppRow => ({ id: "o1", owner_id: ME, sales_stage: "jih", ...over });

describe("member summary", () => {
  it("counts today's activity and current state separately", () => {
    const s = memberSummary({
      userId: ME,
      today: TODAY,
      opportunities: [
        opp({ id: "a", estimated_value_max: 1000, next_action: "call" }),
        opp({ id: "b", estimated_value_max: 500, next_action: "call" }),
        opp({ id: "won", sales_stage: "won", estimated_value_max: 9999 }),
      ],
      actions: [
        action({ id: "x1", sourceRecordId: "x1" }),
        action({ id: "x2", sourceRecordId: "x2", status: "done", resolvedAt: `${TODAY}T10:00:00Z` }),
        action({ id: "x3", sourceRecordId: "x3", status: "done", resolvedAt: "2026-08-01T10:00:00Z" }),
      ],
      events: [event(), event({ id: "e2", type: "follow_up_completed", category: "communication" })],
    });

    expect(s.activeOpportunities).toBe(2);
    expect(s.openPipelineValue).toBe(1500);
    expect(s.openActions).toBe(1);
    expect(s.actionsCompletedToday).toBe(1);   // not the one completed weeks ago
    expect(s.stageMovesToday).toBe(1);
    expect(s.followUpsCompletedToday).toBe(1);
  });

  it("counts overdue and due-today separately", () => {
    const s = memberSummary({
      userId: ME,
      today: TODAY,
      opportunities: [],
      actions: [
        action({ id: "od", sourceRecordId: "od", dueAt: "2026-08-01" }),
        action({ id: "dt", sourceRecordId: "dt", dueAt: TODAY }),
        action({ id: "later", sourceRecordId: "later", dueAt: "2026-12-01" }),
      ],
      events: [],
    });
    expect(s.overdueActions).toBe(1);
    expect(s.dueTodayActions).toBe(1);
  });

  it("attributes nothing to a user who did nothing", () => {
    const s = memberSummary({
      userId: OTHER,
      today: TODAY,
      opportunities: [opp()],
      actions: [action()],
      events: [event()],
    });
    expect(s.activeOpportunities).toBe(0);
    expect(s.stageMovesToday).toBe(0);
    expect(s.openActions).toBe(0);
  });

  // An event with no recorded actor belongs to nobody, not to whoever is nearest.
  it("does not attribute an actorless event to anyone", () => {
    const s = memberSummary({
      userId: ME,
      today: TODAY,
      opportunities: [],
      actions: [],
      events: [event({ actorId: null })],
    });
    expect(s.stageMovesToday).toBe(0);
  });

  it("surfaces standing gaps", () => {
    const s = memberSummary({
      userId: ME,
      today: TODAY,
      opportunities: [
        opp({ id: "gap" }),                                        // no next action
        opp({ id: "old", next_action: "call", last_activity_at: "2026-07-01" }),
      ],
      actions: [],
      events: [],
    });
    expect(s.opportunitiesWithNoNextAction).toBe(1);
    expect(s.stalledOpportunities).toBe(1);
  });
});

describe("summary sentence", () => {
  const s = memberSummary({
    userId: ME,
    today: TODAY,
    opportunities: [],
    actions: [action({ id: "d", sourceRecordId: "d", status: "done", resolvedAt: `${TODAY}T10:00:00Z` })],
    events: [event()],
  });

  it("reads as facts in English", () => {
    const line = summarySentence(s, "en");
    expect(line).toContain("1 action completed");
    expect(line).toContain("1 stage move");
  });

  it("reads as facts in Arabic", () => {
    expect(summarySentence(s, "ar")).toContain("إجراء مكتمل");
  });

  it("says so plainly when there was no activity", () => {
    const empty = memberSummary({ userId: ME, today: TODAY, opportunities: [], actions: [], events: [] });
    expect(summarySentence(empty, "en")).toBe("No recorded activity today");
    expect(summarySentence(empty, "ar")).toBe("لا نشاط مسجل اليوم");
  });
});

describe("team workload", () => {
  const input = {
    userIds: [ME, OTHER],
    today: TODAY,
    opportunities: [
      opp({ id: "big", owner_id: OTHER, estimated_value_max: 900_000, next_action: "x" }),
      opp({ id: "small", owner_id: ME, estimated_value_max: 100, next_action: "x" }),
    ],
    actions: [action({ id: "hp", sourceRecordId: "hp", priority: "A" as const })],
    events: [],
  };

  // Ordering by pipeline value is a fact about the work; ordering by task count
  // would be a scoreboard, which §8 explicitly rules out.
  it("orders by pipeline value, not by output volume", () => {
    const w = teamWorkload(input);
    expect(w.map((r) => r.userId)).toEqual([OTHER, ME]);
    expect(w[0].openPipelineValue).toBe(900_000);
  });

  it("reports no score, rank or performance field", () => {
    const row = teamWorkload(input)[0] as Record<string, unknown>;
    for (const forbidden of ["score", "rank", "performance", "rating"]) {
      expect(Object.keys(row).some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("counts high-priority actions and high-value deals", () => {
    const mine = teamWorkload(input).find((r) => r.userId === ME)!;
    expect(mine.highPriorityActions).toBe(1);
    expect(teamWorkload(input).find((r) => r.userId === OTHER)!.highValueOpportunities).toBe(1);
  });

  it("gives every row a drilldown scoped to that person", () => {
    for (const r of teamWorkload(input)) {
      expect(r.drilldown.to).toBe("/opportunities");
      expect(r.drilldown.search.owner).toBe(r.userId);
    }
  });
});

describe("needs your attention", () => {
  it("puts blocking and overdue work at critical", () => {
    const items = needsAttention({
      managerId: ME,
      today: TODAY,
      opportunities: [],
      actions: [
        action({ id: "block", sourceRecordId: "block", blocking: true }),
        action({ id: "od", sourceRecordId: "od", dueAt: "2026-08-01" }),
      ],
    });
    expect(items.every((i) => i.severity === "critical")).toBe(true);
  });

  it("ignores ordinary low-priority work", () => {
    const items = needsAttention({
      managerId: ME,
      today: TODAY,
      opportunities: [],
      actions: [action({ id: "meh", sourceRecordId: "meh", priority: "C", dueAt: "2026-12-01" })],
    });
    expect(items).toEqual([]);
  });

  it("folds in deterministic health findings", () => {
    const items = needsAttention({
      managerId: ME,
      today: TODAY,
      actions: [],
      opportunities: [opp({ id: "late", next_action: "x", expected_contract_date: "2026-07-01", project_name: "Tower" })],
    });
    const late = items.find((i) => i.reason.includes("Expected close"));
    expect(late?.severity).toBe("critical");
    expect(late?.entityLabel).toBe("Tower");
    expect(late?.href).toBe("/opportunities/late");
  });

  it("orders critical first, then by value", () => {
    const items = needsAttention({
      managerId: ME,
      today: TODAY,
      actions: [],
      opportunities: [
        opp({ id: "smallgap", next_action: null, estimated_value_max: 10 }),
        opp({ id: "biggap", next_action: null, estimated_value_max: 900 }),
        opp({ id: "late", next_action: "x", expected_contract_date: "2026-01-01" }),
      ],
    });
    expect(items[0].severity).toBe("critical");
    const gaps = items.filter((i) => i.reason.startsWith("No next action"));
    expect(gaps[0].value).toBe(900);
  });

  it("respects a limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => opp({ id: `o${i}`, next_action: null }));
    expect(needsAttention({ managerId: ME, today: TODAY, actions: [], opportunities: many, limit: 5 })).toHaveLength(5);
  });

  it("every item deep-links somewhere", () => {
    const items = needsAttention({
      managerId: ME,
      today: TODAY,
      actions: [action({ id: "b", sourceRecordId: "b", blocking: true })],
      opportunities: [opp({ id: "gap", next_action: null })],
    });
    for (const i of items) expect(i.href.startsWith("/")).toBe(true);
  });
});

describe("team activity feed", () => {
  it("merges entities and orders latest first", () => {
    const feed = teamActivityFeed([
      { transitions: [{ id: "a", record_type: "opportunity", record_id: "o1", from_stage: "jih", to_stage: "jih_bafo", actor_id: ME, notes: null, evidence: null, approval_id: null, created_at: "2026-08-10T09:00:00Z" }] },
      { transitions: [{ id: "b", record_type: "opportunity", record_id: "o2", from_stage: "jih", to_stage: "under_negotiation", actor_id: OTHER, notes: null, evidence: null, approval_id: null, created_at: "2026-08-15T09:00:00Z" }] },
    ]);
    expect(feed.map((e) => e.id)).toEqual(["transition:b", "transition:a"]);
  });

  it("respects a limit and stays empty when there is nothing", () => {
    expect(teamActivityFeed([])).toEqual([]);
    const many = Array.from({ length: 5 }, (_, i) => ({
      transitions: [{ id: `t${i}`, record_type: "opportunity", record_id: "o", from_stage: null, to_stage: "jih", actor_id: ME, notes: null, evidence: null, approval_id: null, created_at: `2026-08-1${i}T00:00:00Z` }],
    }));
    expect(teamActivityFeed(many, { limit: 2 })).toHaveLength(2);
  });
});

describe("team day rollup", () => {
  it("totals the team's recorded activity", () => {
    const a = memberSummary({
      userId: ME, today: TODAY, opportunities: [], events: [event()],
      actions: [action({ id: "d", sourceRecordId: "d", status: "done", resolvedAt: `${TODAY}T10:00:00Z` })],
    });
    const b = memberSummary({ userId: OTHER, today: TODAY, opportunities: [], actions: [], events: [] });
    const day = teamDay([a, b]);
    expect(day.actionsCompleted).toBe(1);
    expect(day.stageMoves).toBe(1);
    expect(day.membersActive).toBe(1);
    expect(day.membersWithNoActivity).toEqual([OTHER]);
  });

  it("reports a quiet day as quiet rather than as failure", () => {
    const day = teamDay([memberSummary({ userId: ME, today: TODAY, opportunities: [], actions: [], events: [] })]);
    expect(day.membersActive).toBe(0);
    expect(day.actionsCompleted).toBe(0);
  });
});
