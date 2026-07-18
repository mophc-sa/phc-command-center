import { test, expect } from "@playwright/test";
import { signInWithCachedSession } from "./fixtures/auth";
import { ALL_ROLES, ROLE_MATRIX, getRoleCredentials, type RoleName } from "./fixtures/roles";

for (const role of ALL_ROLES) {
  test.describe(`role: ${role}`, () => {
    const creds = getRoleCredentials(role as RoleName);

    test.skip(!creds, `Skipping ${role}: TEST_${role.toUpperCase()}_EMAIL/PASSWORD not set`);

    const matrix = ROLE_MATRIX[role as RoleName];

    test("signs in and lands on the correct page (Sprint 1D contract)", async ({ page }) => {
      if (!creds) return;
      await signInWithCachedSession(page, creds.email, creds.password);

      // Exact landing path per Sprint 1D role landing contract.
      await expect(page).toHaveURL((url) => url.pathname === matrix.landing, { timeout: 10_000 });

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
        await signInWithCachedSession(page, creds.email, creds.password);
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
        await signInWithCachedSession(page, creds.email, creds.password);
        await page.goto(route);
        // Client-side route guards resolve asynchronously after page.goto().
        // Wait for either a redirect or an explicit access-denied surface.
        await expect
          .poll(
            async () => {
              const pathname = new URL(page.url()).pathname;
              const body = await page.locator("body").innerText();
              return (
                pathname !== route ||
                /access denied|not authorized|forbidden|permission/i.test(body)
              );
            },
            {
              message: `role ${role} should not fully access ${route}`,
              timeout: 10_000,
            },
          )
          .toBe(true);
      });
    }

    test("Arabic mode renders RTL", async ({ page }) => {
      if (!creds) return;
      await signInWithCachedSession(page, creds.email, creds.password);
      await page.evaluate(() => localStorage.setItem("phc-lang", "ar"));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    });
  });
}
