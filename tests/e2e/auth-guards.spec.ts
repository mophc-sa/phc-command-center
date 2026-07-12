/**
 * Auth guard + status quarantine tests (Sprint 1B/1C/1F).
 *
 * Test groups and their run conditions:
 *
 *   1. /auth page smoke      — always runs (no credentials, no app URL needed).
 *   2. Unauthenticated guard — requires TEST_APP_URL (the deployed app with a
 *                              real Supabase anon key baked in). The auth guard
 *                              is client-side only (ssr: false); the preview
 *                              build used in CI has a placeholder anon key, so
 *                              supabase.auth.getUser() cannot redirect correctly.
 *                              Matches the font-loading.spec.ts skip pattern.
 *   3. Pending quarantine    — requires TEST_PENDING_EMAIL/PASSWORD.
 *   4. Suspended quarantine  — requires TEST_SUSPENDED_EMAIL/PASSWORD.
 *   5. Admin-settings guard  — requires TEST_SALESPERSON_EMAIL/PASSWORD.
 */

import { test, expect, type Page } from "@playwright/test";

// Routes protected by the _authenticated layout guard.
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
// /auth page smoke — always runs in CI
// -------------------------------------------------------
test.describe("auth page smoke", () => {
  test("/auth renders sign-in form", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    await expect(page.getByLabel(/password/i).first()).toBeVisible();
  });
});

// -------------------------------------------------------
// Unauthenticated guard — requires deployed app (TEST_APP_URL)
//
// The _authenticated route guard is client-side only (ssr: false).
// It calls supabase.auth.getUser() which needs a working Supabase
// anon key baked into the build. The preview build used in CI carries
// a placeholder key, so the guard cannot redirect. Set TEST_APP_URL
// to the deployed app URL to run these assertions.
// -------------------------------------------------------
test.describe("unauthenticated guard", () => {
  test.skip(
    !process.env.TEST_APP_URL,
    "Auth guard is client-side; requires deployed app with real Supabase key (set TEST_APP_URL).",
  );

  for (const route of PROTECTED_ROUTES) {
    test(`${route} → /auth when not logged in`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL((url) => url.pathname.startsWith("/auth"), { timeout: 15_000 });
      await expect(page).toHaveURL(/\/auth/);
    });
  }

  test("/pending-approval → /auth when not logged in", async ({ page }) => {
    await page.goto("/pending-approval");
    await page.waitForURL((url) => url.pathname.startsWith("/auth"), { timeout: 15_000 });
    await expect(page).toHaveURL(/\/auth/);
  });
});

// -------------------------------------------------------
// Pending user quarantine (Sprint 1B) — skip when no credentials
// -------------------------------------------------------
const pendingEmail = process.env.TEST_PENDING_EMAIL;
const pendingPassword = process.env.TEST_PENDING_PASSWORD;

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

  test("/pending-approval page shows sign-out button", async ({ page }) => {
    await signIn(page, pendingEmail!, pendingPassword!);
    await page.waitForURL((url) => url.pathname.includes("pending-approval"), { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /sign out|تسجيل الخروج/i })).toBeVisible();
  });
});

// -------------------------------------------------------
// Suspended user quarantine (Sprint 1B) — skip when no credentials
// -------------------------------------------------------
const suspendedEmail = process.env.TEST_SUSPENDED_EMAIL;
const suspendedPassword = process.env.TEST_SUSPENDED_PASSWORD;

test.describe("suspended user quarantine", () => {
  test.skip(!suspendedEmail || !suspendedPassword, "TEST_SUSPENDED_EMAIL/PASSWORD not set");

  test("sign-in signs the user out and redirects to /auth", async ({ page }) => {
    await signIn(page, suspendedEmail!, suspendedPassword!);
    await page.waitForURL((url) => url.pathname.startsWith("/auth"), { timeout: 15_000 });
    await expect(page).toHaveURL(/\/auth/);
  });
});

// -------------------------------------------------------
// Admin-settings route guard (Sprint 1C)
// -------------------------------------------------------
const salespersonEmail = process.env.TEST_SALESPERSON_EMAIL;
const salespersonPassword = process.env.TEST_SALESPERSON_PASSWORD;

test.describe("admin-settings route guard", () => {
  test.skip(
    !salespersonEmail || !salespersonPassword,
    "TEST_SALESPERSON_EMAIL/PASSWORD not set",
  );

  test("salesperson navigating to /admin-settings → redirected away", async ({ page }) => {
    await signIn(page, salespersonEmail!, salespersonPassword!);
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
    await page.goto("/admin-settings");
    await page.waitForURL((url) => !url.pathname.startsWith("/admin-settings"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/admin-settings/);
  });
});
