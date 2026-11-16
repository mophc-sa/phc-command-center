import { describe, expect, it } from "vitest";
import { liveQuotes } from "./live-quotes";

describe("liveQuotes", () => {
  it("drops quotations whose deal is archived and keeps the rest", () => {
    const rows = [
      { id: "a", deal: { stage: "quotation" } },
      { id: "b", deal: { stage: "archived" } },
      { id: "c", deal: null },
      { id: "d" },
    ];
    expect(liveQuotes(rows).map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(liveQuotes(null)).toEqual([]);
  });
});
