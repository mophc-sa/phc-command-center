// Autofill shown in blue with a confirm tick (manager feedback group 4).
// Run with: bun test src/lib/suggested-fields.test.ts
import { test, expect, describe } from "bun:test";
import { applySuggestions, pendingSuggestions } from "./suggested-fields";

describe("applySuggestions", () => {
  test("fills only empty fields and marks them suggested", () => {
    const r = applySuggestions(
      { companyName: "Al Bawani", contactName: "", phone: "+966500000000" },
      new Set(),
      new Set(),
      { contactName: "Omar", phone: "+966511111111" },
    );
    expect(r.values).toEqual({ companyName: "Al Bawani", contactName: "Omar", phone: "+966500000000" });
    expect([...r.suggested]).toEqual(["contactName"]);
  });

  test("never refills a field the user has touched, even if they cleared it", () => {
    const r = applySuggestions({ contactName: "" }, new Set(), new Set(["contactName"]), { contactName: "Omar" });
    expect(r.values.contactName).toBe("");
    expect(r.suggested.size).toBe(0);
  });

  test("ignores empty proposals", () => {
    const r = applySuggestions({ email: "" }, new Set(), new Set(), { email: "  " });
    expect(r.values.email).toBe("");
    expect(r.suggested.size).toBe(0);
  });

  test("returns the same objects when nothing changes", () => {
    const values = { a: "x" };
    const suggested = new Set<string>();
    const r = applySuggestions(values, suggested, new Set(), { a: "y" });
    expect(r.values).toBe(values);
    expect(r.suggested).toBe(suggested);
  });

  test("keeps earlier suggestions", () => {
    const r = applySuggestions({ a: "1", b: "" }, new Set(["a"]), new Set(), { b: "2" });
    expect([...r.suggested].sort()).toEqual(["a", "b"]);
  });
});

describe("pendingSuggestions", () => {
  test("only counts fields on screen", () => {
    expect(pendingSuggestions(new Set(["a", "b"]), ["b", "c"])).toEqual(["b"]);
  });
});
