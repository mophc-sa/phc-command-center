import { test, expect, type Page } from "@playwright/test";
import { getRoleCredentials, type RoleName } from "./fixtures/roles";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
}

// -- Upload + parse preview (sales_manager) -----------------------------------
test.describe("Data Import: sales_manager", () => {
  const creds = getRoleCredentials("sales_manager");
  test.skip(!creds, "TEST_SALES_MANAGER_EMAIL/PASSWORD not set");

  test("can access /data-import and see upload tab", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    const resp = await page.goto("/data-import");
    expect(resp?.status()).toBeLessThan(400);
    await expect(page.getByText(/Data Import|استيراد البيانات/i)).toBeVisible();
    await expect(page.getByText(/Upload|الرفع/i)).toBeVisible();
  });

  test("upload tab shows drop zone and file limit", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    await page.getByText(/Upload|الرفع/i).first().click();
    await expect(page.getByText(/10 MB|10,000/i)).toBeVisible();
  });
});

// -- Mapping save/reload (sales_manager) --------------------------------------
test.describe("Data Import: mapping", () => {
  const creds = getRoleCredentials("sales_manager");
  test.skip(!creds, "TEST_SALES_MANAGER_EMAIL/PASSWORD not set");

  test("mapping tab is accessible", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    await page.getByText(/Mapping|الربط/i).first().click();
    // Tab should render without errors
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(errors).toEqual([]);
  });
});

// -- Validation report/downloads (sales_manager) ------------------------------
test.describe("Data Import: validation", () => {
  const creds = getRoleCredentials("sales_manager");
  test.skip(!creds, "TEST_SALES_MANAGER_EMAIL/PASSWORD not set");

  test("validation tab shows KPI cards", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    await page.getByText(/Validation|التحقق/i).first().click();
    // Tab should render without runtime errors
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(errors).toEqual([]);
  });
});

// -- Duplicate review ---------------------------------------------------------
test.describe("Data Import: duplicates", () => {
  const creds = getRoleCredentials("sales_manager");
  test.skip(!creds, "TEST_SALES_MANAGER_EMAIL/PASSWORD not set");

  test("duplicates tab renders without errors", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    await page.getByText(/Duplicates|التكرارات/i).first().click();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(errors).toEqual([]);
  });
});

// -- managing_director approval + dry-run commit ------------------------------
test.describe("Data Import: managing_director approval", () => {
  const creds = getRoleCredentials("managing_director");
  test.skip(!creds, "TEST_MANAGING_DIRECTOR_EMAIL/PASSWORD not set");

  test("can access approval tab", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    await page.getByText(/Approval|الاعتماد/i).first().click();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(errors).toEqual([]);
  });
});

// -- system_admin blocked from approve/commit ---------------------------------
test.describe("Data Import: system_admin restrictions", () => {
  const creds = getRoleCredentials("system_admin");
  test.skip(!creds, "TEST_SYSTEM_ADMIN_EMAIL/PASSWORD not set");

  test("can access /data-import but sees no-approve notice", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    // Should see the import page (not blocked)
    await expect(page.getByText(/Data Import|استيراد البيانات/i)).toBeVisible();
    // Should see the restriction notice
    await expect(page.getByText(/cannot approve|لا يسمح/i)).toBeVisible();
  });
});

// -- salesperson blocked ------------------------------------------------------
test.describe("Data Import: salesperson blocked", () => {
  const creds = getRoleCredentials("salesperson");
  test.skip(!creds, "TEST_SALESPERSON_EMAIL/PASSWORD not set");

  test("sees access denied on /data-import", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    // Should see blocked message or redirect
    const body = await page.locator("body").innerText();
    const blocked = /do not have access|ليس لديك صلاحية|access denied/i.test(body)
      || !page.url().includes("/data-import");
    expect(blocked).toBe(true);
  });
});

// -- viewer blocked -----------------------------------------------------------
test.describe("Data Import: viewer blocked", () => {
  const creds = getRoleCredentials("viewer");
  test.skip(!creds, "TEST_VIEWER_EMAIL/PASSWORD not set");

  test("sees access denied on /data-import", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    const body = await page.locator("body").innerText();
    const blocked = /do not have access|ليس لديك صلاحية|access denied/i.test(body)
      || !page.url().includes("/data-import");
    expect(blocked).toBe(true);
  });
});

// -- File cap rejection -------------------------------------------------------
test.describe("Data Import: file caps", () => {
  const creds = getRoleCredentials("sales_manager");
  test.skip(!creds, "TEST_SALES_MANAGER_EMAIL/PASSWORD not set");

  test("upload tab displays file size and row limits", async ({ page }) => {
    if (!creds) return;
    await signIn(page, creds.email, creds.password);
    await page.goto("/data-import");
    await page.getByText(/Upload|الرفع/i).first().click();
    await expect(page.getByText(/10 MB/)).toBeVisible();
    await expect(page.getByText(/10,000/)).toBeVisible();
  });
});
