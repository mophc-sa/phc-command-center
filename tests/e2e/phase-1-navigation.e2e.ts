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

    // The toggle's ACCESSIBLE NAME is the word "Language"/"اللغة"; the visible
    // text is the language it switches TO ("AR" / "EN"). Matching on the text
    // works in English and silently fails in Arabic, so match the name.
    const langToggle = () => page.getByRole("button", { name: /Language|اللغة/ }).first();
    await langToggle().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl", { timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    // No horizontal overflow after mirroring.
    const rtlOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(rtlOverflow, "RTL layout overflows horizontally").toBe(false);

    await langToggle().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 10_000 });
  });
});

// ── Phase 2 — Intake & Opportunity Review ──────────────────────────────────
// The salesperson fixture is the right lens here: it is the role that CREATES
// requests and must NOT be able to decide them. Reviewer-side behaviour is
// covered by the contract tests and by the database trigger; what only a real
// browser can confirm is that the gate is actually rendered and that a
// non-reviewer is not offered the decision.
test.describe("Phase 2 intake review", () => {
  test.skip(!READY, "needs TEST_APP_URL and TEST_SALESPERSON_* credentials");

  test.beforeEach(async ({ page }) => {
    await signInWithCachedSession(page, EMAIL!, PASSWORD!);
  });

  test("the review queue is present on Intake", async ({ page }) => {
    await page.goto("/lead-tender-inbox");
    const main = page.locator("#main-content");
    await main.waitFor({ state: "visible", timeout: 20_000 });
    const body = (await main.innerText()).replace(/\s+/g, " ");
    expect(body).toMatch(/Opportunity Review|مراجعة الفرص/i);
  });

  test("a salesperson is told they cannot decide, and gets no decision buttons", async ({ page }) => {
    await page.goto("/lead-tender-inbox");
    const main = page.locator("#main-content");
    await main.waitFor({ state: "visible", timeout: 20_000 });
    const body = (await main.innerText()).replace(/\s+/g, " ");
    expect(body).toMatch(/Only a Sales Manager or BD Manager|صلاحية مدير المبيعات/i);
    await expect(page.getByRole("button", { name: /Approve for Pricing|اعتماد للتسعير/ })).toHaveCount(0);
  });

  test("the intake form offers all four request types", async ({ page }) => {
    await page.goto("/lead-tender-inbox");
    await page.locator("#main-content").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("button", { name: /New (Entry|Request|Item)|إدخال جديد|طلب جديد/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    // Field labels are uppercased with CSS text-transform, and innerText
    // returns the TRANSFORMED text — so this has to be case-insensitive.
    expect(text).toMatch(/Request Type|نوع الطلب/i);
    // The Phase 2 fields the PRD's minimum-data list was missing.
    expect(text).toMatch(/Owner \/ Government Entity|الجهة الحكومية/i);
    expect(text).toMatch(/Client RFQ Reference|مرجع طلب العميل/i);
    expect(text).toMatch(/BOQ Received|وصل جدول الكميات/i);
  });
});
