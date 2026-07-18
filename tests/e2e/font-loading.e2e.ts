import { expect, test } from "@playwright/test";

const FONT_URL_RE = /\/fonts\/ManifaPro2-[^/]+\.otf(?:\?.*)?$/;

test.describe("Manifa Pro font loading", () => {
  test("loads self-hosted Manifa Pro", async ({ page }) => {
    const fontResponses: Array<{ status: number; url: string }> = [];
    page.on("response", (res) => {
      if (FONT_URL_RE.test(res.url())) {
        fontResponses.push({ status: res.status(), url: res.url() });
      }
    });

    await page.goto("/auth", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      const families = Array.from(document.fonts).map((f) => ({
        family: f.family,
        weight: f.weight,
        status: f.status,
      }));
      return {
        hasRegular: document.fonts.check('400 16px "Manifa Pro"'),
        anyLoaded: families.some(
          (f) => f.family.replace(/["']/g, "") === "Manifa Pro" && f.status === "loaded",
        ),
        bodyFamily: getComputedStyle(document.body).fontFamily,
      };
    });

    expect(loaded.hasRegular).toBe(true);
    expect(loaded.anyLoaded).toBe(true);
    expect(loaded.bodyFamily).toMatch(/Manifa Pro/);
    expect(fontResponses.length, "expected at least one self-hosted Manifa response").toBeGreaterThan(0);
    // All observed font requests must be 2xx
    for (const r of fontResponses) expect(r.status).toBeLessThan(400);
  });

  test("falls back to system fonts when Manifa Pro files are blocked", async ({ page }) => {
    // Simulate a failure for every self-hosted Manifa Pro face.
    await page.route(FONT_URL_RE, (route) => route.abort("failed"));

    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const state = await page.evaluate(async () => {
      // fonts.ready resolves even if some faces fail
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      } catch {
        /* noop */
      }
      const manifa = Array.from(document.fonts).filter(
        (f) => f.family.replace(/["']/g, "") === "Manifa Pro",
      );
      return {
        anyManifaLoaded: manifa.some((f) => f.status === "loaded"),
        bodyFamily: getComputedStyle(document.body).fontFamily,
        // Text is still rendered and visible even without Manifa
        bodyRendered: document.body.innerText.length > 0,
      };
    });

    // Manifa must not have loaded
    expect(state.anyManifaLoaded).toBe(false);
    // Fallback stack must still name Manifa first, then a real fallback
    expect(state.bodyFamily).toMatch(/Manifa Pro/);
    expect(state.bodyFamily).toMatch(/Inter|IBM Plex|system-ui|sans-serif/i);
    // App must still render its text
    expect(state.bodyRendered).toBe(true);
  });
});
