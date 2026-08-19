import { describe, expect, it } from "bun:test";
import {
  actionHref,
  addDays,
  assembleActions,
  countActions,
  DEFAULT_FILTERS,
  filterActions,
  fromApproval,
  fromFlag,
  fromFollowUp,
  fromIntake,
  fromTask,
  rankOf,
  sortActions,
  todaysWork,
  urgencyOf,
  visibleActions,
  type ApprovalRowIn,
  type FlagRowIn,
  type FollowUpRowIn,
  type IntakeRowIn,
  type TaskRowIn,
  type UnifiedAction,
} from "@/lib/action-center";

const TODAY = "2026-08-19";
const ME = "user-me";
const OTHER = "user-other";

// ---- builders ---------------------------------------------------------------

function flag(over: Partial<FlagRowIn> = {}): FlagRowIn {
  return {
    id: "f1",
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
    ...over,
  };
}

function task(over: Partial<TaskRowIn> = {}): TaskRowIn {
  return {
    id: "t1",
    title: "Send the quote",
    related_opportunity_id: "opp-2",
    owner_id: ME,
    priority: "A",
    due_date: null,
    status: "open",
    created_at: "2026-08-02T00:00:00Z",
    ...over,
  };
}

function followUp(over: Partial<FollowUpRowIn> = {}): FollowUpRowIn {
  return {
    id: "fu1",
    opportunity_id: "opp-3",
    owner_id: ME,
    due_date: null,
    cadence_tier: "B",
    channel: "call",
    status: "pending",
    notes: "Ring the consultant",
    created_at: "2026-08-03T00:00:00Z",
    ...over,
  };
}

function approval(over: Partial<ApprovalRowIn> = {}): ApprovalRowIn {
  return {
    id: "a1",
    approval_type: "owner_grant",
    related_opportunity_id: "opp-4",
    linked_record_type: "opportunity",
    linked_record_id: "opp-4",
    requested_by: OTHER,
    assigned_approver: null,
    status: "pending",
    created_at: "2026-08-04T00:00:00Z",
    ...over,
  };
}

function intake(over: Partial<IntakeRowIn> = {}): IntakeRowIn {
  return {
    id: "i1",
    project_name: "New tower",
    company_name: "Acme",
    review_state: "pending_review",
    assigned_owner_id: OTHER,
    created_by: OTHER,
    request_type: "jih",
    info_due_date: null,
    info_responsible_id: null,
    created_at: "2026-08-05T00:00:00Z",
    ...over,
  };
}

const ALL_VISIBLE = { canReviewIntake: true, canDecideApprovals: true };

// ---- urgency ----------------------------------------------------------------

describe("urgency", () => {
  it("classifies against today without timezone drift", () => {
    expect(urgencyOf("2026-08-18", TODAY)).toBe("overdue");
    expect(urgencyOf("2026-08-19", TODAY)).toBe("due_today");
    expect(urgencyOf("2026-08-22", TODAY)).toBe("due_soon");
    expect(urgencyOf("2026-10-01", TODAY)).toBe("upcoming");
    expect(urgencyOf(null, TODAY)).toBe("none");
  });

  it("treats a full timestamp the same as a bare date", () => {
    expect(urgencyOf("2026-08-18T23:59:59Z", TODAY)).toBe("overdue");
  });

  it("addDays crosses month boundaries", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

// ---- projections ------------------------------------------------------------

describe("projections", () => {
  it("maps a flag and keeps its reason as the why", () => {
    const a = fromFlag(flag({ due_date: "2026-08-10" }));
    expect(a.source).toBe("flag");
    expect(a.reason).toBe("Chase the client");
    expect(a.href).toBe("/opportunities/opp-1");
    expect(a.status).toBe("open");
  });

  it("ranks a risk flag as tier A even when the column says otherwise", () => {
    expect(fromFlag(flag({ flag_kind: "risk", priority: "C" })).priority).toBe("A");
  });

  it("marks blocked flags as blocking", () => {
    expect(fromFlag(flag({ status: "blocked" })).blocking).toBe(true);
    expect(fromFlag(flag({ status: "open" })).blocking).toBe(false);
  });

  it("maps terminal flag statuses to done/dismissed", () => {
    expect(fromFlag(flag({ status: "completed" })).status).toBe("done");
    expect(fromFlag(flag({ status: "resolved" })).status).toBe("done");
    expect(fromFlag(flag({ status: "dismissed" })).status).toBe("dismissed");
  });

  it("maps a task", () => {
    const a = fromTask(task({ due_date: "2026-08-19" }));
    expect(a.type).toBe("task");
    expect(a.title).toBe("Send the quote");
    expect(a.href).toBe("/opportunities/opp-2");
  });

  it("maps a follow-up and treats cancelled as dismissed", () => {
    expect(fromFollowUp(followUp({ status: "cancelled" })).status).toBe("dismissed");
    expect(fromFollowUp(followUp({ status: "completed" })).status).toBe("done");
    expect(fromFollowUp(followUp()).status).toBe("open");
  });

  it("treats a pending approval as blocking tier A", () => {
    const a = fromApproval(approval());
    expect(a.blocking).toBe(true);
    expect(a.priority).toBe("A");
    expect(a.status).toBe("open");
  });

  it("treats a decided approval as done and not blocking", () => {
    const a = fromApproval(approval({ status: "approved", decided_at: "2026-08-06T00:00:00Z" }));
    expect(a.blocking).toBe(false);
    expect(a.status).toBe("done");
  });

  // Intake is on inbox_items, not opportunities — the Phase 2 gate runs before
  // an opportunity exists. A regression here would deep-link to a missing page.
  it("maps intake to the inbox, not to an opportunity", () => {
    const a = fromIntake(intake())!;
    expect(a.entityType).toBe("inbox_item");
    expect(a.href).toBe("/lead-tender-inbox");
  });

  it("splits pending_review from need_information into different owners", () => {
    const review = fromIntake(intake())!;
    expect(review.type).toBe("intake_review");
    expect(review.ownerUserId).toBeNull();

    const info = fromIntake(
      intake({ review_state: "need_information", info_responsible_id: ME, info_due_date: "2026-08-25" }),
    )!;
    expect(info.type).toBe("intake_need_information");
    expect(info.ownerUserId).toBe(ME);
    expect(info.dueAt).toBe("2026-08-25");
  });

  it("ignores intake rows in any other review state", () => {
    expect(fromIntake(intake({ review_state: "approved_for_pricing" }))).toBeNull();
    expect(fromIntake(intake({ review_state: null }))).toBeNull();
  });

  it("falls back to the list route for entities with no detail page", () => {
    expect(actionHref("tender", "x")).toBe("/tenders");
    expect(actionHref("opportunity", "abc")).toBe("/opportunities/abc");
    expect(actionHref("unknown", "x")).toBe("/action-center");
  });
});

// ---- ranking ----------------------------------------------------------------

describe("ranking", () => {
  it("puts blocking first, then overdue, then due today, then tier A", () => {
    const blocking = fromApproval(approval());
    const overdue = fromFlag(flag({ id: "f-od", due_date: "2026-08-01" }));
    const dueToday = fromFlag(flag({ id: "f-dt", due_date: TODAY }));
    const tierA = fromTask(task({ id: "t-a", priority: "A" }));
    const later = fromFlag(flag({ id: "f-l", due_date: "2026-12-01", priority: "C" }));

    expect(rankOf(blocking, TODAY)).toBeLessThan(rankOf(overdue, TODAY));
    expect(rankOf(overdue, TODAY)).toBeLessThan(rankOf(dueToday, TODAY));
    expect(rankOf(dueToday, TODAY)).toBeLessThan(rankOf(tierA, TODAY));
    expect(rankOf(tierA, TODAY)).toBeLessThan(rankOf(later, TODAY));

    const order = sortActions([later, tierA, dueToday, overdue, blocking], TODAY).map((a) => a.id);
    expect(order).toEqual([blocking.id, overdue.id, dueToday.id, tierA.id, later.id]);
  });

  it("breaks ties on due date, then creation, so the order is stable", () => {
    const a = fromFlag(flag({ id: "x", due_date: "2026-08-01", created_at: "2026-01-01T00:00:00Z" }));
    const b = fromFlag(flag({ id: "y", due_date: "2026-08-02", created_at: "2026-01-01T00:00:00Z" }));
    // both overdue → earlier due date first
    expect(sortActions([b, a], TODAY).map((x) => x.sourceRecordId)).toEqual(["x", "y"]);

    const c = fromFlag(flag({ id: "c", due_date: null, created_at: "2026-01-02T00:00:00Z" }));
    const d = fromFlag(flag({ id: "d", due_date: null, created_at: "2026-01-01T00:00:00Z" }));
    expect(sortActions([c, d], TODAY).map((x) => x.sourceRecordId)).toEqual(["d", "c"]);
  });

  it("is a pure sort — it does not mutate its input", () => {
    const input = [fromFlag(flag({ id: "b", due_date: "2026-12-01" })), fromFlag(flag({ id: "a", due_date: "2026-01-01" }))];
    const before = input.map((x) => x.id);
    sortActions(input, TODAY);
    expect(input.map((x) => x.id)).toEqual(before);
  });
});

// ---- filtering --------------------------------------------------------------

describe("filters", () => {
  const set: UnifiedAction[] = [
    fromFlag(flag({ id: "mine-open", action_owner_id: ME })),
    fromFlag(flag({ id: "theirs", action_owner_id: OTHER })),
    fromFlag(flag({ id: "mine-done", action_owner_id: ME, status: "completed" })),
    fromFlag(flag({ id: "mine-overdue", action_owner_id: ME, due_date: "2026-08-01" })),
    fromFlag(flag({ id: "mine-today", action_owner_id: ME, due_date: TODAY })),
    fromApproval(approval({ id: "unowned-blocker", assigned_approver: null })),
  ];
  const ctx = { uid: ME, today: TODAY };

  it("defaults to my active work", () => {
    const ids = filterActions(set, DEFAULT_FILTERS, ctx).map((a) => a.sourceRecordId);
    expect(ids).toContain("mine-open");
    expect(ids).not.toContain("theirs");
    expect(ids).not.toContain("mine-done");
  });

  it("keeps unowned blocking work in the personal queue so it is not orphaned", () => {
    const ids = filterActions(set, DEFAULT_FILTERS, ctx).map((a) => a.sourceRecordId);
    expect(ids).toContain("unowned-blocker");
  });

  it("team scope excludes my own items", () => {
    const ids = filterActions(set, { ...DEFAULT_FILTERS, scope: "team" }, ctx).map((a) => a.sourceRecordId);
    expect(ids).toContain("theirs");
    expect(ids).not.toContain("mine-open");
  });

  it("filters by urgency", () => {
    const overdue = filterActions(set, { ...DEFAULT_FILTERS, scope: "all", urgency: "overdue" }, ctx);
    expect(overdue.map((a) => a.sourceRecordId)).toEqual(["mine-overdue"]);

    const dueToday = filterActions(set, { ...DEFAULT_FILTERS, scope: "all", urgency: "due_today" }, ctx);
    expect(dueToday.map((a) => a.sourceRecordId)).toEqual(["mine-today"]);
  });

  it("filters by status, priority, owner and entity type", () => {
    expect(filterActions(set, { ...DEFAULT_FILTERS, scope: "all", status: "done" }, ctx).map((a) => a.sourceRecordId))
      .toEqual(["mine-done"]);
    expect(filterActions(set, { ...DEFAULT_FILTERS, scope: "all", owner: OTHER }, ctx).map((a) => a.sourceRecordId))
      .toEqual(["theirs"]);
    expect(
      filterActions(set, { ...DEFAULT_FILTERS, scope: "all", priority: "A" }, ctx).every((a) => a.priority === "A"),
    ).toBe(true);
    expect(
      filterActions(set, { ...DEFAULT_FILTERS, scope: "all", entityType: "opportunity" }, ctx).every(
        (a) => a.entityType === "opportunity",
      ),
    ).toBe(true);
  });

  it("counts only active work", () => {
    const c = countActions(set, TODAY);
    expect(c.overdue).toBe(1);
    expect(c.dueToday).toBe(1);
    expect(c.blocking).toBe(1);
    expect(c.total).toBe(5); // mine-done is excluded
  });
});

// ---- role-aware visibility --------------------------------------------------

describe("role-aware visibility", () => {
  const actions = [
    fromIntake(intake())!,
    fromIntake(intake({ id: "i2", review_state: "need_information", info_responsible_id: ME }))!,
    fromApproval(approval({ assigned_approver: null })),
    fromFlag(flag()),
  ];

  // PRD §8: a salesperson must not see approvals or reviews they cannot action.
  it("hides intake review from someone who cannot review intake", () => {
    const seen = visibleActions(actions, { canReviewIntake: false, canDecideApprovals: false });
    expect(seen.some((a) => a.type === "intake_review")).toBe(false);
  });

  it("still shows a need-information item to the person responsible for it", () => {
    const seen = visibleActions(actions, { canReviewIntake: false, canDecideApprovals: false });
    const info = seen.find((a) => a.type === "intake_need_information");
    expect(info).toBeDefined();
    expect(info!.ownerUserId).toBe(ME);
  });

  it("hides unassigned approvals from someone with no commercial authority", () => {
    const seen = visibleActions(actions, { canReviewIntake: false, canDecideApprovals: false });
    expect(seen.some((a) => a.source === "approval")).toBe(false);
  });

  it("shows both to a reviewer with commercial authority", () => {
    const seen = visibleActions(actions, ALL_VISIBLE);
    expect(seen.some((a) => a.type === "intake_review")).toBe(true);
    expect(seen.some((a) => a.source === "approval")).toBe(true);
  });

  it("never hides ordinary owned work from anyone", () => {
    const seen = visibleActions(actions, { canReviewIntake: false, canDecideApprovals: false });
    expect(seen.some((a) => a.source === "flag")).toBe(true);
  });
});

// ---- assembly + today -------------------------------------------------------

describe("assembleActions", () => {
  it("projects every source and returns them ranked", () => {
    const out = assembleActions(
      {
        flags: [flag({ due_date: "2026-08-01" })],
        tasks: [task()],
        followUps: [followUp()],
        approvals: [approval()],
        intake: [intake()],
      },
      ALL_VISIBLE,
      TODAY,
    );
    expect(out).toHaveLength(5);
    // blocking items lead
    expect(out[0].blocking).toBe(true);
  });

  it("tolerates missing sources", () => {
    expect(assembleActions({}, ALL_VISIBLE, TODAY)).toEqual([]);
  });

  it("todaysWork returns only my ranked work, capped", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      fromFlag(flag({ id: `f${i}`, action_owner_id: ME, due_date: "2026-08-01" })),
    );
    const out = todaysWork(many, { uid: ME, today: TODAY });
    expect(out).toHaveLength(8);
    expect(out.every((a) => a.ownerUserId === ME)).toBe(true);
  });

  it("todaysWork excludes other people's work", () => {
    const mixed = [fromFlag(flag({ id: "a", action_owner_id: ME })), fromFlag(flag({ id: "b", action_owner_id: OTHER }))];
    expect(todaysWork(mixed, { uid: ME, today: TODAY }).map((a) => a.sourceRecordId)).toEqual(["a"]);
  });
});
