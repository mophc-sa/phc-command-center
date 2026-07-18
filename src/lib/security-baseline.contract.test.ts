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

  test("team provisioning migration is safe on a clean CI database", () => {
    const source = readFileSync(
      join(root, "supabase/migrations/20260713140000_phase_b_team_provisioning.sql"),
      "utf8",
    );
    expect(source).not.toContain(
      "RAISE EXCEPTION 'Phase B: moalagab@phc-sa.com not found",
    );
    expect(source).toContain(
      "skipping admin role cleanup (safe on dev/CI)",
    );
  });

  test("optional pg_cron metadata is guarded on a clean CI database", () => {
    const source = readFileSync(
      join(root, "supabase/migrations/20260713170000_ai_weekly_report_cron.sql"),
      "utf8",
    );
    expect(source).not.toMatch(/\nCOMMENT ON EXTENSION pg_cron/);
    expect(source).toContain("WHERE extname = 'pg_cron'");
    expect(source).toContain("EXECUTE $comment$");
  });

  test("sales actuals uses a valid expression-based unique index", () => {
    const source = readFileSync(
      join(root, "supabase/migrations/20260714210000_business_destinations.sql"),
      "utf8",
    );
    expect(source).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS sales_actuals_unique_metric_idx",
    );
    const tableDefinition = source.slice(
      source.indexOf("CREATE TABLE IF NOT EXISTS public.sales_actuals_monthly"),
      source.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS sales_actuals_unique_metric_idx"),
    );
    expect(tableDefinition).not.toContain("COALESCE(");
  });
});
