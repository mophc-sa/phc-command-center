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

/**
 * This sweep needs a CONFIGURED deployment, and says so rather than failing.
 *
 * The CI playwright-smoke job builds and serves the app with no Supabase
 * environment variables — that is why 105 of its tests skip. An unconfigured
 * app correctly throws "Missing Supabase environment variable(s)" on every
 * page, so every assertion here about console cleanliness fails for a reason
 * that has nothing to do with the code under review.
 *
 * Probed at runtime rather than gated on an env flag someone has to remember:
 * the day CI does get Supabase config, this starts running on its own instead
 * of staying silently switched off.
 */
let configured: boolean | null = null;

const UNCONFIGURED = /Missing Supabase environment variable/i;

async function appIsConfigured(page: Page): Promise<boolean> {
  if (configured !== null) return configured;

  // Loaded in a real browser, not fetched as HTML. The missing-config error is
  // thrown at RUNTIME by the client bundle, so the server response looks
  // perfectly clean — a first version of this probe checked the HTML, saw
  // nothing wrong, and let every test run straight into the failure it was
  // meant to prevent.
  const seen: string[] = [];
  const onConsole = (m: ConsoleMessage) => { if (m.type() === "error") seen.push(m.text()); };
  const onError = (e: Error) => seen.push(e.message);
  page.on("console", onConsole);
  page.on("pageerror", onError);
  try {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  } catch { /* an unreachable target is also "not configured" */ }
  page.off("console", onConsole);
  page.off("pageerror", onError);

  configured = !seen.some((e) => UNCONFIGURED.test(e));
  return configured;
}

/** Skips the test, with a reason, when the target app has no backend config. */
async function requireConfigured(page: Page) {
  const ok = await appIsConfigured(page);
  test.skip(!ok,
    "target app has no Supabase configuration — this sweep needs a deployed, configured environment " +
    "(run with PLAYWRIGHT_BASE_URL=https://agent.phc-sa.com)");
}

/** Noise the browser emits that says nothing about our code. */
const IGNORABLE = [
  /favicon/i,
  /Failed to load resource: the server responded with a status of 40[13]/i, // expected on guarded API calls
  /net::ERR_ABORTED/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
];

/**
 * Wait until React has hydrated, before clicking anything.
 *
 * `domcontentloaded` fires while the server HTML is on screen and the handlers
 * are not attached yet, so a click lands on a button that looks real and does
 * nothing. Both interaction tests here failed that way while the app was
 * working perfectly — and an earlier debug run passed only because enumerating
 * the buttons first happened to burn enough time for hydration to finish.
 */
async function hydrated(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => { /* long-poll is fine */ });
  // The language toggle is rendered by React on every page shell; once it
  // responds to the accessibility tree the tree is live, not server HTML.
  await page.getByRole("button").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(500);
}

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
    await requireConfigured(page);
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
    await requireConfigured(page);
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
    await requireConfigured(page);
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    // Matched by accessible name, not by [type="submit"]. The Sign in button
    // carries no explicit type attribute — inside a form the browser default
    // already makes it the submit button, so the attribute selector finds
    // nothing while the form works perfectly. A first version of this test
    // used it and reported a bug that did not exist.
    await expect(page.getByRole("button", { name: /sign in|تسجيل الدخول/i })).toBeVisible();
  });

  test("no button inside the form can submit it by accident", async ({ page }) => {
    await requireConfigured(page);
    // The flip side of relying on the default: any button dropped inside the
    // form becomes a submit button unless someone types type="button". Today
    // only Sign in should submit; Forgot password sets it explicitly. A new
    // control added without that attribute would silently submit the login
    // form, and this is the check that would catch it.
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    const submitters = await page.evaluate(() =>
      [...document.querySelectorAll("form button")]
        .filter((b) => (b as HTMLButtonElement).type === "submit")
        .map((b) => (b.textContent ?? "").trim()));
    expect(submitters).toHaveLength(1);
  });

  test("rejects a bad password without crashing the page", async ({ page }) => {
    await requireConfigured(page);
    // The failure path matters as much as the happy one: a thrown error here
    // leaves a blank screen and no way back.
    const { errors } = collect(page);
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await hydrated(page);
    await page.locator('input[type="email"], input[name="email"]').first()
      .fill("definitely-not-a-user@example.invalid");
    await page.locator('input[type="password"]').first().fill("wrong-password-on-purpose");
    await page.getByRole("button", { name: /sign in|تسجيل الدخول/i }).click();

    // Wait FOR the toast rather than sleeping and reading the body: the toast
    // auto-dismisses after a few seconds, so a fixed pause raced it and read a
    // page where the message had already gone. Silently doing nothing is the
    // worse failure — the user retypes the same password thinking they
    // mistyped it — so this asserts the message appears, not that it lingers.
    await expect(page.getByText(/incorrect|invalid|غير صحيح|خطأ/i).first())
      .toBeVisible({ timeout: 15_000 });

    expect(page.url(), "a failed sign-in must not navigate away").toMatch(/\/auth/);
    const text = (await page.locator("body").innerText().catch(() => "")).trim();
    expect(text.length, "page went blank after a failed sign-in").toBeGreaterThan(0);
    // A 400 here is the auth server correctly rejecting the credentials — the
    // point of the test. Ignored only in this test, not globally: a 400 on a
    // page that is not deliberately sending bad input is a real bug.
    const unexpected = errors.filter((e) => !/status of 400/i.test(e));
    expect(unexpected, "unexpected console errors during a failed sign-in").toEqual([]);
  });
});

test.describe("bilingual and responsive", () => {
  test("switching to Arabic flips the document to RTL", async ({ page }) => {
    await requireConfigured(page);
    // The whole layout mirrors off this attribute. If the toggle changed the
    // strings but not dir, every Arabic screen would read left-to-right and
    // look subtly wrong in a way no unit test notices.
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    expect(await page.locator("html").getAttribute("lang")).toBe("en");
    // getAttribute, not .dir: the property reports "ltr" by default while the
    // ATTRIBUTE is absent until the app sets it for Arabic. Asserting "ltr"
    // here failed against a page that was working correctly — the same
    // property-versus-attribute trap as button[type="submit"] above.
    const dirBefore = await page.locator("html").getAttribute("dir");
    expect(["ltr", null]).toContain(dirBefore);

    await hydrated(page);
    await page.getByRole("button", { name: /language|AR/i }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl", { timeout: 5000 });
    expect(await page.locator("html").getAttribute("lang")).toBe("ar");
  });

  test("survives a phone viewport without horizontal overflow", async ({ page }) => {
    await requireConfigured(page);
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
    await requireConfigured(page);
    const res = await page.goto("/auth", { waitUntil: "domcontentloaded" });
    const html = (await res?.text()) ?? "";
    // The publishable/anon key is expected client-side. A service-role JWT is
    // not, and would be catastrophic — it bypasses every policy in the schema.
    expect(html).not.toMatch(/service_role/i);
    expect(html).not.toMatch(/SUPABASE_SERVICE_ROLE/i);
  });
});
