import { describe, expect, it } from "bun:test";
import { countReferences } from "@/lib/reference-hint";

const CLIENTS = [
  "SAUDI BINLADEN GROUP SBG",
  "Saudi Binladen Group",       // the same client, written differently
  "ASTRA CONSTRUCTION CO.",
  "شركة الفنار للمقاولات",
];

describe("past PHC work for the company being entered", () => {
  it("counts every project, not every distinct spelling", () => {
    // The library holds "SAUDI BINLADEN GROUP SBG" and someone types "Saudi
    // Binladen Group". `rankKey` drops "group" as noise but keeps "SBG", so
    // exact equality would have called these two different clients and
    // reported one project where there are two.
    expect(countReferences(CLIENTS, "saudi binladen group")).toBe(2);
    expect(countReferences(CLIENTS, "SAUDI BINLADEN GROUP SBG")).toBe(2);
  });

  it("does not merge two companies that share one word", () => {
    // "ASTRA" alone is a brand prefix, not an identity. This line asserts a
    // fact, so a false positive tells someone we have history we do not have.
    const two = ["ASTRA CONSTRUCTION CO.", "ASTRA HOLDING"];
    expect(countReferences(two, "Astra Construction")).toBe(1);
    expect(countReferences(two, "Astra Holding")).toBe(1);
  });

  it("recognises the same company through corporate noise", () => {
    // The reference row says "CO.", the rep types it without. One company.
    expect(countReferences(CLIENTS, "Astra Construction")).toBe(1);
  });

  it("matches Arabic the way the suggestion list does", () => {
    expect(countReferences(CLIENTS, "شركه الفنار للمقاولات")).toBe(1);
  });

  it("says nothing for a client with no history", () => {
    expect(countReferences(CLIENTS, "BRAND NEW CONTRACTING")).toBe(0);
  });

  it("stays quiet while somebody is still typing", () => {
    // A hint that fires on "a" is noise under a field in mid-word.
    expect(countReferences(CLIENTS, "a")).toBe(0);
    expect(countReferences(CLIENTS, "as")).toBe(0);
    expect(countReferences(CLIENTS, "")).toBe(0);
  });

  it("does not fire on a partial name", () => {
    // "astra" is enough for the SUGGESTION list, which offers a choice. This
    // line asserts a fact, so it waits for the whole name.
    expect(countReferences(CLIENTS, "astra")).toBe(0);
  });
});
