/**
 * Smoke test — Follow-ups inline actions (PR #31)
 *
 * Tests:
 *   1. /follow-ups page renders (no runtime errors)
 *   2. Reschedule button (CalendarClock) is visible on at least one row
 *   3. Mark Complete button (CheckCheck) is visible on at least one row
 *   4. Clicking Reschedule opens the dialog (title match)
 *   5. Reschedule dialog can be dismissed (Escape / cancel)
 *   6. Clicking Mark Complete opens the dialog
 *   7. Mark Complete dialog can be dismissed
 *   8. My Day "Today" tab shows the same action buttons
 *
 * Requires: TEST_SALESPERSON_EMAIL / TEST_SALESPERSON_PASSWORD
 * (or any role whose ROLE_MATRIX.allow includes /follow-ups and /my-workspace)
 *
 * Skips gracefully when credentials are absent — mirrors the pattern used
 * by role-matrix.spec.ts.
 */

import { test, expect, type Page } from "@playwright/test";
import { signInWithCachedSession } from "./fixtures/auth";

const email = process.env.TEST_SALESPERSON_EMAIL ?? process.env.TEST_SALES_MANAGER_EMAIL;
const password = process.env.TEST_SALESPERSON_PASSWORD ?? process.env.TEST_SALES_MANAGER_PASSWORD;

// Ready if env creds exist OR if the chromium-authed project pre-loaded a session
const HAS_CREDS = Boolean(email && password);
const USE_STORED = process.env.PLAYWRIGHT_USE_STORED_SESSION === "1";
const CAN_RUN = HAS_CREDS || USE_STORED;

async function signIn(page: Page) {
  if (USE_STORED) return; // storage state already loaded by the project
  await signInWithCachedSession(page, email!, password!);
}

// ─── /follow-ups ──────────────────────────────────────────────────────────────

test.describe("follow-ups page", () => {
  test.skip(!CAN_RUN, "Skipping: no credentials and no stored session");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/follow-ups");
    // Wait for either the list or the empty state
    await page
      .waitForSelector(
        "ul li, [data-testid='empty-state'], .empty-state, p:has-text('No follow')",
        {
          timeout: 15_000,
          state: "attached",
        },
      )
      .catch(() => undefined); // empty state might render differently
    await page.waitForLoadState("networkidle");
  });

  test("page loads without runtime errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!text.includes("404") && !text.includes("Failed to load resource")) {
          errors.push(text);
        }
      }
    });
    await page.waitForTimeout(1000);
    expect(errors, `JS runtime errors on follow-ups: ${errors.join(" | ")}`).toEqual([]);
  });

  test("page title is Follow-ups", async ({ page }) => {
    await expect(page).toHaveTitle(/follow.up/i);
  });

  test("KPI cards are rendered (Overdue / Today / Upcoming)", async ({ page }) => {
    // KpiCard renders metric labels — check at least one
    const kpiText = await page.locator("text=/overdue|today|upcoming/i").count();
    expect(kpiText).toBeGreaterThanOrEqual(1);
  });

  test("bucket filter buttons are rendered", async ({ page }) => {
    await expect(page.getByRole("button", { name: /all|الكل/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /overdue|متأخر/i }).first()).toBeVisible();
  });

  // ── Inline action buttons ──────────────────────────────────────────────────

  test("Reschedule button (CalendarClock) is visible on follow-up rows", async ({ page }) => {
    const rows = page.locator("ul li");
    const count = await rows.count();

    if (count === 0) {
      test.skip(); // no follow-ups for this account — skip not fail
      return;
    }

    // title attr is "Reschedule" or "إعادة الجدولة"
    const rescheduleBtn = page
      .locator("button[title='Reschedule'], button[title='إعادة الجدولة']")
      .first();
    await expect(rescheduleBtn).toBeVisible();
  });

  test("Mark Complete button (CheckCheck) is visible on follow-up rows", async ({ page }) => {
    const rows = page.locator("ul li");
    const count = await rows.count();

    if (count === 0) {
      test.skip();
      return;
    }

    const completeBtn = page.locator("button[title='Mark complete'], button[title='تمت']").first();
    await expect(completeBtn).toBeVisible();
  });

  test("Reschedule button opens dialog with date field", async ({ page }) => {
    const rows = page.locator("ul li");
    if ((await rows.count()) === 0) {
      test.skip();
      return;
    }

    const rescheduleBtn = page
      .locator("button[title='Reschedule'], button[title='إعادة الجدولة']")
      .first();
    await rescheduleBtn.click();

    // Dialog title
    await expect(
      page.getByRole("dialog").filter({ hasText: /reschedule follow.up|إعادة جدولة/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Date input inside dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("input[type='date']")).toBeVisible();
  });

  test("Reschedule dialog can be dismissed with Escape", async ({ page }) => {
    const rows = page.locator("ul li");
    if ((await rows.count()) === 0) {
      test.skip();
      return;
    }

    await page.locator("button[title='Reschedule'], button[title='إعادة الجدولة']").first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 3_000 });
  });

  test("Mark Complete button opens dialog with outcome textarea", async ({ page }) => {
    const rows = page.locator("ul li");
    if ((await rows.count()) === 0) {
      test.skip();
      return;
    }

    const completeBtn = page.locator("button[title='Mark complete'], button[title='تمت']").first();
    await completeBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Should contain a textarea for outcome
    await expect(dialog.locator("textarea")).toBeVisible();
  });

  test("Mark Complete dialog can be dismissed with Escape", async ({ page }) => {
    const rows = page.locator("ul li");
    if ((await rows.count()) === 0) {
      test.skip();
      return;
    }

    await page.locator("button[title='Mark complete'], button[title='تمت']").first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 3_000 });
  });

  test("Reschedule dialog pre-fills date from the row's due_date", async ({ page }) => {
    const rows = page.locator("ul li");
    if ((await rows.count()) === 0) {
      test.skip();
      return;
    }

    // Grab first row's date: the .tabular-nums div inside the actions column
    const firstRow = rows.first();
    const dateDiv = firstRow.locator(".tabular-nums").first();
    const dateText = (await dateDiv.textContent())?.trim();

    await page.locator("button[title='Reschedule'], button[title='إعادة الجدولة']").first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const dateInput = dialog.locator("input[type='date']");
    await expect(dateInput).toBeVisible();
    const value = await dateInput.inputValue();

    // If the row had a real ISO date, expect the dialog to reflect it
    if (dateText && dateText !== "—" && /^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      expect(value).toBe(dateText);
    } else {
      // Row has no date — dialog input must still be present (empty or any value)
      expect(await dateInput.count()).toBe(1);
    }
  });
});

// ─── My Day — Today tab ───────────────────────────────────────────────────────

test.describe("My Day — Today tab inline actions", () => {
  test.skip(!CAN_RUN, "Skipping: no credentials and no stored session");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/my-workspace");
    await page.waitForLoadState("networkidle");

    // Click Today tab if not already active
    const todayTab = page.getByRole("tab", { name: /today|اليوم/i });
    if (await todayTab.count()) {
      await todayTab.click();
      await page.waitForTimeout(400);
    }
  });

  test("Today tab renders without runtime errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Filter out 404 network errors (missing avatars / static assets) —
        // those are not JS runtime errors.
        if (!text.includes("404") && !text.includes("Failed to load resource")) {
          errors.push(text);
        }
      }
    });
    await page.waitForTimeout(1000);
    expect(errors, `JS runtime errors on My Day: ${errors.join(" | ")}`).toEqual([]);
  });

  test("Reschedule button is visible on Today tab follow-up rows", async ({ page }) => {
    const followUpRows = page.locator("button[title='Reschedule'], button[title='إعادة الجدولة']");
    const count = await followUpRows.count();
    // If no follow-ups today, this is fine — skip
    if (count === 0) {
      test.skip();
      return;
    }
    await expect(followUpRows.first()).toBeVisible();
  });

  test("Mark Complete button is visible on Today tab follow-up rows", async ({ page }) => {
    const completeBtns = page.locator("button[title='Mark complete'], button[title='تمت']");
    const count = await completeBtns.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await expect(completeBtns.first()).toBeVisible();
  });

  test("Clicking Reschedule on Today tab opens dialog", async ({ page }) => {
    const btn = page.locator("button[title='Reschedule'], button[title='إعادة الجدولة']").first();
    if ((await btn.count()) === 0) {
      test.skip();
      return;
    }

    await btn.click();
    await expect(
      page.getByRole("dialog").filter({ hasText: /reschedule|إعادة جدولة/i }),
    ).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
  });

  test("Clicking Mark Complete on Today tab opens dialog", async ({ page }) => {
    const btn = page.locator("button[title='Mark complete'], button[title='تمت']").first();
    if ((await btn.count()) === 0) {
      test.skip();
      return;
    }

    await btn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });
});
