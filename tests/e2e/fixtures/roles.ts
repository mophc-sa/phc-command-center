/**
 * Role-based smoke test fixtures.
 *
 * Credentials live ONLY in environment variables. Missing credentials cause
 * tests to skip (not fail) — this is intentional so CI is green until the
 * dedicated non-production test accounts are provisioned in Phase B.
 *
 * Required env vars per role (all optional in Phase A):
 *   TEST_MANAGING_DIRECTOR_EMAIL / _PASSWORD
 *   TEST_GENERAL_MANAGER_EMAIL   / _PASSWORD
 *   TEST_SALES_MANAGER_EMAIL     / _PASSWORD
 *   TEST_BD_MANAGER_EMAIL        / _PASSWORD
 *   TEST_SALESPERSON_EMAIL       / _PASSWORD
 *   TEST_VIEWER_EMAIL            / _PASSWORD
 *   TEST_SYSTEM_ADMIN_EMAIL      / _PASSWORD
 *
 * Never commit real employee passwords. Use dedicated non-production accounts.
 */

export type RoleName =
  | "system_admin"
  | "managing_director"
  | "general_manager"
  | "sales_manager"
  | "bd_manager"
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
  sales_manager: { email: "TEST_SALES_MANAGER_EMAIL", password: "TEST_SALES_MANAGER_PASSWORD" },
  bd_manager: { email: "TEST_BD_MANAGER_EMAIL", password: "TEST_BD_MANAGER_PASSWORD" },
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
  "sales_manager",
  "bd_manager",
  "salesperson",
  "viewer",
];

// Expected access matrix — used by role-matrix.spec.ts.
// allow/deny are route path prefixes (SSR-safe substring match on URL).
export const ROLE_MATRIX: Record<
  RoleName,
  { allow: string[]; deny: string[]; sidebarGroups: string[] }
> = {
  system_admin: {
    allow: ["/agent-activity", "/admin-settings", "/settings"],
    deny: ["/approvals", "/award-queue", "/team"],
    sidebarGroups: ["nav_group_admin"],
  },
  managing_director: {
    allow: ["/command-center", "/approvals", "/team", "/admin-settings"],
    deny: [],
    sidebarGroups: ["nav_group_overview", "nav_group_admin"],
  },
  general_manager: {
    allow: ["/command-center", "/approvals", "/reports"],
    deny: [],
    sidebarGroups: ["nav_group_overview"],
  },
  sales_manager: {
    allow: ["/command-center", "/opportunities", "/approvals", "/targets"],
    deny: [],
    sidebarGroups: ["nav_group_pipeline"],
  },
  bd_manager: {
    allow: ["/my-workspace", "/accounts", "/contacts", "/discovery"],
    deny: [],
    sidebarGroups: ["nav_group_crm"],
  },
  salesperson: {
    allow: ["/my-workspace", "/follow-ups", "/opportunities"],
    deny: ["/admin-settings", "/team"],
    sidebarGroups: ["nav_group_pipeline"],
  },
  viewer: {
    allow: ["/command-center", "/reports"],
    deny: ["/admin-settings", "/approvals", "/team"],
    sidebarGroups: [],
  },
};
