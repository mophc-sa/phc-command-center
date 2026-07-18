import type { Page } from "@playwright/test";

type SupabaseStorageEntry = [key: string, value: string];

// Playwright readiness runs in one worker so this module-level cache is shared
// across specs. Each role performs one password exchange, then fresh browser
// contexts reuse the resulting Supabase session without sharing page state.
const sessionCache = new Map<string, SupabaseStorageEntry[]>();

export async function signInWithCachedSession(
  page: Page,
  email: string,
  password: string,
  timeout = 20_000,
) {
  const cachedSession = sessionCache.get(email);

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

  sessionCache.set(email, storageEntries);
}
