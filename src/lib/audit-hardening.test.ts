import { test, expect } from "bun:test";
import { totp } from "../../scripts/totp";
import { fetchRequiredRows } from "./fetch-all";
import { verifyReleaseEvidence } from "../../scripts/verify-release-evidence";

test("TOTP matches RFC 6238 SHA-1 vectors", () => {
  // Public RFC test vector, never an account secret.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  expect(totp(secret, 59_000, 8)).toBe("94287082");
  expect(totp(secret, 1_111_111_109_000, 8)).toBe("07081804");
  expect(totp(secret, 2_000_000_000_000, 8)).toBe("69279037");
});

test("management reads all 1201 rows and rejects partial/error results", async () => {
  const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const result = await fetchRequiredRows(() => ({ range: (a, b) => Promise.resolve({ data: source.slice(a, b + 1), error: null }) }));
  expect(result.data).toEqual(source);
  await expect(fetchRequiredRows(() => ({ range: () => Promise.resolve({ data: null, error: new Error("offline") }) }))).rejects.toThrow("offline");
  await expect(fetchRequiredRows(() => ({ range: (a, b) => Promise.resolve({ data: Array(b - a + 1).fill({ id: 1 }), error: null }) }))).rejects.toThrow("limit");
});

test("production evidence rejects failed security and stale canary, accepts matching receipts", async () => {
  const oldFetch = globalThis.fetch;
  const sha = "a".repeat(40);
  let security = "success", canarySha = sha, includeReadiness = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    let body: unknown;
    if (url.includes("/workflows/")) body = { workflow_runs: [{ id: 1, head_sha: sha, head_branch: "main", conclusion: url.includes("security") ? security : "success" }] };
    else if (url.includes("/artifacts")) body = { artifacts: [
      { name: `canary-deployed-${canarySha}`, expired: false, created_at: "2026-09-07T01:00:00Z", workflow_run: { id: 2, head_sha: canarySha } },
      ...(includeReadiness ? [{ name: `canary-readiness-${sha}`, expired: false, created_at: "2026-09-07T02:00:00Z", workflow_run: { id: 3, head_sha: sha } }] : []),
    ] };
    else body = { conclusion: "success", head_branch: "main", path: url.endsWith("/2") ? ".github/workflows/deploy-cloudflare.yml" : ".github/workflows/production-readiness.yml" };
    return Response.json(body);
  }) as typeof fetch;
  try {
    await verifyReleaseEvidence("production", "owner/repo", sha, "test-token");
    security = "failure";
    await expect(verifyReleaseEvidence("production", "owner/repo", sha, "test-token")).rejects.toThrow("security.yml");
    security = "success"; canarySha = "b".repeat(40);
    await expect(verifyReleaseEvidence("production", "owner/repo", sha, "test-token")).rejects.toThrow("canary");
    canarySha = sha; includeReadiness = false;
    await expect(verifyReleaseEvidence("production", "owner/repo", sha, "test-token")).rejects.toThrow("readiness");
  } finally { globalThis.fetch = oldFetch; }
});

import opportunitiesTool from "./mcp/tools/list-opportunities";
test("MCP filters canonical sales_stage and validates invalid stages", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://audit.invalid"; process.env.SUPABASE_PUBLISHABLE_KEY = "test-public";
  let seen: URL | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL) => { seen = new URL(String(input)); return Response.json([]); }) as typeof fetch;
  try {
    expect(opportunitiesTool.inputSchema!.sales_stage.safeParse("made-up").success).toBe(false);
    const ctx = { isAuthenticated: () => true, getToken: () => "test-session" };
    await opportunitiesTool.handler({ limit: 20, sales_stage: "jih" }, ctx as never);
    expect(seen?.searchParams.get("sales_stage")).toBe("eq.jih");
    expect(seen?.searchParams.has("status")).toBe(false);
    await opportunitiesTool.handler({ limit: 20 }, ctx as never);
    expect(seen?.searchParams.has("sales_stage")).toBe(false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
