// =============================================================================
// The authorized promotion path.
//
// The thing worth testing here is not "does promotion work" — the behavioural
// DB suite covers that against a real Postgres. It is that the NEW path cannot
// become a way around the authority the database already enforces.
//
// Three properties carry that:
//
//   1. the handler acts as the CALLER, never as the service role
//   2. the role gate matches the database function exactly, and admits nobody
//      the database would refuse
//   3. batch activation cannot promote a set nobody approved
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canApproveHistoricalPromotion } from "@/lib/roles";
import {
  ACTIVATION_MANIFEST, checkAgainstManifest, runApprovedBatch,
  type PromotionResult,
} from "@/lib/historical-promotion-actions";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const handler = read("supabase/functions/sales-os-api/handlers/historical-promotion.ts");
const contracts = read("supabase/functions/sales-os-api/contracts.ts");
const index = read("supabase/functions/sales-os-api/index.ts");
const migration = read("supabase/migrations/20260829100000_phase7d_historical_promotion.sql");

/** Source with comment lines stripped — the prose names the things it warns about. */
const code = (s: string) =>
  s.split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

describe("the caller's own identity reaches the database", () => {
  it("the context exposes a caller-scoped client", () => {
    expect(contracts).toContain("readonly asCaller");
    expect(contracts).toContain("createUserClient(authorization)");
  });

  it("index wires the real userClient, not a second service client", () => {
    expect(index).toContain("userClient");
    expect(index).toMatch(/createSalesOsContext\(caller, authorization, serviceClient, userClient, audit\)/);
  });

  it("the handler calls promote_historical_row through the caller, never the service role", () => {
    const c = code(handler);
    // This is the load-bearing assertion of the whole feature. Under the
    // service role auth.uid() is NULL and can_approve_historical_promotion()
    // refuses — so a switch to ctx.svc here would not merely be wrong, it
    // would break every promotion. Pinning it means the mistake is caught at
    // review rather than in production.
    expect(c).toMatch(/const db = ctx\.asCaller;/);
    expect(c).toContain('db.rpc("promote_historical_row"');
    expect(c).not.toMatch(/ctx\.svc\s*\.\s*rpc/);
    expect(c).not.toMatch(/svc\.rpc\("promote_historical_row"/);
  });

  it("the handler never touches ctx.svc at all", () => {
    // Nothing in this flow needs to bypass RLS. If a future edit reaches for
    // the service role, that is the moment to ask why.
    expect(code(handler)).not.toContain("ctx.svc");
  });

  it("no user id can be supplied by the caller", () => {
    // Approval identity comes from the JWT via auth.uid(). Accepting an
    // ownerId/approverId from the payload would be an impersonation hole.
    const c = code(handler);
    expect(c).not.toMatch(/payload\.(userId|approverId|actorId|ownerId|asUser)/);
    expect(c).not.toContain("request.jwt.claims");
    expect(c).not.toContain("set_config");
  });

  it("exposes no generic SQL or RPC passthrough", () => {
    const c = code(handler);
    const rpcCalls = [...c.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(rpcCalls)]).toEqual(["promote_historical_row"]);
    expect(c).not.toMatch(/\.rpc\(\s*(payload|String\(payload)/);
  });

  it("exposes no cost or margin field", () => {
    const c = code(handler);
    for (const forbidden of ["cost", "margin", "supplier", "internal_price"]) {
      expect(c.toLowerCase()).not.toContain(`${forbidden}_`);
    }
  });
});

describe("the role gate mirrors the database, and widens nothing", () => {
  const ROLES = {
    salesManager: ["sales_manager"],
    bdManager: ["bd_manager"],
    generalManager: ["general_manager"],
    salesperson: ["salesperson"],
    viewer: ["viewer"],
    systemAdmin: ["system_admin"],
    financeManager: ["finance_manager"],
    estimationManager: ["estimation_manager"],
    managingDirector: ["managing_director"],
    ceo: ["ceo"],
    none: [] as string[],
  };

  it("allows exactly the three the SQL function allows", () => {
    expect(canApproveHistoricalPromotion(ROLES.salesManager)).toBe(true);
    expect(canApproveHistoricalPromotion(ROLES.bdManager)).toBe(true);
    expect(canApproveHistoricalPromotion(ROLES.generalManager)).toBe(true);
  });

  it("refuses a salesperson", () => {
    expect(canApproveHistoricalPromotion(ROLES.salesperson)).toBe(false);
  });

  it("refuses a viewer", () => {
    expect(canApproveHistoricalPromotion(ROLES.viewer)).toBe(false);
  });

  it("refuses system_admin — an operator is not a commercial decision-maker", () => {
    expect(canApproveHistoricalPromotion(ROLES.systemAdmin)).toBe(false);
  });

  it("refuses finance and estimation", () => {
    expect(canApproveHistoricalPromotion(ROLES.financeManager)).toBe(false);
    expect(canApproveHistoricalPromotion(ROLES.estimationManager)).toBe(false);
  });

  it("refuses a caller with no roles", () => {
    expect(canApproveHistoricalPromotion(ROLES.none)).toBe(false);
  });

  it("refuses managing_director and ceo, because the SQL function does", () => {
    // Not an oversight to be helpfully corrected here: widening the set in the
    // app while the database keeps refusing produces a button that 403s.
    expect(canApproveHistoricalPromotion(ROLES.managingDirector)).toBe(false);
    expect(canApproveHistoricalPromotion(ROLES.ceo)).toBe(false);
  });

  it("the SQL function still names exactly those three", () => {
    // If the migration's role set ever changes, this test fails and the mirror
    // above has to be revisited rather than silently drifting.
    const fn = migration.match(/can_approve_historical_promotion[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("'sales_manager'");
    expect(fn).toContain("'bd_manager'");
    expect(fn).toContain("'general_manager'");
    expect(fn).not.toContain("'system_admin'");
    expect(fn).not.toContain("'viewer'");
  });

  it("the handler enforces the gate before creating anything", () => {
    const fn = code(handler).match(/async function promote_historical_record[\s\S]*?\n}/)?.[0] ?? "";
    const gateAt = fn.indexOf("canApproveHistoricalPromotion");
    const insertAt = fn.indexOf(".insert(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(insertAt);
  });
});

describe("the manifest is the approval boundary", () => {
  const approved = {
    batch: "t", approvedOn: "t", currency: "SAR",
    count: 3, totalValueExclVat: 600,
    historicalRowIds: ["a", "b", "c"],
  };

  it("matches when the live set is exactly the approved one", () => {
    const r = checkAgainstManifest({ count: 3, totalValue: 600, rowIds: ["a", "b", "c"] }, approved);
    expect(r.matches).toBe(true);
    expect(r.differences).toEqual([]);
  });

  it("refuses when a record became newly eligible", () => {
    // The failure this exists to prevent: production data moves, the set
    // silently grows, and an approved 45 becomes an unreviewed 46.
    const r = checkAgainstManifest({ count: 4, totalValue: 900, rowIds: ["a", "b", "c", "d"] }, approved);
    expect(r.matches).toBe(false);
    expect(r.differences.some((d) => d.includes("newly eligible"))).toBe(true);
  });

  it("refuses when an approved record dropped out", () => {
    const r = checkAgainstManifest({ count: 2, totalValue: 400, rowIds: ["a", "b"] }, approved);
    expect(r.matches).toBe(false);
    expect(r.differences.some((d) => d.includes("no longer eligible"))).toBe(true);
  });

  it("refuses a different set of the same size and total", () => {
    // Count and sum can both agree while the deals are different. Identity is
    // what actually has to match.
    const r = checkAgainstManifest({ count: 3, totalValue: 600, rowIds: ["a", "b", "z"] }, approved);
    expect(r.matches).toBe(false);
  });

  it("refuses a value drift of one riyal", () => {
    const r = checkAgainstManifest({ count: 3, totalValue: 601, rowIds: ["a", "b", "c"] }, approved);
    expect(r.matches).toBe(false);
    expect(r.differences.some((d) => d.includes("value is"))).toBe(true);
  });

  it("tolerates float noise below a cent", () => {
    const r = checkAgainstManifest({ count: 3, totalValue: 600.001, rowIds: ["a", "b", "c"] }, approved);
    expect(r.matches).toBe(true);
  });

  it("the shipped manifest is the verified batch", () => {
    expect(ACTIVATION_MANIFEST.count).toBe(45);
    expect(ACTIVATION_MANIFEST.totalValueExclVat).toBe(63_407_478);
    expect(ACTIVATION_MANIFEST.historicalRowIds).toHaveLength(45);
    expect(new Set(ACTIVATION_MANIFEST.historicalRowIds).size).toBe(45);
  });

  it("promotes only manifest rows — the caller cannot compose its own batch", () => {
    const r = checkAgainstManifest(
      { count: 45, totalValue: 63_407_478, rowIds: [...ACTIVATION_MANIFEST.historicalRowIds] },
    );
    expect(r.matches).toBe(true);
    expect(r.approvedRowIds).toEqual([...ACTIVATION_MANIFEST.historicalRowIds]);
  });
});

describe("batch execution is sequential and stops on a systemic failure", () => {
  const ok = (rowId: string): PromotionResult => ({
    rowId, requestId: "r", opportunityId: "o", quotationId: "q",
    promotionStatus: "promoted", quoteNumber: "X", legacySalesCode: "X",
    salesStage: "jih", handoffStatus: "submitted", idempotent: false,
    validation: { ok: true, checks: [] },
  });

  it("promotes each row once, in order", async () => {
    const seen: string[] = [];
    const out = await runApprovedBatch(["a", "b", "c"], undefined, async (id) => {
      seen.push(id);
      return ok(id);
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(out.promoted).toHaveLength(3);
    expect(out.failed).toEqual([]);
    expect(out.stoppedEarly).toBe(false);
  });

  it("carries on past a single source-data refusal", async () => {
    const out = await runApprovedBatch(["a", "bad", "c"], undefined, async (id) => {
      if (id === "bad") throw new Error("Archive row is not eligible for promotion");
      return ok(id);
    });
    expect(out.promoted.map((p) => p.rowId)).toEqual(["a", "c"]);
    expect(out.failed).toHaveLength(1);
    expect(out.stoppedEarly).toBe(false);
  });

  it("stops after two consecutive failures", async () => {
    // One refusal is a row. Two in a row is the mechanism, and grinding
    // through the remaining 43 would just produce 43 identical errors.
    const attempted: string[] = [];
    const out = await runApprovedBatch(["a", "b", "c", "d", "e"], undefined, async (id) => {
      attempted.push(id);
      if (id === "b" || id === "c") throw new Error("boom");
      return ok(id);
    });
    expect(attempted).toEqual(["a", "b", "c"]);
    expect(out.stoppedEarly).toBe(true);
    expect(out.attempted).toBe(3);
  });

  it("a failure between two successes does not stop the run", async () => {
    const out = await runApprovedBatch(["a", "bad", "c", "bad2", "e"], undefined, async (id) => {
      if (id.startsWith("bad")) throw new Error("nope");
      return ok(id);
    });
    expect(out.stoppedEarly).toBe(false);
    expect(out.promoted).toHaveLength(3);
    expect(out.failed).toHaveLength(2);
  });

  it("reports progress for every row", async () => {
    const progress: number[] = [];
    await runApprovedBatch(["a", "b"], (p) => progress.push(p.index), async (id) => ok(id));
    expect(progress).toEqual([0, 1]);
  });
});
