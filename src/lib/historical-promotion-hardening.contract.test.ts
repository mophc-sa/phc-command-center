// =============================================================================
// The frontend half of the promotion hardening.
//
// Two things had to change out here, and both are the kind that a database
// test cannot see: the value a dashboard sums, and whether an archived deal
// still counts.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { computeJihPipelineTotal } from "@/lib/dashboard-helpers";
import { opportunityValue } from "@/lib/sales-kpis";
import { resolveCanonicalStage } from "@/lib/stage-canonical";

/** A promoted historical deal, as promote_historical_row() writes it. */
const promoted = (over: Record<string, unknown> = {}) => ({
  sales_stage: "jih",
  stage: "quotation",
  contract_value: null,
  quotation_value: 250_000,
  estimated_value_max: null,
  ...over,
});

describe("one value resolver, shared by every reader", () => {
  it("counts a promoted deal that has a quoted figure and no estimate", () => {
    // The whole point. This returned 0 before, because it summed
    // estimated_value_max and promotion writes quotation_value.
    expect(computeJihPipelineTotal([promoted() as never])).toBe(250_000);
  });

  it("agrees with opportunityValue on the same row", () => {
    const row = promoted();
    expect(computeJihPipelineTotal([row as never])).toBe(opportunityValue(row as never));
  });

  it("still prefers a contract value over a quotation", () => {
    expect(computeJihPipelineTotal([
      promoted({ contract_value: 400_000 }) as never,
    ])).toBe(400_000);
  });

  it("falls back to the estimate when nothing firmer exists", () => {
    expect(computeJihPipelineTotal([
      promoted({ quotation_value: null, estimated_value_max: 90_000 }) as never,
    ])).toBe(90_000);
  });

  it("sums the P0 shape: 44 deals all carrying quotation_value only", () => {
    const rows = Array.from({ length: 44 }, () => promoted({ quotation_value: 1_000 }));
    expect(computeJihPipelineTotal(rows as never)).toBe(44_000);
  });

  it("excludes rfq_received, so a deal that never transitioned is not counted", () => {
    // Promotion opens at rfq_received and then transitions (D6). A deal stuck
    // at the opening stage is a promotion that did not finish, and counting it
    // as JIH pipeline would hide that.
    expect(computeJihPipelineTotal([promoted({ sales_stage: "rfq_received" }) as never])).toBe(0);
  });

  it("excludes won and lost", () => {
    expect(computeJihPipelineTotal([
      promoted({ sales_stage: "won" }) as never,
      promoted({ sales_stage: "lost" }) as never,
    ])).toBe(0);
  });

  it("treats a missing value as zero rather than NaN", () => {
    expect(computeJihPipelineTotal([
      promoted({ quotation_value: null }) as never,
    ])).toBe(0);
  });
});

describe("an archived opportunity is off the pipeline, whatever its sales_stage says", () => {
  it("resolves to no stage even while sales_stage is live", () => {
    // Voiding a promotion sets stage='archived' and deliberately leaves
    // sales_stage alone so the history still reads correctly. Before the fix
    // sales_stage won and the voided deal kept counting.
    expect(resolveCanonicalStage({ sales_stage: "jih", stage: "archived" }))
      .toEqual({ stage: null, source: "none" });
  });

  it("outranks a won or lost legacy stage too", () => {
    expect(resolveCanonicalStage({ sales_stage: "won", stage: "archived" }).stage).toBeNull();
  });

  it("leaves a live deal alone", () => {
    expect(resolveCanonicalStage({ sales_stage: "jih", stage: "quotation" }))
      .toEqual({ stage: "jih", source: "sales_stage" });
  });

  it("still reads won and lost from the legacy column when sales_stage is absent", () => {
    // The archived reordering must not have cost the legacy terminal fallback.
    expect(resolveCanonicalStage({ sales_stage: null, stage: "won" }))
      .toEqual({ stage: "won", source: "legacy_terminal" });
    expect(resolveCanonicalStage({ sales_stage: null, stage: "lost" }))
      .toEqual({ stage: "lost", source: "legacy_terminal" });
  });

  it("still infers the entry stage for a generic CRM bucket", () => {
    expect(resolveCanonicalStage({ sales_stage: null, stage: "quotation" }))
      .toEqual({ stage: "rfq_received", source: "inferred" });
  });

  it("keeps a voided deal out of the JIH pipeline total", () => {
    // Writing the previous test turned this up: computeJihPipelineTotal filters
    // on sales_stage directly, not through resolveCanonicalStage, so fixing the
    // resolver alone would not have kept a voided deal out of My Workspace. The
    // helper now drops archived rows itself, and both My Workspace queries were
    // selecting neither `stage` nor `quotation_value` — so they were fetching
    // the wrong columns for either check to work.
    const voided = promoted({ stage: "archived" });
    expect(resolveCanonicalStage(voided as never).stage).toBeNull();
    expect(computeJihPipelineTotal([voided as never])).toBe(0);
  });

  it("still counts the live deals beside a voided one", () => {
    expect(computeJihPipelineTotal([
      promoted({ stage: "archived", quotation_value: 500_000 }) as never,
      promoted({ quotation_value: 250_000 }) as never,
    ])).toBe(250_000);
  });
});
