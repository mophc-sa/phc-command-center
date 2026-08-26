// =============================================================================
// Phase 5.1 Package A — metric correctness.
//
// The failures these guard against all look like working software on screen:
// a confident SAR 0 that is really an absence, a coverage ratio that blames a
// missing target when the real gap is unscored deals, and buckets that double
// count because two of them claim the same stage.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  MANAGEMENT_BUCKETS,
  bucketKpi,
  forecastVsTarget,
  metricStateOf,
  pipelineCoverage,
  weightedPipeline,
  type OppRow,
} from "@/lib/sales-kpis";
import { CANONICAL_STAGES } from "@/lib/stage-canonical";

const CTX = { today: "2026-08-26", period: null };
const row = (o: Partial<OppRow> & { id: string }): OppRow => ({ sales_stage: "jih", ...o });

describe("the five management buckets", () => {
  it("never counts one stage in two buckets", () => {
    // This is what makes it safe to add the buckets up. If it ever fails, every
    // total built on them silently over-reports.
    const seen = new Map<string, string>();
    for (const b of MANAGEMENT_BUCKETS) {
      for (const s of b.stages) {
        expect([s, seen.get(s) ?? null]).toEqual([s, null]);
        seen.set(s, b.key);
      }
    }
  });

  it("leaves on_hold and lost out of the ladder", () => {
    const claimed = MANAGEMENT_BUCKETS.flatMap((b) => b.stages as readonly string[]);
    expect(claimed).not.toContain("on_hold");
    expect(claimed).not.toContain("lost");
  });

  it("claims every other canonical stage exactly once", () => {
    const claimed = MANAGEMENT_BUCKETS.flatMap((b) => b.stages as readonly string[]);
    const expected = CANONICAL_STAGES.filter((s) => s !== "on_hold" && s !== "lost");
    expect([...claimed].sort()).toEqual([...expected].sort());
  });

  it("sums only the priced rows and says how many it left out", () => {
    const k = bucketKpi(
      [
        row({ id: "a", sales_stage: "jih", quotation_value: 1_000_000 }),
        row({ id: "b", sales_stage: "jih" }),
      ],
      CTX,
      "open_pipeline",
    );
    expect(k.value).toBe(1_000_000);
    expect(k.recordCount).toBe(2);
    expect(k.caveat).toContain("1 of 2");
    expect(k.fix?.labelKey).toBe("fix_add_value");
  });

  it("an unpriced bucket is not_calculated, never a zero", () => {
    // "SAR 0" here would say the work is worthless. It says nothing of the kind.
    const k = bucketKpi([row({ id: "a", sales_stage: "verbally_awarded" })], CTX, "pending_contract");
    expect(k.value).toBeNull();
    expect(metricStateOf(k)).toBe("not_calculated");
  });

  it("an empty bucket is a real zero, and says so", () => {
    const k = bucketKpi([row({ id: "a", sales_stage: "jih" })], CTX, "contracted");
    expect(k.value).toBe(0);
    expect(metricStateOf(k)).toBe("no_data");
  });
});

describe("weighted pipeline never reports a borrowed zero", () => {
  it("one deal scored at 0% beside unscored deals is not calculated", () => {
    // The 2026-08-25 screenshot: SAR 0 sitting under a 63M pipeline.
    const k = weightedPipeline(
      [
        row({ id: "scored", score: 0, quotation_value: 900_000 }),
        row({ id: "u1", quotation_value: 40_000_000 }),
        row({ id: "u2", quotation_value: 22_000_000 }),
      ],
      CTX,
    );
    expect(k.value).toBeNull();
    expect(metricStateOf(k)).toBe("not_calculated");
    expect(k.caveat).toContain("2 open deals have no probability");
    expect(k.fix?.labelKey).toBe("fix_add_probability");
  });

  it("but a genuine zero across a fully scored book IS reported as zero", () => {
    // Every deal assessed and every one hopeless is knowledge, not ignorance,
    // and hiding it behind a dash would be the opposite error.
    const k = weightedPipeline(
      [row({ id: "a", score: 0, quotation_value: 500_000 }), row({ id: "b", score: 0, quotation_value: 100_000 })],
      CTX,
    );
    expect(k.value).toBe(0);
    expect(metricStateOf(k)).toBe("ok");
  });

  it("a partly scored book reports the partial sum and names the remainder", () => {
    const k = weightedPipeline(
      [row({ id: "a", human_win_probability: 50, quotation_value: 1_000_000 }), row({ id: "b", quotation_value: 9_000_000 })],
      CTX,
    );
    expect(k.value).toBe(500_000);
    expect(k.caveat).toContain("1 open deal has no probability");
  });

  it("no open deals at all is no_data, not not_calculated", () => {
    const k = weightedPipeline([row({ id: "a", sales_stage: "won" })], CTX);
    expect(metricStateOf(k)).toBe("no_data");
  });
});

describe("pipeline coverage distinguishes the two ways it can fail", () => {
  const scored = [row({ id: "a", human_win_probability: 50, quotation_value: 20_000_000 })];

  it("computes a multiple when both inputs exist", () => {
    const k = pipelineCoverage(scored, CTX, 5_000_000);
    expect(k.value).toBe(2); // 10M weighted / 5M target
    expect(metricStateOf(k)).toBe("ok");
  });

  it("no target is not_configured and points at Targets", () => {
    const k = pipelineCoverage(scored, CTX, null);
    expect(metricStateOf(k)).toBe("not_configured");
    expect(k.fix?.to).toBe("/targets");
  });

  it("no probability is not_calculated and points at the unscored deals", () => {
    // Sending a manager to set a target when the real gap is 45 unscored deals
    // burns the one action they were willing to take.
    const k = pipelineCoverage([row({ id: "a", quotation_value: 9_000_000 })], CTX, 5_000_000);
    expect(metricStateOf(k)).toBe("not_calculated");
    expect(k.fix?.search.missing).toBe("probability");
  });

  it("reports below 1.0x rather than rounding it away", () => {
    const k = pipelineCoverage([row({ id: "a", human_win_probability: 40, quotation_value: 10_000_000 })], CTX, 5_000_000);
    expect(k.value).toBe(0.8);
  });
});

describe("forecast vs target", () => {
  const book = [
    row({ id: "won1", sales_stage: "won", contract_value: 3_000_000 }),
    row({ id: "open1", human_win_probability: 50, quotation_value: 8_000_000 }),
  ];

  it("gives all six numbers", () => {
    const f = forecastVsTarget(book, CTX, 10_000_000);
    expect(f.target.value).toBe(10_000_000);
    expect(f.won.value).toBe(3_000_000);
    expect(f.forecast.value).toBe(4_000_000);
    expect(f.achievement.value).toBe(30);
    expect(f.gap.value).toBe(7_000_000);
    expect(f.coverage.value).toBe(0.4);
  });

  it("forecast is the weighted pipeline, not the gross", () => {
    // A forecast that ignores probability is the pipeline wearing a better name.
    const f = forecastVsTarget(book, CTX, 10_000_000);
    expect(f.forecast.value).not.toBe(8_000_000);
  });

  it("won counts Won only — a verbal award is not revenue", () => {
    const f = forecastVsTarget(
      [...book, row({ id: "va", sales_stage: "verbally_awarded", contract_value: 50_000_000 })],
      CTX,
      10_000_000,
    );
    expect(f.won.value).toBe(3_000_000);
  });

  it("with no target set, the four target-derived numbers say not_configured", () => {
    const f = forecastVsTarget(book, CTX, null);
    for (const k of [f.target, f.achievement, f.gap, f.coverage]) {
      expect([k.key, metricStateOf(k)]).toEqual([k.key, "not_configured"]);
      expect([k.key, k.fix?.to ?? null]).toEqual([k.key, "/targets"]);
    }
  });

  it("won and forecast still compute without a target", () => {
    // They do not depend on it, and blanking them would hide real numbers
    // behind an unrelated missing setting.
    const f = forecastVsTarget(book, CTX, null);
    expect(f.won.value).toBe(3_000_000);
    expect(f.forecast.value).toBe(4_000_000);
  });
});

describe("metric state derivation", () => {
  it("an explicit state always wins over the derivation", () => {
    expect(metricStateOf({ value: null, recordCount: 0, state: "not_configured" })).toBe("not_configured");
  });

  it("a real zero is ok, not an empty state", () => {
    expect(metricStateOf({ value: 0, recordCount: 4, state: undefined })).toBe("ok");
  });

  it("null with no records is no_data; null with records is not_calculated", () => {
    expect(metricStateOf({ value: null, recordCount: 0, state: undefined })).toBe("no_data");
    expect(metricStateOf({ value: null, recordCount: 9, state: undefined })).toBe("not_calculated");
  });
});
