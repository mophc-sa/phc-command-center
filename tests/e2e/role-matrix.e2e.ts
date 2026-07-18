import { test, expect, type Page } from "@playwright/test";
import { ALL_ROLES, ROLE_MATRIX, getRoleCredentials, type RoleName } from "./fixtures/roles";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  // Wait for auth redirect out of /auth
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
}

for (const role of ALL_ROLES) {
  test.describe(`role: ${role}`, () => {
    const creds = getRoleCredentials(role as RoleName);

    test.skip(!creds, `Skipping ${role}: TEST_${role.toUpperCase()}_EMAIL/PASSWORD not set`);

    const matrix = ROLE_MATRIX[role as RoleName];

    test("signs in and lands on the correct page (Sprint 1D contract)", async ({ page }) => {
      if (!creds) return;
      await signIn(page, creds.email, creds.password);

      // Exact landing path per Sprint 1D role landing contract.
      await expect(page).toHaveURL(
        (url) => url.pathname === matrix.landing,
        { timeout: 10_000 },
      );

      // No console/runtime errors on the landing page.
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(errors, `Console/runtime errors for ${role}: ${errors.join(" | ")}`).toEqual([]);
    });

    for (const route of matrix.allow) {
      test(`allowed route ${route} loads (2xx)`, async ({ page }) => {
        if (!creds) return;
        await signIn(page, creds.email, creds.password);
        const resp = await page.goto(route);
        expect(resp?.status(), `expected 2xx for ${route}`).toBeLessThan(400);
        await expect(page).toHaveURL((url) => url.pathname === route);
        await expect(page.locator("body")).not.toContainText(
          /access denied|not authorized|forbidden|permission/i,
        );
      });
    }

    for (const route of matrix.deny) {
      test(`denied route ${route} redirects or shows access-denied`, async ({ page }) => {
        if (!creds) return;
        await signIn(page, creds.email, creds.password);
        await page.goto(route);
        // Either redirected away from the target, or an access-denied surface is rendered.
        const url = page.url();
        const body = await page.locator("body").innerText();
        const denied =
          !url.includes(route) ||
          /access denied|not authorized|forbidden|permission/i.test(body);
        expect(denied, `role ${role} should not fully access ${route}`).toBe(true);
      });
    }

    test("Arabic mode renders RTL", async ({ page }) => {
      if (!creds) return;
      await signIn(page, creds.email, creds.password);
      await page.evaluate(() => localStorage.setItem("phc-lang", "ar"));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    });
  });
}
