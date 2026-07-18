import { test, expect, type Page } from "@playwright/test";
import { signInWithCachedSession } from "./fixtures/auth";
import { getRoleCredentials, type RoleName } from "./fixtures/roles";

async function openImportCenter(page: Page, role: RoleName) {
  const creds = getRoleCredentials(role);
  if (!creds) return null;
  await signInWithCachedSession(page, creds.email, creds.password);
  const response = await page.goto("/data-import");
  expect(response?.status()).toBeLessThan(400);
  return creds;
}

async function invokeImportPipelineAsSignedInUser(page: Page, action: string) {
  const auth = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) =>
      /^sb-[a-z0-9]+-auth-token$/.test(key),
    );
    if (!entry) return null;
    const projectRef = entry[0].slice(3, -"-auth-token".length);
    const session = JSON.parse(entry[1]) as { access_token?: string };
    if (!session.access_token) return null;
    return {
      token: session.access_token,
      url: `https://${projectRef}.supabase.co/functions/v1/import-pipeline`,
    };
  });
  expect(auth, "expected a persisted Supabase session after sign-in").not.toBeNull();

  return page.request.post(auth!.url, {
    headers: {
      Authorization: `Bearer ${auth!.token}`,
    },
    data: { action, batch_id: crypto.randomUUID() },
  });
}

test.describe("Data Import: authorised roles", () => {
  for (const role of ["sales_manager", "managing_director", "system_admin"] as const) {
    const creds = getRoleCredentials(role);
    test.skip(!creds, `TEST_${role.toUpperCase()}_EMAIL/PASSWORD not set`);

    test(`${role} can access the current Import Center`, async ({ page }) => {
      if (!(await openImportCenter(page, role))) return;
      await expect(page.getByRole("heading", { name: "Import Center" })).toBeVisible();
      await expect(page.getByRole("button", { name: "New Import" }).first()).toBeVisible();
    });
  }

  const salesManager = getRoleCredentials("sales_manager");
  test.skip(!salesManager, "TEST_SALES_MANAGER_EMAIL/PASSWORD not set");

  test("new-import dialog exposes accepted formats and enforced limits", async ({ page }) => {
    if (!(await openImportCenter(page, "sales_manager"))) return;
    await page.getByRole("button", { name: "New Import" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New Import" })).toBeVisible();
    await expect(dialog.getByText(/Max 10 MB.*Max 10,000 rows/i)).toBeVisible();
    await expect(dialog.locator('input[type="file"]')).toHaveAttribute("accept", ".csv,.xlsx");
  });

  test("current batch lifecycle tabs render without runtime errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (!(await openImportCenter(page, "sales_manager"))) return;

    for (const tabName of ["Active", "Recurring", "Processed"]) {
      const tab = page.getByRole("tab", { name: new RegExp(`^${tabName}\\b`, "i") });
      await expect(tab).toBeVisible();
      await tab.click();
    }
    expect(errors).toEqual([]);
  });

  test("system_admin is rejected at the approve and commit trust boundary", async ({ page }) => {
    if (!(await openImportCenter(page, "system_admin"))) return;
    for (const action of ["approve", "dry_run_commit"]) {
      const response = await invokeImportPipelineAsSignedInUser(page, action);
      expect(response.status()).toBe(403);
      const body = await response.json();
      expect(body.error).toMatch(/system_admin cannot (approve|commit) imports/i);
    }
  });
});

for (const role of ["salesperson", "viewer"] as const) {
  test.describe(`Data Import: ${role} blocked`, () => {
    const creds = getRoleCredentials(role);
    test.skip(!creds, `TEST_${role.toUpperCase()}_EMAIL/PASSWORD not set`);

    test("shows the access-denied surface", async ({ page }) => {
      if (!(await openImportCenter(page, role))) return;
      await expect(
        page.getByText(/do not have permission to access the import centre/i),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "New Import" })).toHaveCount(0);
    });
  });
}
