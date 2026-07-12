/**
 * One-time session capture.
 * Opens a headed browser to the app's /auth page and waits for manual login.
 * Once you're logged in, saves storage state to tests/e2e/setup/.auth.json
 * so the smoke tests can reuse it without credentials in env vars.
 *
 * Usage:
 *   bunx playwright test tests/e2e/setup/capture-session.ts --headed --config=playwright.config.ts
 *
 * The saved .auth.json is git-ignored (contains session tokens).
 */

import { test } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_FILE = path.join(__dirname, ".auth.json");
const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test("capture session interactively", async ({ page, browser }) => {
  console.log(`\n\n🔑  Opening ${APP_URL}/auth — please sign in with any account that has access to /follow-ups.\n`);
  await page.goto(`${APP_URL}/auth`);

  // Wait up to 5 minutes for the user to sign in
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 300_000,
  });

  console.log(`✅  Signed in. Saving session state to ${AUTH_FILE}`);
  await page.context().storageState({ path: AUTH_FILE });
  console.log("🎉  Session saved. Run the follow-ups smoke tests now.");
});
