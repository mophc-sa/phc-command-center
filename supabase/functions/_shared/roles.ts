// =============================================================================
// PHC Sales OS — Canonical AppRole definition + capability helpers (EDGE / DENO).
//
// This is the server-side MIRROR of `src/lib/roles.ts`. The two files must stay
// aligned: the same role list, groups, and capability semantics. The app-side
// contract test (`src/lib/roles.contract.test.ts`) parses BOTH files and fails
// if the role lists diverge.
//
// Commercial approval authority is kept SEPARATE from technical administration:
// `system_admin` administers the platform but cannot approve commercial actions.
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

// Canonical ordered list — MUST match src/lib/roles.ts ALL_ROLES exactly.
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

const COMMERCIAL_MANAGERS: AppRole[] = [...ROLE_GROUPS.executive, ...ROLE_GROUPS.salesManager];
const PIPELINE_OPERATORS: AppRole[] = [
  ...ROLE_GROUPS.executive,
  ...ROLE_GROUPS.salesManager,
  ...ROLE_GROUPS.bdSalesOps,
];

// ---- Capability helpers -----------------------------------------------------
export const canApproveCommercialAction = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);

/**
 * Turning a read-only archive row into a live opportunity.
 *
 * A deliberate mirror of can_approve_historical_promotion() in
 * 20260829100000 — sales_manager, bd_manager, general_manager and nothing
 * else. Notably NOT system_admin: an operator is not a commercial
 * decision-maker, and the database says so too. This helper only produces a
 * clean 403 before the round trip; the database remains the authority and
 * refuses the call regardless of what the backend believes.
 */
export const canApproveHistoricalPromotion = (r: RoleInput) =>
  inGroup(r, ["sales_manager", "bd_manager", "general_manager"]);

export const canAssignOwner = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);
export const canChangeCommercialStage = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);
export const canRunSensitiveSalesAction = (r: RoleInput) => inGroup(r, COMMERCIAL_MANAGERS);
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

export const canManageSalesPipeline = (r: RoleInput) => inGroup(r, PIPELINE_OPERATORS);

// Record creation (leads, contacts, companies, opportunities, RFQs, tenders,
// follow-ups, ...) — pipeline operators plus salesperson. Mirrors the DB
// helper public.is_sales_contributor(uuid) used in RLS INSERT policies.
export const canCreateSalesRecords = (r: RoleInput) =>
  inGroup(r, [...PIPELINE_OPERATORS, ...ROLE_GROUPS.salesperson]);

// Final delete execution — system_admin and bd_manager (Development
// Manager), and only after a commercial manager has approved the
// underlying delete request via decide_approval. bd_manager mirrors
// system_admin's existing role in this chain exactly: neither can
// unilaterally delete — canApproveCommercialAction (executive + sales
// manager) is intentionally untouched, preserving the two-person rule for
// both roles.
export const canExecuteDelete = (r: RoleInput) => inGroup(r, ["system_admin", "bd_manager"]);

// Total Value (RFQ/opportunity) edit authority — per client spec
// (2026-07-27): Finance Manager, BD Manager, System Admin only.
export const canEditTotalValue = (r: RoleInput) =>
  inGroup(r, ["finance_manager", "bd_manager", "system_admin"]);

// Mirrors public.can_edit_rfq_number(uuid).
export const canEditRfqNumber = (r: RoleInput) =>
  inGroup(r, ["sales_manager", "bd_manager", "system_admin"]);

// Sees every rep's sales pipeline data, not just their own — mirrors
// public.can_view_all_sales_data(uuid) used in RLS SELECT policies.
export const canViewAllSalesData = (r: RoleInput) =>
  inGroup(r, [...PIPELINE_OPERATORS, ...ROLE_GROUPS.systemAdmin, ...ROLE_GROUPS.financeManager, ...ROLE_GROUPS.viewer]);

// BAFO / commercial-discount approval chain (client spec, 2026-07-27).
export const canRequestBafo = (r: RoleInput) => canCreateSalesRecords(r);
export const canReviewBafoCommercial = (r: RoleInput) =>
  inGroup(r, ["bd_manager", "sales_manager", "system_admin"]);
export const canApproveBafoCost = (r: RoleInput) =>
  inGroup(r, ["estimation_manager", "system_admin"]);
export const canApproveBafoFinance = (r: RoleInput) =>
  inGroup(r, ["finance_manager", "system_admin"]);
export const canApproveBafoFinal = (r: RoleInput) =>
  inGroup(r, [...ROLE_GROUPS.executive, ...ROLE_GROUPS.systemAdmin]);
