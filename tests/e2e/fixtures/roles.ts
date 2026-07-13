/**
 * Role-based smoke test fixtures.
 *
 * Credentials live ONLY in environment variables. Missing credentials cause
 * tests to skip (not fail) — this is intentional so CI is green until the
 * dedicated non-production test accounts are provisioned.
 *
 * Required env vars per role (all optional — tests skip gracefully):
 *   TEST_SYSTEM_ADMIN_EMAIL      / TEST_SYSTEM_ADMIN_PASSWORD
 *   TEST_MANAGING_DIRECTOR_EMAIL / TEST_MANAGING_DIRECTOR_PASSWORD
 *   TEST_GENERAL_MANAGER_EMAIL   / TEST_GENERAL_MANAGER_PASSWORD
 *   TEST_SALES_MANAGER_EMAIL     / TEST_SALES_MANAGER_PASSWORD
 *   TEST_BD_MANAGER_EMAIL        / TEST_BD_MANAGER_PASSWORD
 *   TEST_SALES_OPS_EMAIL         / TEST_SALES_OPS_PASSWORD
 *   TEST_SALESPERSON_EMAIL       / TEST_SALESPERSON_PASSWORD
 *   TEST_VIEWER_EMAIL            / TEST_VIEWER_PASSWORD
 *   TEST_CEO_EMAIL               / TEST_CEO_PASSWORD   (legacy role)
 *
 * Status-quarantine accounts (Sprint 1B/1F):
 *   TEST_PENDING_EMAIL           / TEST_PENDING_PASSWORD   (status = pending_approval)
 *   TEST_SUSPENDED_EMAIL         / TEST_SUSPENDED_PASSWORD (status = suspended)
 *
 * Never commit real employee passwords. Use dedicated non-production accounts.
 */

export type RoleName =
  | "system_admin"
  | "managing_director"
  | "general_manager"
  | "ceo"
  | "sales_manager"
  | "bd_manager"
  | "sales_ops"
  | "salesperson"
  | "viewer";

export type RoleCredentials = {
  role: RoleName;
  email: string;
  password: string;
};

const ENV_KEYS: Record<RoleName, { email: string; password: string }> = {
  system_admin: { email: "TEST_SYSTEM_ADMIN_EMAIL", password: "TEST_SYSTEM_ADMIN_PASSWORD" },
  managing_director: {
    email: "TEST_MANAGING_DIRECTOR_EMAIL",
    password: "TEST_MANAGING_DIRECTOR_PASSWORD",
  },
  general_manager: {
    email: "TEST_GENERAL_MANAGER_EMAIL",
    password: "TEST_GENERAL_MANAGER_PASSWORD",
  },
  ceo: { email: "TEST_CEO_EMAIL", password: "TEST_CEO_PASSWORD" },
  sales_manager: { email: "TEST_SALES_MANAGER_EMAIL", password: "TEST_SALES_MANAGER_PASSWORD" },
  bd_manager: { email: "TEST_BD_MANAGER_EMAIL", password: "TEST_BD_MANAGER_PASSWORD" },
  sales_ops: { email: "TEST_SALES_OPS_EMAIL", password: "TEST_SALES_OPS_PASSWORD" },
  salesperson: { email: "TEST_SALESPERSON_EMAIL", password: "TEST_SALESPERSON_PASSWORD" },
  viewer: { email: "TEST_VIEWER_EMAIL", password: "TEST_VIEWER_PASSWORD" },
};

export function getRoleCredentials(role: RoleName): RoleCredentials | null {
  const keys = ENV_KEYS[role];
  const email = process.env[keys.email];
  const password = process.env[keys.password];
  if (!email || !password) return null;
  return { role, email, password };
}

export const ALL_ROLES: RoleName[] = [
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

// Expected access matrix — used by role-matrix.spec.ts.
// `landing`    — the exact path the user should land on after sign-in (Sprint 1D contract).
// `allow/deny` — route path prefixes for the authorised / forbidden access tests.
export const ROLE_MATRIX: Record<
  RoleName,
  { landing: string; allow: string[]; deny: string[]; sidebarGroups: string[] }
> = {
  system_admin: {
    landing: "/admin-settings",
    allow: ["/admin-settings", "/settings"],
    deny: ["/approvals", "/award-queue"],
    sidebarGroups: ["nav_group_admin"],
  },
  managing_director: {
    landing: "/command-center",
    allow: ["/command-center", "/approvals", "/admin-settings"],
    deny: [],
    sidebarGroups: ["nav_group_overview", "nav_group_admin"],
  },
  general_manager: {
    landing: "/command-center",
    allow: ["/command-center", "/approvals", "/reports"],
    deny: [],
    sidebarGroups: ["nav_group_overview"],
  },
  ceo: {
    landing: "/command-center",
    allow: ["/command-center", "/approvals"],
    deny: [],
    sidebarGroups: ["nav_group_overview"],
  },
  sales_manager: {
    landing: "/command-center",
    allow: ["/command-center", "/opportunities", "/approvals", "/targets"],
    deny: [],
    sidebarGroups: ["nav_group_pipeline"],
  },
  bd_manager: {
    landing: "/lead-tender-inbox",
    allow: ["/lead-tender-inbox", "/accounts", "/contacts"],
    deny: [],
    sidebarGroups: ["nav_group_crm"],
  },
  sales_ops: {
    landing: "/lead-tender-inbox",
    allow: ["/lead-tender-inbox", "/contacts"],
    deny: [],
    sidebarGroups: ["nav_group_crm"],
  },
  salesperson: {
    landing: "/command-center",
    allow: ["/command-center", "/follow-ups", "/opportunities"],
    deny: ["/admin-settings"],
    sidebarGroups: ["nav_group_pipeline"],
  },
  viewer: {
    landing: "/command-center",
    allow: ["/command-center", "/reports"],
    deny: ["/admin-settings", "/approvals"],
    sidebarGroups: [],
  },
};
