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
  let vendorId: string | null = null;
  const reply = (data: unknown, code = 200) =>
    new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "supplier.invalid") throw new Error("Unexpected external request");
    if (url.pathname === "/auth/v1/user") return reply({ id: "b0000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated" });
    if (url.pathname === "/rest/v1/profiles") return reply({ status: "active", vendor_id: vendorId });
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
    // A vendor link alone makes a supplier, whatever user_roles says: removing that mapping fails here.
    vendorId = "b1000000-0000-4000-8000-000000000001";
    assertEquals(await outcome(resolveCaller("Bearer not-a-jwt")), {
      status: 403,
      message: "Supplier accounts use the supplier portal only",
    });
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((k, i) => (oldEnv[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, oldEnv[i]!)));
  }
});

// The real gate in sales-os-api/index.ts, exercised through handleSalesOsRequest.
Deno.test("sales-os-api: a supplier JWT reaches supplier_file_download and nothing else", async () => {
  const oldFetch = globalThis.fetch;
  const oldServe = Deno.serve;
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"];
  const oldEnv = keys.map((k) => Deno.env.get(k));
  Deno.env.set("SUPABASE_URL", "https://gate.invalid");
  Deno.env.set("SUPABASE_ANON_KEY", "gate-public");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "gate-service");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  let roles: { role: string }[] = [{ role: "supplier" }];
  let vendorId: string | null = null;
  const rpcs: string[] = [];
  const reply = (data: unknown, code = 200) =>
    new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "gate.invalid") throw new Error("Unexpected external request");
    if (url.pathname === "/auth/v1/user") return reply({ id: "b0000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated" });
    if (url.pathname === "/rest/v1/profiles") return reply({ status: "active", vendor_id: vendorId });
    if (url.pathname === "/rest/v1/user_roles") return reply(roles);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      rpcs.push(url.pathname.split("/").pop()!);
      return reply({ message: "not allowed", code: "42501" }, 403);
    }
    return reply({ message: "not found" }, 404);
  }) as typeof fetch;
  Deno.serve = (() => ({})) as unknown as typeof Deno.serve; // importing index.ts must not open a port
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "b0000000-0000-4000-8000-000000000002", aal: "aal2", exp: 4102444800 })}.sig`;
  const call = async (handle: (r: Request) => Promise<Response>, action: string) => {
    const res = await handle(new Request("https://gate.invalid/sales-os-api", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ action, payload: {} }),
    }));
    return { status: res.status, body: await res.json() };
  };
  try {
    const { handleSalesOsRequest } = await import("../sales-os-api/index.ts");
    const refused = { status: 403, body: { error: "This account cannot use this action" } };
    // Role row and vendor link are each enough to make a supplier.
    for (const [r, v] of [[[{ role: "supplier" }], null], [[], "b1000000-0000-4000-8000-000000000001"]] as const) {
      roles = [...r];
      vendorId = v;
      assertEquals(await call(handleSalesOsRequest, "supplier_account_create"), refused);
      assertEquals(await call(handleSalesOsRequest, "supplier_account_password_link"), refused);
      assertEquals(await call(handleSalesOsRequest, "daily_assistant"), refused);
      assertEquals(rpcs, []);
      // Through the gate: the handler runs (its own database check answers, not the gate).
      const allowed = await call(handleSalesOsRequest, "supplier_file_download");
      assertEquals(allowed.status, 403);
      assertEquals(allowed.body.error === "This account cannot use this action", false);
      assertEquals(rpcs.splice(0), ["supplier_portal_file"]);
    }
    // Staff are not gated by it.
    roles = [{ role: "bd_manager" }];
    vendorId = null;
    const staff = await call(handleSalesOsRequest, "supplier_account_create");
    assertEquals(staff.body.error === "This account cannot use this action", false);
  } finally {
    globalThis.fetch = oldFetch;
    Deno.serve = oldServe;
    keys.forEach((k, i) => (oldEnv[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, oldEnv[i]!)));
  }
});

Deno.test("password_link: refused for an MFA-enrolled supplier unless system_admin; audited only when issued", async () => {
  const { supplierPortalModule } = await import("../sales-os-api/handlers/supplier-portal.ts");
  const run = async (roles: string[], hasMfa: boolean, linkOk = true) => {
    const audits: unknown[][] = [];
    const ctx = {
      caller: { userId: "caller-1", roles },
      asCaller: { rpc: async () => ({ data: "s@factory.example", error: null }) },
      svc: {
        rpc: async () => ({ data: hasMfa, error: null }),
        auth: { admin: { generateLink: async () => (linkOk
          ? { data: { properties: { action_link: "https://x.invalid/l" } }, error: null }
          : { data: null, error: { message: "no" } }) } },
      },
      audit: async (...a: unknown[]) => { audits.push(a); return { error: null }; },
    };
    // deno-lint-ignore no-explicit-any
    const res = await supplierPortalModule.handlers.supplier_account_password_link({ userId: "u1" }, ctx as any);
    return { status: res.status, audits };
  };
  const pricer = await run(["estimation_manager"], true);
  assertEquals(pricer.status, 403);
  assertEquals(pricer.audits.length, 0);
  const admin = await run(["system_admin"], true);
  assertEquals(admin.status, 200);
  assertEquals(admin.audits[0].slice(2, 6), ["supplier_account.link_issued", "user", "u1", { issued_by: "caller-1", had_mfa: true }]);
  const plain = await run(["estimation_manager"], false);
  assertEquals(plain.status, 200);
  assertEquals((plain.audits[0][5] as { had_mfa: boolean }).had_mfa, false);
  const failed = await run(["system_admin"], true, false);
  assertEquals(failed.status, 502);
  assertEquals(failed.audits.length, 0);
});
