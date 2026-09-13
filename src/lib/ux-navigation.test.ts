import { describe, expect, it } from "bun:test";
import { actionHref } from "./action-center";
import { bucketKpi, MANAGEMENT_BUCKETS, type OppRow } from "./sales-kpis";
import { matchesOpportunitySearch, parseOpportunitySearch } from "./drilldown";

describe("UX drilldowns preserve the user's selected record and scope", () => {
  it("filters absent values without treating an explicitly recorded zero as missing", () => {
    const filter = parseOpportunitySearch({ missing: "value" });
    expect(matchesOpportunitySearch({ contract_value: 0 }, filter)).toBe(false);
    expect(matchesOpportunitySearch({ contract_value: null, quotation_value: 500 }, filter)).toBe(false);
    expect(matchesOpportunitySearch({ contract_value: null }, filter)).toBe(true);
  });

  it("preserves the missing probability filter and keeps a recorded zero", () => {
    const filter = parseOpportunitySearch({ missing: "probability" });
    expect(filter.missing).toBe("probability");
    expect(matchesOpportunitySearch({ human_win_probability: 0 }, filter)).toBe(false);
    expect(matchesOpportunitySearch({ human_win_probability: null }, filter)).toBe(true);
  });

  it("uses outcome dates, excludes undated outcomes, and ignores unrelated edits", () => {
    const filter = parseOpportunitySearch({ stage: "won", from: "2026-09-01", to: "2026-10-01" });
    expect(matchesOpportunitySearch({ sales_stage: "won", won_at: "2026-09-03", updated_at: "2026-11-01" }, filter)).toBe(true);
    expect(matchesOpportunitySearch({ sales_stage: "won", won_at: "2026-06-03", updated_at: "2026-09-01" }, filter)).toBe(false);
    expect(matchesOpportunitySearch({ sales_stage: "won", updated_at: "2026-09-01" }, filter)).toBe(false);
  });

  it("encodes intake identity as one query value", () => {
    const url = new URL(actionHref("inbox_item", "item & review=all"), "https://example.test");
    expect(url.pathname).toBe("/lead-tender-inbox");
    expect(url.searchParams.get("item")).toBe("item & review=all");
    expect(url.searchParams.has("review")).toBe(false);
  });

  for (const bucket of MANAGEMENT_BUCKETS) {
    it(`keeps the missing-value repair inside ${bucket.key}`, () => {
      const rows: OppRow[] = bucket.stages.map((stage, index) => ({
        id: `sample-${index}`, sales_stage: stage, stage,
        contract_value: null, quotation_value: null, estimated_value_max: null,
      }));
      const metric = bucketKpi(rows, { today: "2026-09-13", period: null }, bucket.key);
      expect(metric.fix).toBeDefined();
      const filter = parseOpportunitySearch(metric.fix!.search);
      expect(rows.every(row => matchesOpportunitySearch(row, filter))).toBe(true);
      expect(matchesOpportunitySearch({ id: "other", sales_stage: "lost", stage: "lost" }, filter)).toBe(false);
      expect(metric.fix!.search.stage).toBe(metric.drilldown!.search.stage);
    });
  }
});
