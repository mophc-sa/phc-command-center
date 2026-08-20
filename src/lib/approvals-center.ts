// =============================================================================
// PHC Sales OS — Unified Approvals model (Phase 4).
//
// Three independent approval workflows already exist, each with its own table
// and its own notion of "who decides":
//
//   approvals     — owner grants, tender conversions, delete requests.
//                   One decision, one assigned_approver.
//   bafo_requests — a four-step chain (commercial → cost → finance → final),
//                   each step gated on a different business role by
//                   protect_bafo_step_transitions().
//   inbox_items   — the Phase 2 intake gate (review_state), decided by
//                   can_review_intake().
//
// Phase 4 gives them one queue to look at. It does NOT give them one
// authorization model: every decision still goes back to its own table through
// its own action, and the database triggers remain the enforcement point. What
// this file computes is only *which step is currently waiting* and *which role
// it is waiting on*, so the queue can show it and hide buttons the viewer
// cannot use. A wrong answer here is a cosmetic bug, never a privilege
// escalation — the trigger rejects the write regardless.
//
// Pure: no I/O. See approvals-center.test.ts.
// =============================================================================

import type { AppRole } from "@/lib/roles";
import {
  canApproveBafoCost,
  canApproveBafoFinal,
  canApproveBafoFinance,
  canApproveCommercialAction,
  canReviewBafoCommercial,
  canReviewIntake,
} from "@/lib/roles";

export type ApprovalKind = "record" | "bafo" | "intake";

export type UnifiedApproval = {
  id: string;
  kind: ApprovalKind;
  sourceRecordId: string;
  /** Human label of what is being decided. */
  approvalType: string;
  /** The step currently waiting, for multi-step chains. */
  step: string | null;
  entityLabel: string | null;
  entityId: string | null;
  clientContext: string | null;
  requesterId: string | null;
  requiredRole: string;
  state: "pending" | "approved" | "rejected" | "other";
  submittedAt: string;
  decidedAt: string | null;
  notes: string | null;
  evidence: string | null;
  href: string;
};

// ---- BAFO chain -------------------------------------------------------------

export const BAFO_STEPS = [
  { key: "commercial_review", label: "Commercial review", role: "bd_manager / sales_manager" },
  { key: "cost_approval", label: "Cost approval", role: "estimation_manager" },
  { key: "finance_review", label: "Finance review", role: "finance_manager" },
  { key: "final_approval", label: "Final approval", role: "executive" },
] as const;

export type BafoStepKey = (typeof BAFO_STEPS)[number]["key"];

export type BafoRowIn = {
  id: string;
  opportunity_id: string | null;
  requested_by: string | null;
  proposed_value: number | null;
  proposed_discount_pct: number | null;
  justification: string | null;
  status: string | null;
  commercial_review_status: string | null;
  cost_approval_status: string | null;
  finance_review_status: string | null;
  final_approval_status: string | null;
  commercial_review_notes?: string | null;
  cost_approval_notes?: string | null;
  finance_review_notes?: string | null;
  final_approval_notes?: string | null;
  created_at: string;
  updated_at?: string | null;
};

const STEP_STATUS: Record<BafoStepKey, keyof BafoRowIn> = {
  commercial_review: "commercial_review_status",
  cost_approval: "cost_approval_status",
  finance_review: "finance_review_status",
  final_approval: "final_approval_status",
};

/**
 * The first step that has not been approved. The chain is strictly ordered, so
 * a later step is irrelevant until the earlier one clears — that ordering is
 * the whole point of a four-step control.
 *
 * Returns null when every step is approved, or when any step was rejected (a
 * rejected chain is finished, not waiting).
 */
export function currentBafoStep(r: BafoRowIn): BafoStepKey | null {
  for (const s of BAFO_STEPS) {
    const v = (r[STEP_STATUS[s.key]] as string | null) ?? "pending";
    if (v === "rejected" || v === "returned") return null;
    if (v !== "approved") return s.key;
  }
  return null;
}

export function bafoStepLabel(k: BafoStepKey): string {
  return BAFO_STEPS.find((s) => s.key === k)?.label ?? k;
}

export function bafoStepRole(k: BafoStepKey): string {
  return BAFO_STEPS.find((s) => s.key === k)?.role ?? "—";
}

/**
 * May this viewer decide the given BAFO step?
 *
 * Delegates to the same helpers the rest of the app uses, so the Phase 1
 * governance rule — `system_admin` alone holds none of these — is inherited
 * rather than restated. Restating it here would be a second place to forget it.
 */
export function canDecideBafoStep(k: BafoStepKey, roles: AppRole[] | AppRole | null | undefined): boolean {
  switch (k) {
    case "commercial_review":
      return canReviewBafoCommercial(roles);
    case "cost_approval":
      return canApproveBafoCost(roles);
    case "finance_review":
      return canApproveBafoFinance(roles);
    case "final_approval":
      return canApproveBafoFinal(roles);
    default:
      return false;
  }
}

// ---- Projections ------------------------------------------------------------

export type RecordApprovalRowIn = {
  id: string;
  approval_type: string | null;
  status: string | null;
  related_opportunity_id: string | null;
  requested_by: string | null;
  assigned_approver: string | null;
  decision_notes: string | null;
  created_at: string;
  decided_at: string | null;
  opportunities?: { id: string; project_name: string | null; client: string | null } | null;
};

export type IntakeApprovalRowIn = {
  id: string;
  project_name: string | null;
  company_name: string | null;
  review_state: string | null;
  request_type: string | null;
  created_by: string | null;
  assigned_owner_id: string | null;
  review_notes: string | null;
  reject_reason: string | null;
  has_boq?: boolean | null;
  has_drawings?: boolean | null;
  has_specs?: boolean | null;
  created_at: string;
  reviewed_at: string | null;
};

function recordState(s: string | null): UnifiedApproval["state"] {
  if (s === "pending") return "pending";
  if (s === "approved") return "approved";
  if (s === "returned" || s === "rejected") return "rejected";
  return "other";
}

export function fromRecordApproval(a: RecordApprovalRowIn): UnifiedApproval {
  return {
    id: `record:${a.id}`,
    kind: "record",
    sourceRecordId: a.id,
    approvalType: a.approval_type ?? "approval",
    step: null,
    entityLabel: a.opportunities?.project_name ?? null,
    entityId: a.related_opportunity_id,
    clientContext: a.opportunities?.client ?? null,
    requesterId: a.requested_by,
    // These are the commercial decisions Phase 1 kept away from system_admin.
    requiredRole: "executive / sales_manager",
    state: recordState(a.status),
    submittedAt: a.created_at,
    decidedAt: a.decided_at,
    notes: a.decision_notes,
    evidence: null,
    href: a.related_opportunity_id ? `/opportunities/${a.related_opportunity_id}` : "/approvals",
  };
}

export function fromBafo(r: BafoRowIn, projectName?: string | null): UnifiedApproval {
  const step = currentBafoStep(r);
  const rejected = !step && BAFO_STEPS.some((s) => {
    const v = (r[STEP_STATUS[s.key]] as string | null) ?? "pending";
    return v === "rejected" || v === "returned";
  });
  const evidenceBits = [
    r.proposed_value != null ? `Value ${r.proposed_value}` : null,
    r.proposed_discount_pct != null ? `Discount ${r.proposed_discount_pct}%` : null,
  ].filter(Boolean);

  return {
    id: `bafo:${r.id}`,
    kind: "bafo",
    sourceRecordId: r.id,
    approvalType: "BAFO",
    step: step ? bafoStepLabel(step) : null,
    entityLabel: projectName ?? null,
    entityId: r.opportunity_id,
    clientContext: null,
    requesterId: r.requested_by,
    requiredRole: step ? bafoStepRole(step) : "—",
    state: step ? "pending" : rejected ? "rejected" : "approved",
    submittedAt: r.created_at,
    decidedAt: step ? null : (r.updated_at ?? null),
    notes: r.justification,
    evidence: evidenceBits.length ? evidenceBits.join(" · ") : null,
    href: r.opportunity_id ? `/opportunities/${r.opportunity_id}` : "/quotations",
  };
}

export function fromIntakeApproval(o: IntakeApprovalRowIn): UnifiedApproval {
  // Which documents arrived is the evidence a reviewer actually weighs.
  const docs = [
    o.has_boq ? "BOQ" : null,
    o.has_drawings ? "Drawings" : null,
    o.has_specs ? "Specs" : null,
  ].filter(Boolean);

  return {
    id: `intake:${o.id}`,
    kind: "intake",
    sourceRecordId: o.id,
    approvalType: "Intake review",
    step: null,
    entityLabel: o.project_name ?? o.company_name ?? null,
    entityId: o.id,
    clientContext: o.company_name,
    requesterId: o.created_by ?? o.assigned_owner_id,
    requiredRole: "sales_manager / bd_manager",
    state:
      o.review_state === "pending_review"
        ? "pending"
        : o.review_state === "approved_for_pricing"
          ? "approved"
          : o.review_state === "rejected"
            ? "rejected"
            : "other",
    submittedAt: o.created_at,
    decidedAt: o.reviewed_at,
    notes: o.review_notes ?? o.reject_reason,
    evidence: docs.length ? docs.join(" · ") : "No documents attached",
    href: "/lead-tender-inbox",
  };
}

// ---- Viewer capability ------------------------------------------------------

/**
 * Whether this viewer can act on a given queue row. Purely to decide whether to
 * render decision buttons — the database is still the authority.
 */
export function canDecide(
  a: UnifiedApproval,
  roles: AppRole[] | AppRole | null | undefined,
  rawBafo?: BafoRowIn,
): boolean {
  if (a.state !== "pending") return false;
  switch (a.kind) {
    case "record":
      return canApproveCommercialAction(roles);
    case "intake":
      return canReviewIntake(roles);
    case "bafo": {
      const step = rawBafo ? currentBafoStep(rawBafo) : null;
      return step ? canDecideBafoStep(step, roles) : false;
    }
    default:
      return false;
  }
}

// ---- Aging / ordering -------------------------------------------------------

export function ageDays(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 86_400_000));
}

/** Pending first, then oldest-waiting first — the queue's real priority. */
export function sortApprovals(list: UnifiedApproval[]): UnifiedApproval[] {
  return [...list].sort((a, b) => {
    if (a.state === "pending" && b.state !== "pending") return -1;
    if (b.state === "pending" && a.state !== "pending") return 1;
    return a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0;
  });
}
