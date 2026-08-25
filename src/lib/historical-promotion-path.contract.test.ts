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

describe("preflight refuses exactly what the database refuses", () => {
  // The bug this exists to prevent, in full.
  //
  // On 2026-08-24 preflight reported 49 eligible records where
  // promote_historical_row() would promote 45. The four extra all carried a
  // bare owner prefix — `FA`, `OM` — as their sales code: a placeholder the
  // source spreadsheet used, not a quotation number. 48 archive rows share
  // five such values, so promoting them would merge unrelated jobs.
  //
  // The SQL function had refused placeholders since 20260911120000. The
  // handler simply never asked. Both halves were individually correct and
  // disagreed with each other, which is why the earlier tests — each checking
  // one side in isolation — all passed.
  //
  // The manifest gate caught it and refused the batch, so nothing was written.
  // These tests are what stops it recurring: they compare the two rule sets
  // rather than testing either alone.
  const sql = read("supabase/migrations/20260911120000_hist_promotion_hardening.sql");
  // Terminates at `END; $$;` — the function body is a dollar-quoted block, so
  // matching a bare `$$;` on its own line finds nothing.
  const promoteFn = sql.match(
    /CREATE OR REPLACE FUNCTION public\.promote_historical_row[\s\S]*?\nEND; \$\$;/,
  )?.[0] ?? "";
  const reasons = code(handler).match(
    /function ineligibleReasons[\s\S]*?\n}/,
  )?.[0] ?? "";

  it("finds both rule sets", () => {
    expect(promoteFn.length).toBeGreaterThan(0);
    expect(reasons.length).toBeGreaterThan(0);
  });

  /**
   * Each SQL refusal, paired with the preflight reason that must mirror it.
   * `sql` is a fragment of the guard's condition; `reason` is the string the
   * handler pushes. A refusal the database makes with no counterpart here is
   * the exact shape of the 49-vs-45 bug.
   */
  const PARITY: Array<{ sql: string; reason: string; what: string }> = [
    { sql: "NOT public.is_active_user(_r.owner_user_id)", reason: "no_mapped_owner",     what: "ownerless or inactive owner" },
    { sql: "_r.company_id IS NULL",                       reason: "company_unmatched",   what: "no mapped company" },
    { sql: "_m.code_placeholder",                         reason: "code_placeholder",    what: "bare owner prefix as a sales code" },
    { sql: "_m.code_unparsed",                            reason: "code_unparsed",       what: "unreadable sales code" },
    { sql: "_m.sales_code_raw IS NULL",                   reason: "missing_sales_code",  what: "no sales code at all" },
    { sql: "_m.route IS NULL",                            reason: "route_undetermined",  what: "no JIH/TENDER route" },
    { sql: "_m.date_submitted IS NULL",                   reason: "no_submission_date",  what: "no evidence a quotation was issued" },
    { sql: "NOT _sm.promotable_active",                   reason: "status_not_active",   what: "status not promotable in this batch" },
    { sql: "_r.amount_excl_vat IS NULL",                  reason: "no_amount",           what: "no amount" },
    { sql: "EXACT_DUPLICATE_REJECTED",                    reason: "collision_",          what: "repeated spreadsheet row" },
  ];

  for (const { sql: guard, reason, what } of PARITY) {
    it(`refuses ${what} on both sides`, () => {
      expect(promoteFn, `SQL no longer guards: ${guard}`).toContain(guard);
      expect(reasons, `preflight has no reason for: ${guard}`).toContain(reason);
    });
  }

  it("a mapping-less archive row is refused, not silently passed", () => {
    // promote_historical_row() raises "run remap_historical_sales() first".
    expect(promoteFn).toContain("run remap_historical_sales()");
    expect(reasons).toContain("no_mapping");
  });

  it("reads the code flags rather than re-deriving the parser rule", () => {
    // A second copy of the placeholder regex in TypeScript would be a new
    // place for the same rule to drift — which is the bug, not the fix.
    const c = code(handler);
    expect(c).toContain("historical_sales_mapped");
    expect(c).toContain("code_placeholder");
    expect(c).toContain("code_unparsed");
    expect(c, "the placeholder rule must not be duplicated in TS").not.toMatch(/\^\[A-Z\]\{2\}\$/);
  });

  it("fetches the flags once for a batch, not once per row", () => {
    // 679 archive rows behind this endpoint; an N+1 here would be the slowest
    // thing in it.
    const fn = code(handler).match(/async function codeFlags[\s\S]*?\n}/)?.[0] ?? "";
    expect(fn).toContain("if (rowId) q = q.eq(");
    expect(code(handler).match(/await codeFlags\(/g) ?? []).toHaveLength(1);
  });
});

describe("ineligibility rules, exercised directly", () => {
  // The handler is Deno-only, so the rules are re-stated here against the same
  // inputs. Not a substitute for the parity test above — that one is what
  // proves these match the database.
  type Flags = { placeholder: boolean; unparsed: boolean; hasCode: boolean };
  const OK: Flags = { placeholder: false, unparsed: false, hasCode: true };

  /** Mirrors ineligibleReasons() for the sales-code branch. */
  const codeReasons = (f: Flags | undefined): string[] => {
    if (!f) return ["no_mapping"];
    const out: string[] = [];
    if (!f.hasCode) out.push("missing_sales_code");
    if (f.placeholder) out.push("code_placeholder");
    if (f.unparsed) out.push("code_unparsed");
    return out;
  };

  it("a placeholder code is never eligible", () => {
    // `FA` and `OM` — the four records that produced 49 instead of 45.
    expect(codeReasons({ ...OK, placeholder: true })).toContain("code_placeholder");
  });

  it("an unparsed code is never eligible", () => {
    expect(codeReasons({ ...OK, unparsed: true })).toContain("code_unparsed");
  });

  it("a missing sales code is never eligible", () => {
    expect(codeReasons({ ...OK, hasCode: false })).toContain("missing_sales_code");
  });

  it("a row with no derived mapping is never eligible", () => {
    expect(codeReasons(undefined)).toEqual(["no_mapping"]);
  });

  it("a clean code raises nothing", () => {
    expect(codeReasons(OK)).toEqual([]);
  });

  it("reports every applicable reason, not just the first", () => {
    // A record blocked three ways should say so — one reason at a time turns
    // remediation into a guessing game.
    expect(codeReasons({ placeholder: true, unparsed: true, hasCode: false })).toEqual(
      ["missing_sales_code", "code_placeholder", "code_unparsed"],
    );
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
