import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 8080);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

const AUTH_FILE = path.join(__dirname, "tests/e2e/setup/.auth.json");
const hasAuthFile = fs.existsSync(AUTH_FILE);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    // When a captured session exists locally, run follow-ups tests with it
    // (no env-var credentials needed — skips gracefully otherwise).
    ...(hasAuthFile
      ? [
          {
            name: "chromium-authed",
            testMatch: "**/follow-ups-actions.spec.ts",
            use: {
              ...devices["Desktop Chrome"],
              viewport: { width: 1280, height: 800 },
              storageState: AUTH_FILE,
            },
            // Signal to the spec that auth is pre-loaded — skip login/skip-guard
            env: { PLAYWRIGHT_USE_STORED_SESSION: "1" },
          },
        ]
      : []),
  ],
  // No webServer: tests skip when TEST_APP_URL/credentials aren't provided,
  // and in CI the workflow starts the app explicitly before invoking Playwright.
});
