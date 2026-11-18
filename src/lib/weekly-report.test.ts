import { describe, expect, it } from "bun:test";
import { changeKind, weekOf, weeklyCounts, type StageChange } from "./weekly-report";

describe("weekly report", () => {
  it("weeks run Sunday to Saturday", () => {
    expect(weekOf("2026-11-18")).toEqual({ from: "2026-11-15", to: "2026-11-22" }); // a Wednesday
    expect(weekOf("2026-11-15")).toEqual({ from: "2026-11-15", to: "2026-11-22" }); // the Sunday itself
    expect(weekOf("2026-11-18", -1)).toEqual({ from: "2026-11-08", to: "2026-11-15" });
  });

  it("classifies a change by where the deal went", () => {
    expect(changeKind("verbally_awarded")).toBe("verbal");
    expect(changeKind("contract_signed")).toBe("signed");
    expect(changeKind("on_hold")).toBe("held");
    expect(changeKind("jih_bafo")).toBe("moved");
  });

  it("counts each deal once, by its latest change in the week", () => {
    const c = (id: string, to: string, at: string): StageChange => ({ opportunityId: id, from: "jih", to, at, source: "user" });
    const k = weeklyCounts([c("a", "under_negotiation", "2026-11-16"), c("a", "verbally_awarded", "2026-11-17"), c("b", "lost", "2026-11-16")], 4, 6);
    expect(k).toEqual({ newDeals: 4, quotesSent: 6, verbal: 1, signed: 0, held: 0, lost: 1, moved: 0 });
  });
});
