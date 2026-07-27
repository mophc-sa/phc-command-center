// =============================================================================
// PHC Sales OS — Canonical AppRole definition + capability helpers (APP CODE).
//
// SINGLE SOURCE OF TRUTH for roles in the browser/SSR layer. The Edge Function
// mirror lives in `supabase/functions/_shared/roles.ts` and MUST stay aligned —
// `src/lib/roles.contract.test.ts` fails the build if the two lists diverge.
//
// Role groups (per Sales OS spec):
//   1. System Admin  — technical/admin only, NO automatic commercial approval
//   2. Executive     — managing_director, general_manager, (legacy) ceo
//   3. Sales Manager — sales_manager
//   4. BD / Sales Ops — bd_manager, sales_ops
//   5. Salesperson   — salesperson
//   6. Viewer        — viewer
//
// Design rule: commercial approval authority is kept SEPARATE from technical
// administration. `system_admin` can manage the platform (users, imports,
// settings) but cannot approve commercial business decisions.
// =============================================================================

export type AppRole =
  | "system_admin"
  | "managing_director"
  | "general_manager"
  | "ceo" // legacy executive — retained because it exists in production data
  | "sales_manager"
  | "bd_manager"
  | "sales_ops"
  | "finance_manager"
  | "estimation_manager"
  | "salesperson"
  | "viewer";

// Canonical ordered list. Order is used for display (admin matrix columns).
export const ALL_ROLES: AppRole[] = [
  "system_admin",
  "managing_director",
  "general_manager",
  "ceo",
  "sales_manager",
  "bd_manager",
  "sales_ops",
  "finance_manager",
  "estimation_manager",
  "salesperson",
  "viewer",
];

// Legacy roles retained only for backwards compatibility with existing data.
export const LEGACY_ROLES: AppRole[] = ["ceo"];

// ---- Role groups ------------------------------------------------------------
export const ROLE_GROUPS = {
  systemAdmin: ["system_admin"] as AppRole[],
  executive: ["managing_director", "general_manager", "ceo"] as AppRole[],
  salesManager: ["sales_manager"] as AppRole[],
  bdSalesOps: ["bd_manager", "sales_ops"] as AppRole[],
  financeManager: ["finance_manager"] as AppRole[],
  estimationManager: ["estimation_manager"] as AppRole[],
  salesperson: ["salesperson"] as AppRole[],
  viewer: ["viewer"] as AppRole[],
} as const;

// Accept either a single role or a collection (a user usually holds several).
type RoleInput = AppRole | readonly AppRole[] | null | undefined;

function asList(input: RoleInput): readonly AppRole[] {
  if (input == null) return [];
  return Array.isArray(input) ? input : [input as AppRole];
}

function inGroup(input: RoleInput, group: readonly AppRole[]): boolean {
  return asList(input).some((r) => group.includes(r));
}

// ---- Role-group predicates --------------------------------------------------
export const isSystemAdmin = (r: RoleInput) => inGroup(r, ROLE_GROUPS.systemAdmin);
export const isExecutive = (r: RoleInput) => inGroup(r, ROLE_GROUPS.executive);
export const isSalesManager = (r: RoleInput) => inGroup(r, ROLE_GROUPS.salesManager);
export const isBdOrSalesOps = (r: RoleInput) => inGroup(r, ROLE_GROUPS.bdSalesOps);
export const isFinanceManager = (r: RoleInput) => inGroup(r, ROLE_GROUPS.financeManager);
export const isEstimationManager = (r: RoleInput) => inGroup(r, ROLE_GROUPS.estimationManager);
export const isSalesperson = (r: RoleInput) => inGroup(r, ROLE_GROUPS.salesperson);
export const isViewer = (r: RoleInput) => inGroup(r, ROLE_GROUPS.viewer);

// Convenience unions used by capability helpers below.
// Commercial managers = the people with commercial sign-off authority.
const COMMERCIAL_MANAGERS: AppRole[] = [...ROLE_GROUPS.executive, ...ROLE_GROUPS.salesManager];
// Pipeline operators = anyone who may drive day-to-day sales pipeline work.
const PIPELINE_OPERATORS: AppRole[] = [
  ...ROLE_GROUPS.executive,
  ...ROLE_GROUPS.salesManager,
  ...ROLE_GROUPS.bdSalesOps,
];

// ---- Capability helpers -----------------------------------------------------
// Commercial authority — deliberately EXCLUDES system_admin.
export const canApproveCommercialAction = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);
export const canAssignOwner = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);
export const canChangeCommercialStage = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);
export const canRunSensitiveSalesAction = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);

// Technical / administrative authority — system_admin IS allowed here.
export const canViewSalesAdmin = (r: RoleInput) =>
  inGroup(r, [...ROLE_GROUPS.systemAdmin, ...COMMERCIAL_MANAGERS]);
export const canManageTeam = (r: RoleInput) =>
  inGroup(r, [...ROLE_GROUPS.systemAdmin, ...COMMERCIAL_MANAGERS]);

// AI output review authority — system_admin (platform oversight) plus
// commercial managers (the people the outputs are actually for). Same role
// set as canViewSalesAdmin/canManageTeam, kept as its own named helper for
// call-site clarity, matching this file's existing pattern.
export const canReviewAiOutput = (r: RoleInput) =>
  inGroup(r, [...ROLE_GROUPS.systemAdmin, ...COMMERCIAL_MANAGERS]);

// Sales pipeline operations (qualify leads, drive tenders, author recommendations).
// BD / Sales Ops and above — not system_admin, not viewers.
export const canManageSalesPipeline = (r: RoleInput) => inGroup(r, PIPELINE_OPERATORS);

// Record creation (leads, contacts, companies, opportunities, RFQs, tenders,
// follow-ups, ...) — pipeline operators plus salesperson. Mirrors the DB
// helper public.is_sales_contributor(uuid) used in RLS INSERT policies.
export const canCreateSalesRecords = (r: RoleInput) =>
  inGroup(r, [...PIPELINE_OPERATORS, ...ROLE_GROUPS.salesperson]);

// Final delete execution — system_admin only, and only after a commercial
// manager has approved the underlying delete request via decide_approval.
export const canExecuteDelete = (r: RoleInput) => isSystemAdmin(r);

// Total Value (RFQ/opportunity) edit authority — per client spec
// (2026-07-27): Finance Manager, BD Manager, System Admin only. Deliberately
// NOT the general COMMERCIAL_MANAGERS set (sales_manager/executives are
// excluded here even though they hold broader commercial authority
// elsewhere) — this is a narrower, spec-specific grant.
export const canEditTotalValue = (r: RoleInput) =>
  inGroup(r, ["finance_manager", "bd_manager", "system_admin"]);

// Manual RFQ-number entry/edit authority — per client spec (2026-07-27):
// "Account Manager" (this codebase's existing term for the role is
// sales_manager — see account_owner_id/changeAccountOwner), BD Manager,
// System Admin. Mirrors the DB helper public.can_edit_rfq_number(uuid).
export const canEditRfqNumber = (r: RoleInput) =>
  inGroup(r, ["sales_manager", "bd_manager", "system_admin"]);

// Sees every rep's sales pipeline data (opportunities/RFQs/tenders/
// quotations/follow-ups), not just their own — mirrors the DB helper
// public.can_view_all_sales_data(uuid) used in RLS SELECT policies.
// finance_manager is included so Finance can actually reach the records
// whose Total Value they're permitted to set (canEditTotalValue above).
// viewer is included because it already had full read access to this data
// before the sales-data-isolation change (the old blanket SELECT
// policies) and nothing in the client spec asks to restrict viewer
// specifically — only salesperson is meant to lose visibility here.
export const canViewAllSalesData = (r: RoleInput) =>
  inGroup(r, [...PIPELINE_OPERATORS, ...ROLE_GROUPS.systemAdmin, ...ROLE_GROUPS.financeManager, ...ROLE_GROUPS.viewer]);

// ---- BAFO / commercial-discount approval chain ------------------------------
// Client spec (2026-07-27), section 12's proposed 4-step approval chain
// (a salesperson/BD rep negotiates and requests; these four decide, in
// order). Each mirrors a same-named DB helper used by bafo_requests'
// step-gating trigger — see 20260727220000_bafo_approval_chain.sql.
export const canRequestBafo = (r: RoleInput) => canCreateSalesRecords(r);
export const canReviewBafoCommercial = (r: RoleInput) =>
  inGroup(r, ["bd_manager", "sales_manager", "system_admin"]);
export const canApproveBafoCost = (r: RoleInput) =>
  inGroup(r, ["estimation_manager", "system_admin"]);
export const canApproveBafoFinance = (r: RoleInput) =>
  inGroup(r, ["finance_manager", "system_admin"]);
export const canApproveBafoFinal = (r: RoleInput) =>
  inGroup(r, [...ROLE_GROUPS.executive, ...ROLE_GROUPS.systemAdmin]);
