import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

describe("phase 1 security baseline", () => {
  test("SSR responses apply the required security headers", () => {
    const source = readFileSync(join(root, "src/server.ts"), "utf8");
    for (const header of [
      "Content-Security-Policy-Report-Only",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]) {
      expect(source).toContain(header);
    }
    expect(source).toContain("withSecurityHeaders(request");
  });

  test("Edge Function CORS is not open to every origin", () => {
    const source = readFileSync(join(root, "supabase/functions/_shared/cors.ts"), "utf8");
    expect(source).not.toContain('"Access-Control-Allow-Origin": "*"');
    expect(source).toContain("CORS_ALLOWED_ORIGIN");
    expect(source).toContain("https://agent.phc-sa.com");
  });

  test("MCP read tools use explicit projections and generic client errors", () => {
    const toolDir = join(root, "src/lib/mcp/tools");
    for (const filename of [
      "list-approvals.ts",
      "list-opportunities.ts",
      "list-recommendations.ts",
      "recent-agent-runs.ts",
    ]) {
      const source = readFileSync(join(toolDir, filename), "utf8");
      expect(source).not.toContain('.select("*")');
      expect(source).not.toContain("text: error.message");
    }
  });
});
