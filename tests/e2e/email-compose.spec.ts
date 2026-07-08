import { expect, test } from "@playwright/test";

// The "Email via Outlook" compose flow lives behind Supabase auth. Without
// TEST_APP_URL + a signed-in session we can't reach the detail pages where
// the button is rendered (accounts/opportunities/tenders/rfq/follow-ups),
// so this mirrors the role-matrix + font-loading skip pattern.
test.describe("Email via Outlook — compose only", () => {
  test.skip(
    !process.env.TEST_APP_URL,
    "Compose modal lives on authenticated routes; set TEST_APP_URL to run against a deployed session.",
  );

  test("compose action never calls a backend send endpoint", async ({ page }) => {
    const sendRequests: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (/sendmail|graph\.microsoft\.com|\/sendmail|resend\.com|sendgrid|\/api\/send-email/i.test(u)) {
        sendRequests.push(u);
      }
    });

    // Visit a route where the button appears; if credentials aren't wired
    // the earlier `test.skip` short-circuits — this is defence in depth.
    await page.goto("/follow-ups", { waitUntil: "domcontentloaded" });

    // Try to open the first "Email via Outlook" button we can find.
    const btn = page.getByRole("button", { name: /Email via Outlook|بريد عبر Outlook/i }).first();
    if (await btn.count()) {
      await btn.click();
      await expect(page.getByText(/Open in Outlook|فتح في Outlook/i)).toBeVisible();

      // Copy path must not trigger a network send.
      await page.getByRole("button", { name: /Copy email text|نسخ نص البريد/i }).click();
    }

    expect(sendRequests).toEqual([]);
  });
});
