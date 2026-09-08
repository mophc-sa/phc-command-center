import { describe, expect, test } from "bun:test";
import { salesFacts, readAll } from "../../supabase/functions/_shared/ai-facts";

describe("AI shares real pipeline semantics", () => {
  test("counts unvalued open deals, excludes archived canonical JIH, and separates currencies and wins", () => {
    const facts = salesFacts(
      [
        {
          stage: "quotation",
          sales_stage: "jih",
          contract_value: "120",
          quotation_value: 200,
          currency: "SAR",
        },
        { stage: "quotation", sales_stage: "jih", currency: "SAR" },
        { stage: "archived", sales_stage: "jih", contract_value: 900, currency: "SAR" },
        { stage: "won", sales_stage: "won", contract_value: 55, currency: "SAR" },
        { stage: "qualification", sales_stage: "on_hold", quotation_value: 70, currency: "USD" },
      ],
      [{ status: "submitted", value: "10", currency: "SAR" }],
    );
    expect(facts.open).toEqual({
      count: 3,
      valued: 2,
      unvalued: 1,
      value_by_currency: { SAR: 120, USD: 70 },
    });
    expect(facts.won_count).toBe(1);
    expect(facts.quotation_win_rate_pct).toBeNull();
    expect(facts.opportunity_count).toBe(4);
    expect(facts.archived_count).toBe(1);
  });
  test("loads beyond both old 500 and REST 1000 limits", async () => {
    const rows = Array.from({ length: 1501 }, (_, id) => ({ id }));
    expect(
      await readAll(async (from, to) => ({ data: rows.slice(from, to + 1), error: null })),
    ).toHaveLength(1501);
  });
  test("an error on a later page cannot become a partial total", async () => {
    await expect(
      readAll(async (from) =>
        from === 0
          ? { data: Array(500).fill({ id: 1 }), error: null }
          : { data: null, error: { message: "denied" } },
      ),
    ).rejects.toThrow("read failed");
  });
  test("an unknown amount is distinct from a recorded zero", () => {
    expect(
      salesFacts(
        [{ stage: "quotation", contract_value: 0, currency: "SAR" }, { stage: "quotation" }],
        [],
      ).open,
    ).toEqual({ count: 2, valued: 1, unvalued: 1, value_by_currency: { SAR: 0 } });
  });
});
