// Capability semantics — the security-critical rules. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  ALL_ROLES,
  isSystemAdmin,
  isExecutive,
  isSalesManager,
  isBdOrSalesOps,
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
  type AppRole,
} from "./roles";

test("group predicates partition every role into exactly one group", () => {
  const groupPredicates = [
    isSystemAdmin,
    isExecutive,
    isSalesManager,
    isBdOrSalesOps,
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

test("canExecuteDelete is system_admin only — no commercial manager, no pipeline operator", () => {
  expect(canExecuteDelete("system_admin")).toBe(true);
  for (const role of [
    "managing_director", "general_manager", "ceo", "sales_manager", "bd_manager", "sales_ops", "salesperson", "viewer",
  ] as AppRole[]) {
    expect(canExecuteDelete(role), role).toBe(false);
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
