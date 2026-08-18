/**
 * Phase 1 — visual/functional verification of the Sales IA cleanup.
 *
 * Written because the local browser tooling could not hold an authenticated
 * session long enough to eyeball the new navigation, and MFA blocks a scripted
 * local login for privileged roles. The `salesperson` fixture is deliberately
 * chosen: it is NOT in MFA_REQUIRED_ROLES (src/lib/roles.ts), so it signs in
 * with a password alone and CI can drive it.
 *
 * Gated on TEST_APP_URL + TEST_SALESPERSON_* exactly like the other specs — the
 * CI preview build carries a placeholder Supabase anon key, so an authenticated
 * run needs the deployed app.
 */
import { test, expect, type Page } from "@playwright/test";
import { signInWithCachedSession } from "./fixtures/auth";

const APP_URL = process.env.TEST_APP_URL;
const EMAIL = process.env.TEST_SALESPERSON_EMAIL;
const PASSWORD = process.env.TEST_SALESPERSON_PASSWORD;
const READY = Boolean(APP_URL && EMAIL && PASSWORD);

// Routes that left the sidebar in Phase 1. They must all still resolve — the
// cleanup moved nav entries, it did not delete pages.
const DELISTED_ROUTES = [
  "/quotations",
  "/follow-ups",
  "/targets",
  "/award-queue",
  "/tender-conversion",
];

async function sidebarText(page: Page): Promise<string> {
  const nav = page.locator("nav").first();
  await nav.waitFor({ state: "visible", timeout: 20_000 });
  return (await nav.innerText()).replace(/\s+/g, " ");
}

test.describe("Phase 1 navigation", () => {
  test.skip(!READY, "needs TEST_APP_URL and TEST_SALESPERSON_* credentials");
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await signInWithCachedSession(page, EMAIL!, PASSWORD!);
  });

  test("Sales group shows the four PRD destinations", async ({ page }) => {
    await page.goto("/opportunities");
    const text = await sidebarText(page);
    for (const label of ["Intake", "Opportunities", "Tender", "Awarded"]) {
      expect(text).toContain(label);
    }
  });

  test("retired queues are gone from the sidebar", async ({ page }) => {
    await page.goto("/opportunities");
    const nav = page.locator("nav").first();
    await nav.waitFor({ state: "visible" });
    // Assert on hrefs, not labels: a label can legitimately reappear as a
    // filtered view (Awarded Projects points at /opportunities).
    for (const route of ["/award-queue", "/tender-conversion", "/follow-ups", "/targets", "/quotations"]) {
      await expect(nav.locator(`a[href^="${route}"]`)).toHaveCount(0);
    }
  });

  test("Awarded Projects is a filtered Opportunities view", async ({ page }) => {
    await page.goto("/opportunities");
    const nav = page.locator("nav").first();
    const awarded = nav.locator('a[href*="/opportunities"][href*="stage=won"]');
    await expect(awarded).toHaveCount(1);
    await awarded.click();
    await page.waitForURL(/\/opportunities\?.*stage=won/, { timeout: 20_000 });
    expect(page.url()).toContain("stage=won");
  });

  test("the duplicated intake tab strip is gone from all three pages", async ({ page }) => {
    for (const route of ["/lead-tender-inbox", "/opportunities", "/quotations"]) {
      await page.goto(route);
      const main = page.locator("#main-content");
      await main.waitFor({ state: "visible", timeout: 20_000 });
      const body = (await main.innerText()).replace(/\s+/g, " ");
      // The strip rendered all three sibling links inside the page body.
      const siblings = ["Lead & Tender Inbox", "Opportunities", "Quotations"].filter((s) =>
        body.includes(s),
      );
      expect(siblings.length, `${route} still renders a sibling tab strip`).toBeLessThan(3);
    }
  });

  for (const route of ["/lead-tender-inbox", "/opportunities", "/tenders", "/my-workspace"]) {
    test(`${route} renders`, async ({ page }) => {
      await page.goto(route);
      const main = page.locator("#main-content");
      await main.waitFor({ state: "visible", timeout: 20_000 });
      expect((await main.innerText()).trim().length).toBeGreaterThan(40);
    });
  }

  for (const route of DELISTED_ROUTES) {
    test(`${route} still works after leaving the sidebar`, async ({ page }) => {
      await page.goto(route);
      // Must not bounce to the auth page and must render something.
      await expect(page).not.toHaveURL(/\/auth/);
      const main = page.locator("#main-content");
      await main.waitFor({ state: "visible", timeout: 20_000 });
      expect((await main.innerText()).trim().length).toBeGreaterThan(20);
    });
  }

  test("Arabic switches the document to RTL and back to LTR", async ({ page }) => {
    await page.goto("/my-workspace");
    await page.locator("#main-content").waitFor({ state: "visible", timeout: 20_000 });

    const toggle = page.getByRole("button", { name: /^AR$|اللغة|Language/ }).first();
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl", { timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    // No horizontal overflow after mirroring.
    const rtlOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(rtlOverflow, "RTL layout overflows horizontally").toBe(false);

    await page.getByRole("button", { name: /^EN$/ }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 10_000 });
  });
});
