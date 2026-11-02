import { describe, expect, it } from "bun:test";
import type { AttentionItem } from "@/lib/attention";
import type { RepDay } from "@/lib/daily-tasks";
import type { UnifiedApproval } from "@/lib/approvals-center";
import { approveItems, callItems, meetingDay, pickContact, teamItems, type ContactRow } from "@/lib/manager-actions";

const TODAY = "2026-10-20";

function att(p: Partial<AttentionItem> & { opportunityId: string }): AttentionItem {
  return {
    label: `Deal ${p.opportunityId}`,
    ownerId: null,
    stage: null,
    value: null,
    priority: "high",
    score: 10,
    reasons: [],
    primaryReason: {} as AttentionItem["primaryReason"],
    issueCount: 1,
    oldestOverdueDays: null,
    lastClientActivity: null,
    nextAction: { text: null, due: null, status: "missing" },
    aging: {} as AttentionItem["aging"],
    atRisk: false,
    stalled: false,
    closingSoon: false,
    ...p,
  };
}

describe("callItems", () => {
  it("keeps only at-risk, stalled or closing-soon deals", () => {
    const out = callItems(
      [
        att({ opportunityId: "a", atRisk: true }),
        att({ opportunityId: "b", stalled: true }),
        att({ opportunityId: "c", closingSoon: true }),
        att({ opportunityId: "d" }),
      ],
      new Map(),
      TODAY,
    );
    expect(out.map((c) => c.opportunityId).sort()).toEqual(["a", "b", "c"]);
  });

  it("drops a deal contacted within 14 days and keeps one quiet for 14 or with no contact", () => {
    const out = callItems(
      [
        att({ opportunityId: "recent", atRisk: true, lastClientActivity: "2026-10-10T09:00:00Z" }),
        att({ opportunityId: "edge", atRisk: true, lastClientActivity: "2026-10-06T09:00:00Z" }),
        att({ opportunityId: "never", atRisk: true, lastClientActivity: null }),
      ],
      new Map(),
      TODAY,
    );
    expect(out.map((c) => [c.opportunityId, c.quietDays])).toEqual([
      ["edge", 14],
      ["never", null],
    ]);
  });

  it("ranks by attention score, highest first", () => {
    const out = callItems(
      [
        att({ opportunityId: "low", atRisk: true, score: 20 }),
        att({ opportunityId: "high", atRisk: true, score: 80 }),
      ],
      new Map(),
      TODAY,
    );
    expect(out.map((c) => c.opportunityId)).toEqual(["high", "low"]);
  });

  it("names the deal and its contact", () => {
    const rows: ContactRow[] = [{ id: "s1", name: "Ahmed", role_code: "decision_maker", phone: "0500000001" }];
    const [c] = callItems([att({ opportunityId: "a", atRisk: true, label: "NEOM tower" })], new Map([["a", rows]]), TODAY);
    expect(c).toMatchObject({ projectName: "NEOM tower", contactName: "Ahmed", phone: "0500000001" });
  });
});

describe("pickContact", () => {
  it("prefers a decision maker with a phone", () => {
    const rows: ContactRow[] = [
      { id: "1", name: "Sara", phone: "0501", contact_order: 1 },
      { id: "2", name: "Omar", role_code: "decision_maker", phone: "0502", contact_order: 2 },
    ];
    expect(pickContact(rows)).toEqual({ name: "Omar", phone: "0502" });
  });

  it("falls back to the first stakeholder with a phone when the decision maker has none", () => {
    const rows: ContactRow[] = [
      { id: "1", name: "Omar", role_code: "decision_maker", phone: null, contact_order: 1 },
      { id: "2", name: "Sara", phone: "0501", contact_order: 2 },
    ];
    expect(pickContact(rows)).toEqual({ name: "Sara", phone: "0501" });
  });

  it("returns the first stakeholder without a phone when nobody has one", () => {
    const rows: ContactRow[] = [
      { id: "2", name: "Later", contact_order: 2 },
      { id: "1", name: "First", contact_order: 1 },
    ];
    expect(pickContact(rows)).toEqual({ name: "First", phone: null });
  });

  it("returns null with no stakeholders", () => {
    expect(pickContact([])).toBeNull();
  });
});

describe("teamItems", () => {
  const rep = (p: Partial<RepDay> & { user_id: string }): RepDay => ({
    full_name: p.user_id,
    done: 0,
    open_due: 0,
    overdue: 0,
    buckets: {},
    ...p,
  });

  it("keeps reps with overdue work, or due work and nothing done", () => {
    const out = teamItems([
      rep({ user_id: "late", overdue: 2 }),
      rep({ user_id: "stuck", open_due: 3, done: 0 }),
      rep({ user_id: "moving", open_due: 3, done: 1 }),
      rep({ user_id: "clear" }),
    ]);
    expect(out.map((r) => r.user_id)).toEqual(["late", "stuck"]);
  });

  it("orders by overdue, then open due, then name", () => {
    const out = teamItems([
      rep({ user_id: "b", full_name: "Bader", overdue: 1, open_due: 1 }),
      rep({ user_id: "a", full_name: "Adel", overdue: 1, open_due: 1 }),
      rep({ user_id: "c", full_name: "Cyrus", overdue: 1, open_due: 4 }),
      rep({ user_id: "d", full_name: "Dana", overdue: 5 }),
    ]);
    expect(out.map((r) => r.user_id)).toEqual(["d", "c", "a", "b"]);
  });
});

describe("approveItems", () => {
  const ap = (p: Partial<UnifiedApproval> & { id: string }): UnifiedApproval => ({
    kind: "record",
    sourceRecordId: p.id,
    approvalType: "discount",
    step: null,
    entityLabel: null,
    entityId: null,
    clientContext: null,
    requesterId: null,
    requiredRole: "sales_manager",
    state: "pending",
    submittedAt: "2026-10-01T00:00:00Z",
    decidedAt: null,
    notes: null,
    evidence: null,
    href: "/approvals",
    ...p,
  });

  it("keeps pending manager decisions only, oldest first", () => {
    const out = approveItems([
      ap({ id: "new-discount", submittedAt: "2026-10-18T00:00:00Z" }),
      ap({ id: "old-bafo", kind: "bafo", approvalType: "bafo", submittedAt: "2026-10-02T00:00:00Z" }),
      ap({ id: "routine", approvalType: "ai_recommendation" }),
      ap({ id: "intake", kind: "intake", approvalType: "intake_review" }),
      ap({ id: "done", state: "approved" }),
    ]);
    expect(out.map((a) => a.id)).toEqual(["old-bafo", "new-discount"]);
  });
});

describe("meetingDay", () => {
  it("labels today, tomorrow and later by the Riyadh calendar date", () => {
    expect(meetingDay("2026-10-20T10:00", TODAY)).toBe("today");
    expect(meetingDay("2026-10-21T09:30", TODAY)).toBe("tomorrow");
    expect(meetingDay("2026-10-22T09:30", TODAY)).toBe("later");
    expect(meetingDay("2026-10-31T23:00", "2026-10-30")).toBe("tomorrow");
  });

  it("treats an event that started before today as still running today", () => {
    expect(meetingDay("2026-10-19T00:00", TODAY)).toBe("today");
    expect(meetingDay("2026-09-30T00:00", TODAY)).toBe("today");
  });
});
