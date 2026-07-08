// =============================================================================
// PHC Sales OS — Approval Execution Engine: pure planning logic.
//
// This module contains NO I/O. Given an approval row it decides what should
// happen when the approval is approved. The sales-os-api handler performs the
// actual database mutations based on the returned plan. Keeping the decision
// pure makes it unit-testable (see src/lib/approvals.plan.test.ts) and keeps
// the security-critical branching in one small, reviewable place.
// =============================================================================

// Actions the engine knows how to execute after approval. These are the
// backend action names the ORIGINAL request captured in `requested_action`.
export const EXECUTABLE_ACTIONS = [
  "advance_sales_stage",
  "set_win_confidence",
  "execute_tender_conversion",
  "assign_owner",
  "update_opportunity_stage",
] as const;
export type ExecutableAction = (typeof EXECUTABLE_ACTIONS)[number];

// Approval types whose approval records AUTHORIZATION only — approving them does
// not mutate a business record; it unblocks a separate, later action (e.g. a
// sub-300k tender conversion). No auto-execution, but not an error either.
export const AUTHORIZATION_ONLY_TYPES = [
  "below_300k_exception",
  "commercial_exception",
];

export type ApprovalExecutionReason =
  | "not_approved"
  | "already_executed"
  | "unknown_action"
  | "missing_payload"
  | "missing_linked_record";

export type ApprovalRow = {
  id: string;
  status: string;
  approval_type: string | null;
  requested_action: string | null;
  requested_payload: Record<string, unknown> | null;
  linked_record_type: string | null;
  linked_record_id: string | null;
  related_opportunity_id: string | null;
  execution_status: string | null;
};

export type ApprovalPlan =
  | { kind: "execute"; action: ExecutableAction; payload: Record<string, unknown> }
  | { kind: "authorize_only"; approvalType: string }
  | { kind: "error"; reason: ApprovalExecutionReason };

function isExecutable(a: string): a is ExecutableAction {
  return (EXECUTABLE_ACTIONS as readonly string[]).includes(a);
}

// Map a few legacy approval_type values (created before requested_action
// existed) to the action they represent, so old pending approvals can still be
// executed where the linked record carries enough data.
const LEGACY_TYPE_TO_ACTION: Record<string, ExecutableAction> = {
  TENDER_TO_JIH_APPROVAL: "execute_tender_conversion",
};

// Decide what approving this row should do. Never throws.
export function planApprovalExecution(a: ApprovalRow): ApprovalPlan {
  if (a.status !== "approved") return { kind: "error", reason: "not_approved" };
  if (a.execution_status === "executed") return { kind: "error", reason: "already_executed" };

  // Preferred path: the request captured exactly what to run.
  if (a.requested_action) {
    if (!isExecutable(a.requested_action)) return { kind: "error", reason: "unknown_action" };
    if (!a.requested_payload) return { kind: "error", reason: "missing_payload" };
    return { kind: "execute", action: a.requested_action, payload: a.requested_payload };
  }

  const type = a.approval_type ?? "";
  if (AUTHORIZATION_ONLY_TYPES.includes(type)) {
    return { kind: "authorize_only", approvalType: type };
  }

  const legacy = LEGACY_TYPE_TO_ACTION[type];
  if (!legacy) return { kind: "error", reason: "unknown_action" };
  if (!a.linked_record_id && !a.related_opportunity_id) {
    return { kind: "error", reason: "missing_linked_record" };
  }
  const linkedId = a.linked_record_id ?? a.related_opportunity_id!;
  return { kind: "execute", action: legacy, payload: { tenderId: linkedId } };
}
