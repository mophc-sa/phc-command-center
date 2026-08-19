import { describe, expect, it } from "bun:test";
import {
  ageDays,
  bafoStepRole,
  canDecide,
  canDecideBafoStep,
  currentBafoStep,
  fromBafo,
  fromIntakeApproval,
  fromRecordApproval,
  sortApprovals,
  type BafoRowIn,
  type IntakeApprovalRowIn,
  type RecordApprovalRowIn,
} from "@/lib/approvals-center";
import type { AppRole } from "@/lib/roles";

function bafo(over: Partial<BafoRowIn> = {}): BafoRowIn {
  return {
    id: "b1",
    opportunity_id: "opp-1",
    requested_by: "u1",
    proposed_value: 100000,
    proposed_discount_pct: 5,
    justification: "Client pushed back on price",
    status: "pending",
    commercial_review_status: null,
    cost_approval_status: null,
    finance_review_status: null,
    final_approval_status: null,
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function record(over: Partial<RecordApprovalRowIn> = {}): RecordApprovalRowIn {
  return {
    id: "r1",
    approval_type: "owner_grant",
    status: "pending",
    related_opportunity_id: "opp-2",
    requested_by: "u2",
    assigned_approver: "u3",
    decision_notes: null,
    created_at: "2026-08-02T00:00:00Z",
    decided_at: null,
    opportunities: { id: "opp-2", project_name: "Riyadh Tower", client: "Acme" },
    ...over,
  };
}

function intakeRow(over: Partial<IntakeApprovalRowIn> = {}): IntakeApprovalRowIn {
  return {
    id: "i1",
    project_name: "New clinic",
    company_name: "Health Co",
    review_state: "pending_review",
    request_type: "jih",
    created_by: "u4",
    assigned_owner_id: "u4",
    review_notes: null,
    reject_reason: null,
    has_boq: true,
    has_drawings: false,
    has_specs: false,
    created_at: "2026-08-03T00:00:00Z",
    reviewed_at: null,
    ...over,
  };
}

// ---- BAFO chain -------------------------------------------------------------

describe("BAFO chain", () => {
  it("waits on the first unapproved step, in order", () => {
    expect(currentBafoStep(bafo())).toBe("commercial_review");
    expect(currentBafoStep(bafo({ commercial_review_status: "approved" }))).toBe("cost_approval");
    expect(
      currentBafoStep(bafo({ commercial_review_status: "approved", cost_approval_status: "approved" })),
    ).toBe("finance_review");
    expect(
      currentBafoStep(
        bafo({
          commercial_review_status: "approved",
          cost_approval_status: "approved",
          finance_review_status: "approved",
        }),
      ),
    ).toBe("final_approval");
  });

  it("is finished once every step is approved", () => {
    expect(
      currentBafoStep(
        bafo({
          commercial_review_status: "approved",
          cost_approval_status: "approved",
          finance_review_status: "approved",
          final_approval_status: "approved",
        }),
      ),
    ).toBeNull();
  });

  it("stops entirely when a step is rejected — a rejected chain is not waiting", () => {
    expect(currentBafoStep(bafo({ commercial_review_status: "rejected" }))).toBeNull();
    expect(
      currentBafoStep(bafo({ commercial_review_status: "approved", cost_approval_status: "rejected" })),
    ).toBeNull();
  });

  it("reports the required role per step", () => {
    expect(bafoStepRole("cost_approval")).toContain("estimation");
    expect(bafoStepRole("finance_review")).toContain("finance");
  });

  it("projects an in-flight chain as pending on its live step", () => {
    const a = fromBafo(bafo({ commercial_review_status: "approved" }), "Riyadh Tower");
    expect(a.state).toBe("pending");
    expect(a.step).toBe("Cost approval");
    expect(a.entityLabel).toBe("Riyadh Tower");
    expect(a.evidence).toContain("Discount 5%");
  });

  it("projects a rejected chain as rejected, not approved", () => {
    expect(fromBafo(bafo({ commercial_review_status: "rejected" })).state).toBe("rejected");
  });
});

// ---- Governance: system_admin holds no commercial authority -----------------

describe("Phase 1 governance is inherited, not restated", () => {
  const ADMIN: AppRole[] = ["system_admin"];

  it("system_admin alone can decide no BAFO step", () => {
    for (const step of ["commercial_review", "cost_approval", "finance_review", "final_approval"] as const) {
      expect(canDecideBafoStep(step, ADMIN)).toBe(false);
    }
  });

  it("system_admin alone cannot decide a record approval or an intake review", () => {
    expect(canDecide(fromRecordApproval(record()), ADMIN)).toBe(false);
    expect(canDecide(fromIntakeApproval(intakeRow()), ADMIN)).toBe(false);
  });

  it("the authority comes from the business role, and additive roles still work", () => {
    expect(canDecideBafoStep("finance_review", ["system_admin", "finance_manager"])).toBe(true);
    expect(canDecideBafoStep("cost_approval", ["estimation_manager"])).toBe(true);
    expect(canDecideBafoStep("commercial_review", ["bd_manager"])).toBe(true);
    expect(canDecideBafoStep("final_approval", ["general_manager"])).toBe(true);
  });

  it("a role that owns one step does not thereby own another", () => {
    expect(canDecideBafoStep("cost_approval", ["finance_manager"])).toBe(false);
    expect(canDecideBafoStep("final_approval", ["sales_manager"])).toBe(false);
  });
});

describe("canDecide", () => {
  it("is false for anything already decided", () => {
    const decided = fromRecordApproval(record({ status: "approved", decided_at: "2026-08-05T00:00:00Z" }));
    expect(canDecide(decided, ["general_manager"])).toBe(false);
  });

  it("lets a sales manager review intake but not a salesperson", () => {
    expect(canDecide(fromIntakeApproval(intakeRow()), ["sales_manager"])).toBe(true);
    expect(canDecide(fromIntakeApproval(intakeRow()), ["bd_manager"])).toBe(true);
    expect(canDecide(fromIntakeApproval(intakeRow()), ["salesperson"])).toBe(false);
    expect(canDecide(fromIntakeApproval(intakeRow()), ["viewer"])).toBe(false);
  });

  it("resolves the BAFO step from the raw row", () => {
    const raw = bafo({ commercial_review_status: "approved" });
    const a = fromBafo(raw);
    expect(canDecide(a, ["estimation_manager"], raw)).toBe(true);
    expect(canDecide(a, ["bd_manager"], raw)).toBe(false);
  });

  it("cannot decide a BAFO row without the raw record — fails closed", () => {
    expect(canDecide(fromBafo(bafo()), ["bd_manager"])).toBe(false);
  });
});

// ---- Intake projection ------------------------------------------------------

describe("intake approvals", () => {
  it("surfaces which documents arrived as the evidence", () => {
    expect(fromIntakeApproval(intakeRow()).evidence).toBe("BOQ");
    expect(
      fromIntakeApproval(intakeRow({ has_boq: true, has_drawings: true, has_specs: true })).evidence,
    ).toBe("BOQ · Drawings · Specs");
  });

  it("says so plainly when nothing was attached", () => {
    expect(
      fromIntakeApproval(intakeRow({ has_boq: false, has_drawings: false, has_specs: false })).evidence,
    ).toBe("No documents attached");
  });

  it("maps review_state onto the queue state", () => {
    expect(fromIntakeApproval(intakeRow()).state).toBe("pending");
    expect(fromIntakeApproval(intakeRow({ review_state: "approved_for_pricing" })).state).toBe("approved");
    expect(fromIntakeApproval(intakeRow({ review_state: "rejected" })).state).toBe("rejected");
    expect(fromIntakeApproval(intakeRow({ review_state: "monitored" })).state).toBe("other");
  });

  it("links to the inbox, where the record actually lives", () => {
    expect(fromIntakeApproval(intakeRow()).href).toBe("/lead-tender-inbox");
  });
});

// ---- Ordering ---------------------------------------------------------------

describe("queue ordering", () => {
  it("puts pending first, then the longest-waiting", () => {
    const list = [
      fromRecordApproval(record({ id: "old-approved", status: "approved", created_at: "2026-01-01T00:00:00Z" })),
      fromRecordApproval(record({ id: "new-pending", created_at: "2026-08-10T00:00:00Z" })),
      fromRecordApproval(record({ id: "old-pending", created_at: "2026-02-01T00:00:00Z" })),
    ];
    expect(sortApprovals(list).map((a) => a.sourceRecordId)).toEqual([
      "old-pending",
      "new-pending",
      "old-approved",
    ]);
  });

  it("ageDays counts whole days and never goes negative", () => {
    const now = Date.parse("2026-08-19T00:00:00Z");
    expect(ageDays("2026-08-16T00:00:00Z", now)).toBe(3);
    expect(ageDays("2026-08-20T00:00:00Z", now)).toBe(0);
    expect(ageDays(null, now)).toBeNull();
    expect(ageDays("not a date", now)).toBeNull();
  });
});
