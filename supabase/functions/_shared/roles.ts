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
  "salesperson",
  "viewer",
];

export const ROLE_GROUPS = {
  systemAdmin: ["system_admin"] as AppRole[],
  executive: ["managing_director", "general_manager", "ceo"] as AppRole[],
  salesManager: ["sales_manager"] as AppRole[],
  bdSalesOps: ["bd_manager", "sales_ops"] as AppRole[],
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

// Final delete execution — system_admin only, and only after a commercial
// manager has approved the underlying delete request via decide_approval.
export const canExecuteDelete = (r: RoleInput) => isSystemAdmin(r);
