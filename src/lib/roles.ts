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

// Final delete execution — system_admin and bd_manager (Development
// Manager), and only after a commercial manager has approved the
// underlying delete request via decide_approval. bd_manager mirrors
// system_admin's existing role in this chain exactly: neither can
// unilaterally delete — canApproveCommercialAction (executive + sales
// manager) is intentionally untouched, preserving the two-person rule for
// both roles.
export const canExecuteDelete = (r: RoleInput) => inGroup(r, ["system_admin", "bd_manager"]);

// Total Value (RFQ/opportunity) edit authority — per client spec
// (2026-07-27): Finance Manager and BD Manager. Deliberately NOT the general
// COMMERCIAL_MANAGERS set (sales_manager/executives are excluded here even
// though they hold broader commercial authority elsewhere) — this is a
// narrower, spec-specific grant.
//
// Phase 1 governance (PRD 2026-08-12 §111–114): `system_admin` was removed
// from this list. Total Value is the commercial number the whole pipeline is
// judged on; platform administration is not a reason to be able to set it.
// An administrator who genuinely needs it holds finance_manager or
// bd_manager as a second role, and the authority comes from that role.
export const canEditTotalValue = (r: RoleInput) =>
  inGroup(r, ["finance_manager", "bd_manager"]);

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

// Discussion (opportunity_discussions) — General Manager, Sales Manager,
// Development Manager (bd_manager), System Administrator only. Mirrors the
// DB helper public.can_use_discussion(uuid), which is also enforced
// server-side via RLS — this client-side check only controls the UI.
export const canUseDiscussion = (r: RoleInput) =>
  inGroup(r, ["general_manager", "sales_manager", "bd_manager", "system_admin"]);

// ---- Intake / Opportunity Review (Phase 2) ----------------------------------
// PRD 2026-08-12 §15: a new request is reviewed by the Sales Manager OR the BD
// Manager before it can go to pricing — either one alone is sufficient, they do
// not both have to sign. Executives are included because they outrank both and
// already hold every commercial approval in this system.
//
// `system_admin` is deliberately absent, for the same reason it is absent from
// the BAFO chain: approving a request for pricing is a commercial judgement,
// not platform administration. Mirrors the DB helper
// public.can_review_intake(uuid), which enforces this server-side.
export const canReviewIntake = (r: RoleInput) =>
  inGroup(r, ["sales_manager", "bd_manager", ...ROLE_GROUPS.executive]);

// ---- BAFO / commercial-discount approval chain ------------------------------
// Client spec (2026-07-27), section 12's proposed 4-step approval chain
// (a salesperson/BD rep negotiates and requests; these four decide, in
// order). Each mirrors a same-named DB helper used by bafo_requests'
// step-gating trigger — see 20260727220000_bafo_approval_chain.sql.
//
// Phase 1 governance (PRD 2026-08-12 §111–114): `system_admin` held ALL FOUR
// steps as a "platform-admin override". One account with only that role could
// therefore originate a discount request and approve every check on it — the
// four-step control enforced an order, not four independent judgements. The
// override is removed at every step. A user who legitimately decides one of
// these holds the matching business role, and the authority comes from there;
// because roles are additive, `system_admin` + `finance_manager` still passes
// the finance step, and passes it *as* finance_manager.
export const canRequestBafo = (r: RoleInput) => canCreateSalesRecords(r);
export const canReviewBafoCommercial = (r: RoleInput) =>
  inGroup(r, ["bd_manager", "sales_manager"]);
export const canApproveBafoCost = (r: RoleInput) =>
  inGroup(r, ["estimation_manager"]);
export const canApproveBafoFinance = (r: RoleInput) =>
  inGroup(r, ["finance_manager"]);
export const canApproveBafoFinal = (r: RoleInput) =>
  inGroup(r, ROLE_GROUPS.executive);

// ---- Mandatory MFA (2026-08-02 security hardening) ---------------------------
// General Manager, Finance Manager, Sales Manager, System Administrator, and
// Managing Director (mapped from the "Administrative Manager" requirement —
// no such role exists separately in this system) hold the most sensitive
// commercial/technical authority and must enroll TOTP MFA and step up to
// AAL2 every session before reaching the app. Enforced in
// src/routes/_authenticated/route.tsx's beforeLoad and reused to scope the
// idle-timeout guard (src/hooks/useIdleLogout.ts) to the same role set.
export const MFA_REQUIRED_ROLES: AppRole[] = [
  "general_manager",
  "finance_manager",
  "sales_manager",
  "system_admin",
  "managing_director",
];
export const requiresMfa = (r: RoleInput) => inGroup(r, MFA_REQUIRED_ROLES);
