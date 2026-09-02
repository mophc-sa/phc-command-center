import { describe, expect, it } from "bun:test";
import { exactMatch, foldForHighlight, rankKey, suggest } from "@/lib/name-suggest";

const NAMES = [
  "SAUDI BINLADEN GROUP SBG",
  "Nesma & Partners",
  "ASTRA CONSTRUCTION CO.",
  "شركة الفنار للمقاولات",
  "UNIFIED",
  "El Khereiji Trading Co.",
];
const s = (q: string) => suggest(NAMES, (x) => x, q).map((r) => r.label);

describe("finding a company that is already there", () => {
  it("finds it from the start of the name", () => {
    expect(s("saudi")).toContain("SAUDI BINLADEN GROUP SBG");
  });

  it("finds it from a word in the middle", () => {
    // People type the word they remember, not the first one.
    expect(s("binladen")).toContain("SAUDI BINLADEN GROUP SBG");
    expect(s("partners")).toContain("Nesma & Partners");
  });

  it("is not stopped by punctuation or case", () => {
    expect(s("astra construction")).toContain("ASTRA CONSTRUCTION CO.");
    expect(s("nesma &")).toContain("Nesma & Partners");
  });

  it("ignores the corporate noise that separates nothing", () => {
    // "ASTRA CONSTRUCTION CO." and "ASTRA CONSTRUCTION" are the same company,
    // and matching on "co" would otherwise rank half the list.
    expect(s("astra")).toContain("ASTRA CONSTRUCTION CO.");
    expect(rankKey("ASTRA CONSTRUCTION CO.")).toBe(rankKey("Astra Construction"));
  });

  it("does not reduce a name that is nothing but noise to an empty key", () => {
    // "Trading Co." would otherwise become "" and match every query typed.
    expect(rankKey("Trading Co.")).not.toBe("");
    expect(s("zzzz")).toEqual([]);
  });
});

describe("Arabic is not a second-class name", () => {
  it("matches across the alef family", () => {
    expect(suggest(["إعمار"], (x) => x, "اعمار").length).toBe(1);
    expect(suggest(["اعمار"], (x) => x, "إعمار").length).toBe(1);
  });

  it("matches ta marbuta against ha, the way people type", () => {
    expect(suggest(["شركة"], (x) => x, "شركه").length).toBe(1);
  });

  it("matches Arabic-Indic digits against Latin ones", () => {
    expect(suggest(["مشروع ١٢٣"], (x) => x, "123").length).toBe(1);
  });

  it("finds an Arabic company by a word inside it", () => {
    expect(s("الفنار")).toContain("شركة الفنار للمقاولات");
  });
});

describe("the highlight lands on the right characters", () => {
  const ranges = (label: string, q: string) =>
    suggest([label], (x) => x, q)[0]?.ranges ?? [];

  it("marks exactly what was typed, in the original name", () => {
    const [r] = ranges("SAUDI BINLADEN GROUP SBG", "binladen");
    expect("SAUDI BINLADEN GROUP SBG".slice(r[0], r[1])).toBe("BINLADEN");
  });

  it("stays correct when the fold changed characters but not their count", () => {
    // This is the whole reason the highlight fold is 1:1. A fold that DELETED
    // the alef hamza would shift every later offset by one and mark the wrong
    // letters.
    const label = "مشروع إعمار الرياض";
    const [r] = ranges(label, "اعمار");
    expect(label.slice(r[0], r[1])).toBe("إعمار");
  });

  it("returns no range rather than a wrong one when it cannot locate the text", () => {
    // Ranking is deliberately more generous than the highlight: "astra co"
    // matches after noise removal, but those characters are not contiguous in
    // the original. Marking something arbitrary would be worse than marking
    // nothing.
    const out = suggest(["ASTRA CONSTRUCTION CO."], (x) => x, "astra co.");
    expect(out.length).toBe(1);
    expect(out[0].ranges).toEqual([]);
  });

  it("folds to the same length it was given", () => {
    for (const x of ["أإآٱىةـ", "ABC ١٢٣", "Nesma & Partners", ""]) {
      expect(foldForHighlight(x).length).toBe(x.length);
    }
  });
});

describe("what the list refuses to do", () => {
  it("says nothing until there are two characters to go on", () => {
    // One character matches almost everything, and a list that long is not a
    // suggestion, it is a second problem.
    expect(s("s")).toEqual([]);
    expect(s("")).toEqual([]);
  });

  it("keeps the list short", () => {
    const many = Array.from({ length: 50 }, (_, i) => `ALPHA PROJECT ${i}`);
    expect(suggest(many, (x) => x, "alpha").length).toBe(6);
  });

  it("does not reshuffle between keystrokes for invisible reasons", () => {
    // Equal-scoring names keep their original order, so the row under the
    // cursor does not move as the next character lands.
    const list = ["ALPHA ONE", "ALPHA TWO", "ALPHA THREE"];
    expect(suggest(list, (x) => x, "alpha").map((r) => r.label)).toEqual(list);
  });

  it("puts the exact name first, then prefixes, then the rest", () => {
    const list = ["MURABBA NORTH", "MURABBA", "THE MURABBA TOWER"];
    expect(suggest(list, (x) => x, "murabba").map((r) => r.label)).toEqual([
      "MURABBA", "MURABBA NORTH", "THE MURABBA TOWER",
    ]);
  });
});

describe("recognising a name already on file", () => {
  it("matches through noise and case", () => {
    expect(exactMatch(NAMES, (x) => x, "astra construction")).toBe("ASTRA CONSTRUCTION CO.");
    expect(exactMatch(NAMES, (x) => x, "unified")).toBe("UNIFIED");
  });

  it("returns nothing for a genuinely new name", () => {
    expect(exactMatch(NAMES, (x) => x, "BRAND NEW CONTRACTING")).toBeNull();
    expect(exactMatch(NAMES, (x) => x, "")).toBeNull();
  });
});
