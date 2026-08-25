// Capability semantics — the security-critical rules. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  ALL_ROLES,
  canApproveBafoCost,
  canApproveBafoFinal,
  canApproveBafoFinance,
  canReviewBafoCommercial,
  ALL_ROLES,
  isSystemAdmin,
  isExecutive,
  isSalesManager,
  isBdOrSalesOps,
  isFinanceManager,
  isEstimationManager,
  isSalesperson,
  isViewer,
  canApproveCommercialAction,
  canAssignOwner,
  canChangeCommercialStage,
  canRunSensitiveSalesAction,
  canViewSalesAdmin,
  canManageTeam,
  canReviewAiOutput,
  canManageSalesPipeline,
  canCreateSalesRecords,
  canExecuteDelete,
  canUseDiscussion,
  type AppRole,
} from "./roles";

test("group predicates partition every role into exactly one group", () => {
  const groupPredicates = [
    isSystemAdmin,
    isExecutive,
    isSalesManager,
    isBdOrSalesOps,
    isFinanceManager,
    isEstimationManager,
    isSalesperson,
    isViewer,
  ];
  for (const role of ALL_ROLES) {
    const memberships = groupPredicates.filter((p) => p(role)).length;
    expect(memberships, `role ${role} should belong to exactly one group`).toBe(1);
  }
});

test("system_admin can administer but CANNOT approve commercial actions", () => {
  const role: AppRole = "system_admin";
  expect(canApproveCommercialAction(role)).toBe(false);
  expect(canAssignOwner(role)).toBe(false);
  expect(canChangeCommercialStage(role)).toBe(false);
  expect(canRunSensitiveSalesAction(role)).toBe(false);
  // ...but it IS a platform administrator.
  expect(canViewSalesAdmin(role)).toBe(true);
  expect(canManageTeam(role)).toBe(true);
});

test("executives and sales_manager hold commercial authority", () => {
  for (const role of ["managing_director", "general_manager", "ceo", "sales_manager"] as AppRole[]) {
    expect(canApproveCommercialAction(role), role).toBe(true);
    expect(canAssignOwner(role), role).toBe(true);
    expect(canChangeCommercialStage(role), role).toBe(true);
  }
});

test("bd_manager / sales_ops run pipeline work but hold no commercial sign-off", () => {
  for (const role of ["bd_manager", "sales_ops"] as AppRole[]) {
    expect(canManageSalesPipeline(role), role).toBe(true);
    expect(canApproveCommercialAction(role), role).toBe(false);
    expect(canAssignOwner(role), role).toBe(false);
  }
});

test("salesperson and viewer have no management capabilities", () => {
  for (const role of ["salesperson", "viewer"] as AppRole[]) {
    expect(canApproveCommercialAction(role), role).toBe(false);
    expect(canManageTeam(role), role).toBe(false);
    expect(canManageSalesPipeline(role), role).toBe(false);
    expect(canViewSalesAdmin(role), role).toBe(false);
  }
});

test("helpers accept a multi-role array (a user's full role set)", () => {
  expect(canApproveCommercialAction(["viewer", "sales_manager"])).toBe(true);
  expect(canApproveCommercialAction(["viewer", "salesperson"])).toBe(false);
  expect(canManageSalesPipeline(["salesperson", "bd_manager"])).toBe(true);
});

test("canCreateSalesRecords includes salesperson (unlike canManageSalesPipeline)", () => {
  for (const role of ["managing_director", "general_manager", "ceo", "sales_manager", "bd_manager", "sales_ops", "salesperson"] as AppRole[]) {
    expect(canCreateSalesRecords(role), role).toBe(true);
  }
  for (const role of ["system_admin", "viewer"] as AppRole[]) {
    expect(canCreateSalesRecords(role), role).toBe(false);
  }
});

test("canExecuteDelete is system_admin and bd_manager (Development Manager) only", () => {
  expect(canExecuteDelete("system_admin")).toBe(true);
  expect(canExecuteDelete("bd_manager")).toBe(true);
  for (const role of [
    "managing_director", "general_manager", "ceo", "sales_manager", "sales_ops", "salesperson", "viewer",
  ] as AppRole[]) {
    expect(canExecuteDelete(role), role).toBe(false);
  }
});

test("canUseDiscussion is General Manager, Sales Manager, Development Manager, System Admin only", () => {
  for (const role of ["general_manager", "sales_manager", "bd_manager", "system_admin"] as AppRole[]) {
    expect(canUseDiscussion(role), role).toBe(true);
  }
  for (const role of [
    "managing_director", "ceo", "sales_ops", "finance_manager", "estimation_manager", "salesperson", "viewer",
  ] as AppRole[]) {
    expect(canUseDiscussion(role), role).toBe(false);
  }
});

test("system_admin and commercial managers can review AI outputs; nobody else can", () => {
  for (const role of ["system_admin", "managing_director", "general_manager", "ceo", "sales_manager"] as AppRole[]) {
    expect(canReviewAiOutput(role), role).toBe(true);
  }
  for (const role of ["bd_manager", "sales_ops", "salesperson", "viewer"] as AppRole[]) {
    expect(canReviewAiOutput(role), role).toBe(false);
  }
});

// =============================================================================
// BAFO approval chain — only what is NOT already covered.
//
// I came here believing these four helpers had no behaviour coverage. They do:
// bafo-approval-chain-frontend.contract.test.ts already calls each one, and
// already pins the system_admin invariants (alone, plus-a-role, and that
// holding it changes nothing). My first search missed them because it excluded
// files matching "contract", which is exactly where this repo keeps behaviour
// tests alongside its wiring greps.
//
// So the per-step and system_admin assertions are NOT repeated here. Two gaps
// are real, and only those are added.
// =============================================================================

const BAFO_STEPS = [
  { name: "commercial_review", can: canReviewBafoCommercial, allowed: ["bd_manager", "sales_manager"] },
  { name: "cost_approval", can: canApproveBafoCost, allowed: ["estimation_manager"] },
  { name: "finance_review", can: canApproveBafoFinance, allowed: ["finance_manager"] },
  { name: "final_approval", can: canApproveBafoFinal, allowed: ["managing_director", "general_manager", "ceo"] },
] as const;

// Gap 1: the existing tests name the roles they expect to pass and fail. A role
// added to ALL_ROLES later is checked by neither, so it could gain a step
// silently. Sweeping the canonical list closes that.
for (const step of BAFO_STEPS) {
  test(`BAFO ${step.name} admits exactly its business roles, across every known role`, () => {
    for (const role of ALL_ROLES) {
      const expected = (step.allowed as readonly string[]).includes(role);
      expect(step.can(role), `${step.name} / ${role}`).toBe(expected);
    }
  });
}

// Gap 2: D12 records that Finance and Estimation are one person at PHC (Ahmed
// Zaid) and that the system deliberately does NOT force those two steps onto
// different people. Pinned so a later "tighten separation of duties" change has
// to argue with the decision rather than quietly break a real workflow.
test("one person may hold both cost and finance, by decision (D12)", () => {
  const zaid: AppRole[] = ["estimation_manager", "finance_manager"];
  expect(canApproveBafoCost(zaid)).toBe(true);
  expect(canApproveBafoFinance(zaid)).toBe(true);
  // The independent check is the executive step, which they do not hold.
  expect(canApproveBafoFinal(zaid)).toBe(false);
});
