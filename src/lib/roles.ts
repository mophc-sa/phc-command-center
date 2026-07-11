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
