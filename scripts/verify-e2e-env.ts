const required = [
  "TEST_SYSTEM_ADMIN_EMAIL",
  "TEST_SYSTEM_ADMIN_PASSWORD",
  "TEST_MANAGING_DIRECTOR_EMAIL",
  "TEST_MANAGING_DIRECTOR_PASSWORD",
  "TEST_GENERAL_MANAGER_EMAIL",
  "TEST_GENERAL_MANAGER_PASSWORD",
  "TEST_SALES_MANAGER_EMAIL",
  "TEST_SALES_MANAGER_PASSWORD",
  "TEST_BD_MANAGER_EMAIL",
  "TEST_BD_MANAGER_PASSWORD",
  "TEST_SALES_OPS_EMAIL",
  "TEST_SALES_OPS_PASSWORD",
  "TEST_SALESPERSON_EMAIL",
  "TEST_SALESPERSON_PASSWORD",
  "TEST_VIEWER_EMAIL",
  "TEST_VIEWER_PASSWORD",
  "TEST_PENDING_EMAIL",
  "TEST_PENDING_PASSWORD",
  "TEST_SUSPENDED_EMAIL",
  "TEST_SUSPENDED_PASSWORD",
] as const;

const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(
    `Production-readiness E2E cannot run: ${missing.length} required secret(s) are missing:\n${missing.join("\n")}`,
  );
  process.exit(1);
}

console.log(`Production-readiness credentials present: ${required.length}/${required.length}.`);
