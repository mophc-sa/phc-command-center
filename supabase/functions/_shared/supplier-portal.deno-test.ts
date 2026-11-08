import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appUrl, attachmentHeader, callerMayUseAction, normalizeSupplierEmail, SUPPLIER_ACTIONS } from "./supplier-portal.ts";
import { resolveCaller } from "./supabase.ts";

Deno.test("a supplier account may call only the supplier actions", () => {
  assertEquals(SUPPLIER_ACTIONS, ["supplier_file_download"]);
  assertEquals(callerMayUseAction(["supplier"], "supplier_file_download"), true);
  assertEquals(callerMayUseAction(["supplier"], "send_email"), false);
  assertEquals(callerMayUseAction(["supplier"], "supplier_account_create"), false);
  assertEquals(callerMayUseAction(["estimation_manager", "finance_manager"], "supplier_account_create"), true);
  assertEquals(callerMayUseAction([], "daily_assistant"), true);
});

Deno.test("supplier emails are trimmed, lower-cased and checked", () => {
  assertEquals(normalizeSupplierEmail("  Robbie@Factory.Example "), "robbie@factory.example");
  assertEquals(normalizeSupplierEmail("not-an-email"), null);
  assertEquals(normalizeSupplierEmail(""), null);
  assertEquals(normalizeSupplierEmail(undefined), null);
  assertEquals(normalizeSupplierEmail(`${"a".repeat(250)}@x.io`), null);
});

Deno.test("a supplier download is named by its neutral name only, header-safe", () => {
  assertEquals(attachmentHeader("PR-26-0001-01.pdf"), `attachment; filename="PR-26-0001-01.pdf"; filename*=UTF-8''PR-26-0001-01.pdf`);
  assertEquals(attachmentHeader('a"b\r\n.pdf'), `attachment; filename="a_b__.pdf"; filename*=UTF-8''a%22b%0D%0A.pdf`);
  assertEquals(attachmentHeader(""), `attachment; filename="file"; filename*=UTF-8''file`);
});

Deno.test("the app URL comes from APP_URL, without a trailing slash", () => {
  assertEquals(appUrl(() => undefined), "https://agent.phc-sa.com");
  assertEquals(appUrl((k) => (k === "APP_URL" ? "https://canary.example//" : undefined)), "https://canary.example");
});

Deno.test("resolveCaller refuses a supplier unless the function admits suppliers, and then still needs MFA", async () => {
  const oldFetch = globalThis.fetch;
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"];
  const oldEnv = keys.map((k) => Deno.env.get(k));
  Deno.env.set("SUPABASE_URL", "https://supplier.invalid");
  Deno.env.set("SUPABASE_ANON_KEY", "supplier-public");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "supplier-service");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  let role = "supplier";
  const reply = (data: unknown, code = 200) =>
    new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "supplier.invalid") throw new Error("Unexpected external request");
    if (url.pathname === "/auth/v1/user") return reply({ id: "b0000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" });
    if (url.pathname === "/rest/v1/profiles") return reply({ status: "active" });
    if (url.pathname === "/rest/v1/user_roles") return reply([{ role }]);
    return reply({ message: "not found" }, 404);
  }) as typeof fetch;
  const outcome = (p: Promise<unknown>) => p.then(() => null, (e) => e as { status: number; message: string });
  try {
    assertEquals(await outcome(resolveCaller("Bearer not-a-jwt")), {
      status: 403,
      message: "Supplier accounts use the supplier portal only",
    });
    assertEquals(await outcome(resolveCaller("Bearer not-a-jwt", { allowSupplier: true })), {
      status: 403,
      message: "MFA verification required",
    });
    role = "bd_manager";
    assertEquals(await outcome(resolveCaller("Bearer not-a-jwt")), null);
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((k, i) => (oldEnv[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, oldEnv[i]!)));
  }
});
