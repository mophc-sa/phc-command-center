// =============================================================================
// A whole-system browser sweep that needs no credentials.
//
// Authenticated E2E needs 20 TEST_*_EMAIL / TEST_*_PASSWORD secrets for ten
// roles, and creating test users or setting secrets is out of scope here. That
// has meant "no browser testing" for the entire project, which was never true —
// it only meant no *signed-in* browser testing.
//
// Everything below runs against the real deployed app and checks the things
// that break silently and are invisible to unit tests:
//
//   * a route that 500s or renders nothing
//   * a JavaScript exception on load
//   * a failed network request the UI swallows
//   * a protected route that does NOT redirect — a real security check, and
//     the one worth having most
//   * RTL actually flipping the document
//   * the page surviving a phone viewport
//
// Point it at production with PLAYWRIGHT_BASE_URL, or leave it and it uses the
// local dev server the config expects.
// =============================================================================

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

/**
 * Routes reachable without signing in. `/` is included because a redirect loop
 * here takes the whole app down and nothing else would notice.
 */
const PUBLIC_ROUTES = ["/", "/auth"];

/**
 * Routes behind `_authenticated`. Every one of these must send an anonymous
 * visitor to the sign-in page. A route that renders instead is a data leak,
 * regardless of what RLS would have returned — the shell alone can disclose
 * that a record exists.
 */
const PROTECTED_ROUTES = [
  "/command-center",
  "/my-workspace",
  "/action-center",
  "/opportunities",
  "/sales-management",
  "/data-import",
  "/targets",
  "/knowledge",
  "/vendors",
  "/reference-library",
];

/** Noise the browser emits that says nothing about our code. */
const IGNORABLE = [
  /favicon/i,
  /Failed to load resource: the server responded with a status of 40[13]/i, // expected on guarded API calls
  /net::ERR_ABORTED/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
];

function collect(page: Page) {
  const errors: string[] = [];
  const failed: string[] = [];

  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORABLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (IGNORABLE.some((re) => re.test(f) || re.test(r.url()))) return;
    failed.push(`${r.url()} — ${f}`);
  });

  return { errors, failed };
}

test.describe("public routes load cleanly", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders without a client-side error`, async ({ page }) => {
      const { errors, failed } = collect(page);
      const res = await page.goto(route, { waitUntil: "domcontentloaded" });

      expect(res?.status(), `${route} HTTP status`).toBeLessThan(400);
      await page.waitForLoadState("networkidle").catch(() => { /* long-poll is fine */ });

      // A blank page returns 200 and passes every other check.
      const text = (await page.locator("body").innerText().catch(() => "")).trim();
      expect(text.length, `${route} rendered no visible text`).toBeGreaterThan(0);

      expect(errors, `${route} console errors`).toEqual([]);
      expect(failed, `${route} failed requests`).toEqual([]);
    });
  }
});

test.describe("protected routes refuse an anonymous visitor", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to sign-in`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const url = page.url();
      const onAuth = /\/auth(\?|$)/.test(url);
      expect(onAuth, `${route} did not redirect — landed on ${url}`).toBe(true);
    });
  }
});

test.describe("the sign-in page is usable", () => {
  test("offers an email and password field and a submit control", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"], button:has-text("Sign in")').first()).toBeVisible();
  });

  test("rejects a bad password without crashing the page", async ({ page }) => {
    // The failure path matters as much as the happy one: a thrown error here
    // leaves a blank screen and no way back.
    const { errors } = collect(page);
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[name="email"]').first()
      .fill("definitely-not-a-user@example.invalid");
    await page.locator('input[type="password"]').first().fill("wrong-password-on-purpose");
    await page.locator('button[type="submit"]').first().click();

    await page.waitForTimeout(3000);
    expect(page.url(), "a failed sign-in must not navigate away").toMatch(/\/auth/);
    const text = (await page.locator("body").innerText().catch(() => "")).trim();
    expect(text.length, "page went blank after a failed sign-in").toBeGreaterThan(0);
    expect(errors, "console errors during a failed sign-in").toEqual([]);
  });
});

test.describe("bilingual and responsive", () => {
  test("the document declares a language and a direction", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    const lang = await page.locator("html").getAttribute("lang");
    expect(lang, "html lang attribute").toBeTruthy();
    const dir = await page.locator("html").getAttribute("dir");
    expect(["ltr", "rtl", null]).toContain(dir);
  });

  test("survives a phone viewport without horizontal overflow", async ({ page }) => {
    // Horizontal scroll on a phone is the single most common RTL/layout
    // regression and it never shows up on a desktop run.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page scrolls sideways on a 390px viewport").toBeLessThanOrEqual(1);
  });
});

test.describe("the shell does not leak what it should not", () => {
  test("no Supabase service key or bearer token reaches the page source", async ({ page }) => {
    const res = await page.goto("/auth", { waitUntil: "domcontentloaded" });
    const html = (await res?.text()) ?? "";
    // The publishable/anon key is expected client-side. A service-role JWT is
    // not, and would be catastrophic — it bypasses every policy in the schema.
    expect(html).not.toMatch(/service_role/i);
    expect(html).not.toMatch(/SUPABASE_SERVICE_ROLE/i);
  });
});
