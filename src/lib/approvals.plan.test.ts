// Approval Execution Engine — planning logic. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  planApprovalExecution,
  type ApprovalRow,
} from "../../supabase/functions/_shared/approvals";

function row(over: Partial<ApprovalRow>): ApprovalRow {
  return {
    id: "a1",
    status: "approved",
    approval_type: null,
    requested_action: null,
    requested_payload: null,
    linked_record_type: null,
    linked_record_id: null,
    related_opportunity_id: null,
    execution_status: "not_run",
    ...over,
  };
}

test("a non-approved approval never executes", () => {
  const plan = planApprovalExecution(row({ status: "pending", requested_action: "assign_owner", requested_payload: {} }));
  expect(plan).toEqual({ kind: "error", reason: "not_approved" });
});

test("a returned approval never executes", () => {
  const plan = planApprovalExecution(row({ status: "returned", requested_action: "assign_owner", requested_payload: {} }));
  expect(plan.kind).toBe("error");
});

test("an already-executed approval is a safe error (no double execute)", () => {
  const plan = planApprovalExecution(
    row({ requested_action: "advance_sales_stage", requested_payload: { opportunityId: "o1" }, execution_status: "executed" }),
  );
  expect(plan).toEqual({ kind: "error", reason: "already_executed" });
});

test("a captured requested_action + payload plans an execution", () => {
  const payload = { opportunityId: "o1", toStage: "verbally_awarded", fields: {} };
  const plan = planApprovalExecution(row({ requested_action: "advance_sales_stage", requested_payload: payload }));
  expect(plan).toEqual({ kind: "execute", action: "advance_sales_stage", payload });
});

test("a requested_action with no payload is missing_payload", () => {
  const plan = planApprovalExecution(row({ requested_action: "advance_sales_stage", requested_payload: null }));
  expect(plan).toEqual({ kind: "error", reason: "missing_payload" });
});

test("an unknown requested_action is rejected", () => {
  const plan = planApprovalExecution(row({ requested_action: "drop_database", requested_payload: {} }));
  expect(plan).toEqual({ kind: "error", reason: "unknown_action" });
});

test("legacy TENDER_TO_JIH_APPROVAL maps to a conversion using the linked record", () => {
  const plan = planApprovalExecution(
    row({ approval_type: "TENDER_TO_JIH_APPROVAL", linked_record_type: "tender", linked_record_id: "t9" }),
  );
  expect(plan).toEqual({ kind: "execute", action: "execute_tender_conversion", payload: { tenderId: "t9" } });
});

test("legacy conversion with no linked record is missing_linked_record", () => {
  const plan = planApprovalExecution(row({ approval_type: "TENDER_TO_JIH_APPROVAL" }));
  expect(plan).toEqual({ kind: "error", reason: "missing_linked_record" });
});

test("exception approval types authorize only (no direct mutation)", () => {
  for (const t of ["below_300k_exception", "commercial_exception"]) {
    const plan = planApprovalExecution(row({ approval_type: t }));
    expect(plan).toEqual({ kind: "authorize_only", approvalType: t });
  }
});

test("an unrecognised legacy approval_type is not auto-executed", () => {
  const plan = planApprovalExecution(row({ approval_type: "SOME_OLD_TYPE", related_opportunity_id: "o1" }));
  expect(plan).toEqual({ kind: "error", reason: "unknown_action" });
});
