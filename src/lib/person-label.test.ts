// =============================================================================
// A person is named one way, everywhere.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { numberWithEnterer, personLabel, personName } from "@/lib/person-label";

describe("naming a person on a record", () => {
  it("prints the name and the code", () => {
    expect(personLabel({ full_name: "Marie Falome", sales_code: "MA" })).toBe("Marie Falome · MA");
  });

  it("prints the name alone when there is no code", () => {
    // A person without a code is shown by name, not by a placeholder that
    // looks like one. An invented code is worse than a missing code.
    expect(personLabel({ full_name: "Omar kallas" })).toBe("Omar kallas");
    expect(personLabel({ full_name: "Omar kallas", sales_code: "   " })).toBe("Omar kallas");
  });

  it("falls back to the email local part, never to a UUID", () => {
    expect(personName({ email: "a.jarrah@phc-sa.com" })).toBe("a.jarrah");
    expect(personLabel({ email: "a.jarrah@phc-sa.com", sales_code: "AB" })).toBe("a.jarrah · AB");
  });

  it("returns nothing for nobody", () => {
    // The caller decides what an absent person looks like -- a dash, a blank
    // cell, a hidden row. Returning "Unknown" here would make that choice for
    // every screen at once.
    expect(personLabel(null)).toBe("");
    expect(personLabel({})).toBe("");
    expect(personName(undefined)).toBe("");
  });

  it("shows a code alone if that is all there is", () => {
    expect(personLabel({ sales_code: "MO" })).toBe("MO");
  });

  it("treats whitespace as absence", () => {
    expect(personLabel({ full_name: "  ", email: "  " })).toBe("");
  });
});

describe("a number with the person who entered it", () => {
  it("puts the name beside the number", () => {
    expect(numberWithEnterer("PRJ-0007", { full_name: "Marie Falome", sales_code: "MA" }))
      .toBe("PRJ-0007 · Marie Falome · MA");
  });

  it("prints the number alone when nobody is recorded", () => {
    expect(numberWithEnterer("PRJ-0007", null)).toBe("PRJ-0007");
  });

  it("prints nothing when there is no number", () => {
    // A name on its own is not a reference. Returning it would put a person
    // where the reader expects a project number.
    expect(numberWithEnterer(null, { full_name: "Marie Falome", sales_code: "MA" })).toBe("");
    expect(numberWithEnterer("   ", { full_name: "Marie" })).toBe("");
  });
});
