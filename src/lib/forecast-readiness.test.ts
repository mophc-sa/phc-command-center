// =============================================================================
// The buckets must partition the book, or the donut lies about its own hole.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { forecastReadiness } from "@/lib/forecast-readiness";

describe("why a deal is not in the forecast", () => {
  it("a deal with value and probability is ready", () => {
    const r = forecastReadiness([{ quotation_value: 100, human_win_probability: 60 }]);
    expect(r.ready.length).toBe(1);
    expect(r.no_value.length + r.no_probability.length).toBe(0);
  });

  it("a deal with value and no probability is missing a probability", () => {
    const r = forecastReadiness([{ quotation_value: 100 }]);
    expect(r.no_probability.length).toBe(1);
  });

  it("a deal with neither is reported as missing its VALUE", () => {
    // Both are true. Only one is worth saying first: entering a probability on
    // a deal worth nothing still leaves it out of the forecast, so a reader
    // who works the buckets in order never does the job twice.
    const r = forecastReadiness([{}]);
    expect(r.no_value.length).toBe(1);
    expect(r.no_probability.length).toBe(0);
  });

  it("zero is a probability, and zero is a value", () => {
    // A deal the manager judged hopeless is a judgement that was made. Reading
    // it as "not entered" would send them back to re-enter what they said.
    const r = forecastReadiness([{ contract_value: 0, human_win_probability: 0 }]);
    expect(r.ready.length).toBe(1);
  });

  it("follows the money chain, so a contract with no estimate still counts", () => {
    const r = forecastReadiness([{ contract_value: 14_000_000, human_win_probability: 90 }]);
    expect(r.ready.length).toBe(1);
  });

  it("partitions: the three lengths always sum to the input", () => {
    const rows = [
      { quotation_value: 100, human_win_probability: 60 },
      { quotation_value: 100 },
      {},
      { estimated_value_max: 5, human_win_probability: 0 },
      { contract_value: null, quotation_value: null, estimated_value_max: null, human_win_probability: 80 },
    ];
    const r = forecastReadiness(rows);
    expect(r.ready.length + r.no_probability.length + r.no_value.length).toBe(rows.length);
    // And no row is in two buckets.
    const all = [...r.ready, ...r.no_probability, ...r.no_value];
    expect(new Set(all).size).toBe(rows.length);
  });

  it("returns the rows themselves, not copies", () => {
    // The caller opens these records. A clone would open nothing.
    const row = { quotation_value: 100 };
    expect(forecastReadiness([row]).no_probability[0]).toBe(row);
  });

  it("gives three empty buckets for an empty book", () => {
    const r = forecastReadiness([]);
    expect([r.ready, r.no_probability, r.no_value].every((b) => b.length === 0)).toBe(true);
  });
});
