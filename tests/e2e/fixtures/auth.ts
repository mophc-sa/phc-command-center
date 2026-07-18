import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type SupabaseStorageEntry = [key: string, value: string];

// Playwright may reload spec modules even with one worker, so sessions are also
// persisted under its per-run output directory. Each role performs one password
// exchange, then fresh browser contexts reuse it without sharing page state.
const sessionCache = new Map<string, SupabaseStorageEntry[]>();
const sessionCacheDir = path.resolve("test-results/.auth-session-cache");

function sessionCachePath(email: string) {
  const accountId = createHash("sha256").update(email).digest("hex");
  return path.join(sessionCacheDir, `${accountId}.json`);
}

function readCachedSession(email: string) {
  const memorySession = sessionCache.get(email);
  if (memorySession) return memorySession;

  const cachePath = sessionCachePath(email);
  if (!fs.existsSync(cachePath)) return null;

  const diskSession = JSON.parse(fs.readFileSync(cachePath, "utf8")) as SupabaseStorageEntry[];
  sessionCache.set(email, diskSession);
  return diskSession;
}

function cacheSession(email: string, entries: SupabaseStorageEntry[]) {
  sessionCache.set(email, entries);
  fs.mkdirSync(sessionCacheDir, { recursive: true });
  fs.writeFileSync(sessionCachePath(email), JSON.stringify(entries), { mode: 0o600 });
}

export async function signInWithCachedSession(
  page: Page,
  email: string,
  password: string,
  timeout = 20_000,
) {
  const cachedSession = readCachedSession(email);

  await page.goto("/auth");

  if (cachedSession) {
    await page.evaluate((entries) => {
      for (const [key, value] of entries) localStorage.setItem(key, value);
    }, cachedSession);
    await page.reload();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout });
    return;
  }

  await page.getByLabel(/email/i).first().fill(email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(password);

  const [authResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/auth/v1/token") && response.request().method() === "POST",
      { timeout },
    ),
    page
      .getByRole("button", { name: /sign in|log in/i })
      .first()
      .click(),
  ]);

  if (!authResponse.ok()) {
    const responseBody = await authResponse.text().catch(() => "");
    throw new Error(
      `Supabase sign-in failed (${authResponse.status()}): ${responseBody.slice(0, 300)}`,
    );
  }

  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout });

  const storageEntries = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => /^sb-[a-z0-9]+-auth-token$/.test(key)),
  );
  if (storageEntries.length === 0) {
    throw new Error("Supabase sign-in succeeded without persisting an auth session");
  }

  cacheSession(email, storageEntries);
}
