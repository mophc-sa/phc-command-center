import { test, expect } from "@playwright/test";
import { signInWithCachedSession } from "./fixtures/auth";
import { getRoleCredentials } from "./fixtures/roles";

test("board polls changed inputs, preserves data on read failure and recovers without reload", async ({ page }) => {
  test.setTimeout(90_000);
  const creds = getRoleCredentials("sales_manager");
  test.skip(!creds, "Sales manager readiness credentials required");
  if (!creds) return;
  await signInWithCachedSession(page, creds.email, creds.password);
  const readErrors: string[] = [];
  page.on("response", async (response) => {
    if (response.status() >= 400 && response.url().includes("/rest/v1/")) readErrors.push(`${response.status()} ${new URL(response.url()).pathname}: ${await response.text()}`);
  });
  let name = "BOARD-REFRESH-BEFORE";
  let fail = false;
  // Only replace the board's opportunity response. Authentication, RLS-backed
  // companion reads and rendering use the isolated readiness application.
  await page.route("**/rest/v1/opportunities?*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.get("select")?.includes("extra_data")) return route.continue();
    if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Simulated source unavailable" }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify([{
      id: "00000000-0000-0000-0000-000000000001", project_name: name,
      stage: "quotation", sales_stage: "jih", owner_id: null,
      contract_value: null, quotation_value: 7000000, estimated_value_max: null,
      created_at: "2023-01-01T00:00:00Z", extra_data: {},
    }]) });
  });
  await page.clock.install();
  await page.goto("/board");
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible().catch(async (error) => {
    throw new Error(`${String(error)}; URL=${page.url()}; reads=${readErrors.join(" | ")}; body=${(await page.locator("body").innerText()).slice(0, 3000)}`);
  });
  await expect(page.getByTestId("board-last-updated")).toContainText("every 60s");
  name = "BOARD-REFRESH-AFTER";
  await page.clock.runFor(61_000);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  fail = true;
  await page.clock.runFor(61_000);
  // Query retries complete before the failed refresh is presented.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(100);
    await page.clock.runFor(10_000);
  }
  await expect(page.getByText("Update unavailable — showing the last complete data")).toBeVisible();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  fail = false;
  name = "BOARD-REFRESH-RECOVERED";
  await page.clock.runFor(61_000);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Update unavailable — showing the last complete data")).toHaveCount(0);
});
