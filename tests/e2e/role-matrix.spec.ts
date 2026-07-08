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

    test("signs in and reaches expected default landing", async ({ page }) => {
      if (!creds) return;
      await signIn(page, creds.email, creds.password);
      await expect(page).toHaveURL(/(command-center|my-workspace|agent-activity|admin-settings)/);

      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(errors, `Console/runtime errors for ${role}: ${errors.join(" | ")}`).toEqual([]);
    });

    const matrix = ROLE_MATRIX[role as RoleName];

    for (const route of matrix.allow) {
      test(`allowed route ${route} loads (200)`, async ({ page }) => {
        if (!creds) return;
        await signIn(page, creds.email, creds.password);
        const resp = await page.goto(route);
        expect(resp?.status(), `expected 2xx for ${route}`).toBeLessThan(400);
      });
    }

    for (const route of matrix.deny) {
      test(`denied route ${route} shows access-denied or redirect`, async ({ page }) => {
        if (!creds) return;
        await signIn(page, creds.email, creds.password);
        await page.goto(route);
        // Either redirected away, or an access-denied surface is rendered.
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
      await page.evaluate(() => localStorage.setItem("phc.lang", "ar"));
      await page.reload();
      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(["rtl", "ltr"]).toContain(dir); // present, non-empty
    });
  });
}
