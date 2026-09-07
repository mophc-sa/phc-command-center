import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCsv, csvCell } from "./csv.ts";
import { fetchComplete } from "./fetch-all.ts";
import { resolveCaller } from "./supabase.ts";

Deno.test("CSV multiline, escaped quotes, BOM, CRLF and malformed records", () => {
  assertEquals(parseCsv('\uFEFFname,notes\r\nAcme,"first\nsecond, ""quoted"""\r\n'), {
    headers: ["name", "notes"], rows: [["Acme", 'first\nsecond, "quoted"']],
  });
  for (const bad of ['a,b\nx,"unterminated', 'a,b\nx,y,z', 'a,b\nx,"y"z']) {
    let failed = false; try { parseCsv(bad); } catch { failed = true; }
    assertEquals(failed, true);
  }
  assertEquals(csvCell("=SUM(A1:A9)"), '"\'=SUM(A1:A9)"');
});

Deno.test("Complete pagination reads beyond 1000 and rejects failed pages/ceilings", async () => {
  const rows = Array.from({ length: 1501 }, (_, id) => ({ id }));
  assertEquals((await fetchComplete(() => ({ range: (a, b) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }) }))).data.length, 1501);
  await assertRejects(() => fetchComplete(() => ({ range: () => Promise.resolve({ data: null, error: new Error("query failed") }) })), Error, "query failed");
  await assertRejects(() => fetchComplete(() => ({ range: (a, b) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }) }), 1000), Error, "exceeds");
});

Deno.test("Edge account, MFA, batch ownership and file binding fail closed", async () => {
  const oldFetch = globalThis.fetch, oldServe = Deno.serve;
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"];
  const oldEnv = keys.map((k) => Deno.env.get(k));
  Deno.env.set("SUPABASE_URL", "https://audit.invalid");
  Deno.env.set("SUPABASE_ANON_KEY", "audit-public");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "audit-service");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  const uid = "a0000000-0000-4000-8000-000000000001";
  const batch = "a0000000-0000-4000-8000-000000000002";
  let status = "active", role = "bd_manager", foreign = true, forgedPath = false;
  const calls: URL[] = [];
  const duplicates: unknown[] = [];
  let dedupStatus: string | undefined;
  const reply = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "audit.invalid") throw new Error("Unexpected external request");
    calls.push(url);
    if (url.pathname === "/auth/v1/user") return reply({ id: uid, aud: "authenticated", role: "authenticated" });
    if (url.pathname === "/rest/v1/profiles") return reply({ status });
    if (url.pathname === "/rest/v1/user_roles") return reply([{ role }]);
    if (url.pathname === "/rest/v1/import_batches") {
      if (init?.method === "PATCH") dedupStatus = JSON.parse(String(init.body)).status;
      return reply({ id: batch, created_by: foreign ? batch : uid, target_entity: "companies", status: "mapping" });
    }
    if (url.pathname === "/rest/v1/companies") {
      // Reproduce PostgREST's production rejection of non-existent company
      // contact columns, then exercise the actual HTTP handler to completion.
      const columns = (url.searchParams.get("select") ?? "").split(",");
      if (columns.some((c) => ["email", "phone"].includes(c.trim()))) {
        return reply({ code: "42703", message: "column companies.email does not exist" }, 400);
      }
      return reply([{ id: uid, name: "Acme", cr_number: "1234567890", website_domain: "acme.invalid" }]);
    }
    if (url.pathname === "/rest/v1/import_rows") {
      if (init?.method === "PATCH" || url.searchParams.get("batch_id")?.startsWith("neq.")) return reply([]);
      return reply([{ id: uid, row_number: 1, mapped_data: { name: "Acme", cr_number: "1234567890" }, is_excluded: false, row_status: "active" }]);
    }
    if (url.pathname === "/rest/v1/import_duplicate_candidates") {
      duplicates.push(...JSON.parse(String(init?.body)));
      return new Response(null, { status: 201 });
    }
    if (url.pathname === "/rest/v1/rpc/refresh_import_duplicate_review") {
      const body = JSON.parse(String(init?.body));
      assertEquals(body._batch_id, batch);
      duplicates.splice(0, duplicates.length, ...body._candidates);
      dedupStatus = "pending_approval";
      return new Response(null, {status:204});
    }
    if (url.pathname === "/rest/v1/audit_log") return new Response(null, { status: 204 });
    if (url.pathname === "/rest/v1/import_errors") return reply([]);
    if (url.pathname === "/rest/v1/import_files") return reply(forgedPath ? { id: uid, batch_id: batch, storage_path: `${uid}/foreign.csv`, file_type: "csv", file_size_bytes: 20 } : null);
    throw new Error(`Unexpected request path: ${url.pathname}`);
  }) as typeof fetch;
  let handler!: (req: Request) => Promise<Response>;
  Deno.serve = ((fn: typeof handler) => { handler = fn; return {}; }) as never;
  try {
    await import("../import-pipeline/index.ts");
    status = "suspended";
    try { await resolveCaller("Bearer test"); throw new Error("Expected rejection"); }
    catch (e) { assertEquals((e as { status: number }).status, 403); }
    status = "active"; role = "sales_manager";
    const token = (aal: string) => {
      const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: uid, aal, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.${encode("synthetic-signature")}`;
    };
    try { await resolveCaller(`Bearer ${token("aal1")}`); throw new Error("Expected MFA rejection"); }
    catch (e) { assertEquals((e as { status: number }).status, 403); }
    assertEquals((await resolveCaller(`Bearer ${token("aal2")}`)).userId, uid);
    role = "bd_manager";
    const request = (action: string) => handler(new Request("https://audit.invalid/function", { method: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify({ action, batch_id: batch, file_id: uid, report_type: "validation_errors" }) }));
    for (const action of ["parse", "validate", "detect_duplicates", "generate_candidates", "approve", "dry_run_commit", "commit_candidates", "rollback", "generate_report"]) {
      assertEquals((await request(action)).status, 403, action);
    }
    assertEquals(calls.some((u) => u.pathname === "/rest/v1/import_errors"), false);
    foreign = false;
    assertEquals((await request("generate_report")).status, 200);
    assertEquals((await request("parse")).status, 404);
    forgedPath = true;
    assertEquals((await request("parse")).status, 403, "Owned metadata cannot redirect to a foreign object");
    assertEquals(calls.some((u) => u.pathname.startsWith("/storage/")), false);
    const fileRead = calls.find((u) => u.pathname === "/rest/v1/import_files");
    assertEquals(fileRead?.searchParams.get("batch_id"), `eq.${batch}`);
    const dedup = await request("detect_duplicates");
    assertEquals(dedup.status, 200, "Valid staged company must reach duplicate review without schema errors");
    assertEquals(await dedup.json(), { duplicates: 1, candidates: 1 });
    assertEquals(duplicates.length, 1);
    assertEquals(dedupStatus, "pending_approval");
    assertEquals((await request("detect_duplicates")).status, 200);
    assertEquals(duplicates.length, 1, "A rerun replaces suggestions instead of appending them");
  } finally {
    globalThis.fetch = oldFetch; Deno.serve = oldServe;
    keys.forEach((k, i) => oldEnv[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, oldEnv[i]!));
  }
});
