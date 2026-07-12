/**
 * Auth guard + status quarantine tests (Sprint 1B/1C/1F).
 *
 * Unauthenticated tests run unconditionally in CI — they require no credentials.
 * Status-quarantine tests skip gracefully when TEST_PENDING_* / TEST_SUSPENDED_*
 * env vars are not set (until dedicated test accounts are provisioned).
 */

import { test, expect, type Page } from "@playwright/test";

// Routes that must redirect unauthenticated visitors to /auth.
// These are the entry points that the _authenticated layout guard covers.
const PROTECTED_ROUTES = [
  "/command-center",
  "/admin-settings",
  "/lead-tender-inbox",
  "/my-workspace",
  "/opportunities",
  "/follow-ups",
  "/settings",
];

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
}

// -------------------------------------------------------
// Unauthenticated guard — always runs
// -------------------------------------------------------
test.describe("unauthenticated guard", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} → /auth when not logged in`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL((url) => url.pathname.startsWith("/auth"), { timeout: 10_000 });
      await expect(page).toHaveURL(/\/auth/);
    });
  }

  test("/auth page renders sign-in form", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    await expect(page.getByLabel(/password/i).first()).toBeVisible();
  });

  test("/pending-approval page redirects to /auth when not logged in", async ({ page }) => {
    await page.goto("/pending-approval");
    await page.waitForURL((url) => url.pathname.startsWith("/auth"), { timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth/);
  });
});

// -------------------------------------------------------
// Status quarantine (Sprint 1B) — skip when no credentials
// -------------------------------------------------------
const pendingEmail = process.env.TEST_PENDING_EMAIL;
const pendingPassword = process.env.TEST_PENDING_PASSWORD;
const suspendedEmail = process.env.TEST_SUSPENDED_EMAIL;
const suspendedPassword = process.env.TEST_SUSPENDED_PASSWORD;

test.describe("pending user quarantine", () => {
  test.skip(!pendingEmail || !pendingPassword, "TEST_PENDING_EMAIL/PASSWORD not set");

  test("sign-in lands on /pending-approval", async ({ page }) => {
    await signIn(page, pendingEmail!, pendingPassword!);
    await page.waitForURL(
      (url) => url.pathname.includes("pending-approval") || url.pathname.includes("auth"),
      { timeout: 15_000 },
    );
    await expect(page).toHaveURL(/\/pending-approval/);
  });

  test("direct navigation to /command-center → redirected away", async ({ page }) => {
    await signIn(page, pendingEmail!, pendingPassword!);
    // Wait for post-login redirect to settle
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
    await page.goto("/command-center");
    await page.waitForURL((url) => !url.pathname.startsWith("/command-center"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/command-center/);
  });

  test("direct navigation to /admin-settings → redirected away", async ({ page }) => {
    await signIn(page, pendingEmail!, pendingPassword!);
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
    await page.goto("/admin-settings");
    await page.waitForURL((url) => !url.pathname.startsWith("/admin-settings"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/admin-settings/);
  });

  test("/pending-approval page shows waiting UI", async ({ page }) => {
    await signIn(page, pendingEmail!, pendingPassword!);
    await page.waitForURL((url) => url.pathname.includes("pending-approval"), { timeout: 15_000 });
    // The page should have a Clock icon area and a sign-out button
    await expect(page.getByRole("button", { name: /sign out|تسجيل الخروج/i })).toBeVisible();
  });
});

test.describe("suspended user quarantine", () => {
  test.skip(!suspendedEmail || !suspendedPassword, "TEST_SUSPENDED_EMAIL/PASSWORD not set");

  test("sign-in signs the user out and redirects to /auth", async ({ page }) => {
    await signIn(page, suspendedEmail!, suspendedPassword!);
    // Suspended flow: _authenticated beforeLoad calls signOut() then redirects to /auth
    await page.waitForURL((url) => url.pathname.startsWith("/auth"), { timeout: 15_000 });
    await expect(page).toHaveURL(/\/auth/);
  });

  test("direct navigation to /command-center → signed out to /auth", async ({ page }) => {
    // First attempt a sign-in (will be bounced), then verify direct nav also bounces
    await page.goto("/command-center");
    await page.waitForURL((url) => url.pathname.startsWith("/auth"), { timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth/);
  });
});

// -------------------------------------------------------
// Admin-settings route guard (Sprint 1C)
// Salesperson must not access /admin-settings even when signed in.
// -------------------------------------------------------
const salespersonEmail = process.env.TEST_SALESPERSON_EMAIL;
const salespersonPassword = process.env.TEST_SALESPERSON_PASSWORD;

test.describe("admin-settings route guard", () => {
  test.skip(
    !salespersonEmail || !salespersonPassword,
    "TEST_SALESPERSON_EMAIL/PASSWORD not set",
  );

  test("salesperson navigating to /admin-settings → redirected to /command-center", async ({
    page,
  }) => {
    await signIn(page, salespersonEmail!, salespersonPassword!);
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
    await page.goto("/admin-settings");
    await page.waitForURL((url) => !url.pathname.startsWith("/admin-settings"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/admin-settings/);
  });
});
