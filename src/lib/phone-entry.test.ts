import { describe, expect, it } from "bun:test";
import { composePhone, isUsablePhone, localPart, SAUDI_PREFIX } from "@/lib/phone-entry";

describe("the +966 prefix is a default, not a cage", () => {
  it("prefixes a bare Saudi mobile", () => {
    expect(composePhone("552664264")).toBe("+966552664264");
  });

  it("drops the trunk zero, which does not survive a country code", () => {
    // 0552664264 -> +966552664264, not +9660552664264.
    expect(composePhone("0552664264")).toBe("+966552664264");
  });

  it("leaves a number that already carries its own country code alone", () => {
    // A rep pasting a UAE number must not have it turned into a Saudi one.
    expect(composePhone("+971501234567")).toBe("+971501234567");
    expect(composePhone("00971501234567")).toBe("+971501234567");
  });

  it("does not double the Saudi code when it is already there", () => {
    expect(composePhone("966552664264")).toBe("+966552664264");
    expect(composePhone("+966552664264")).toBe("+966552664264");
  });

  it("survives how people actually type", () => {
    for (const typed of ["055 266 4264", "055-266-4264", " 0552664264 ", "(055) 266 4264"]) {
      expect(composePhone(typed)).toBe("+966552664264");
    }
  });

  it("returns nothing for nothing", () => {
    expect(composePhone("")).toBe("");
    expect(composePhone("   ")).toBe("");
    expect(composePhone("abc")).toBe("");
  });
});

describe("what the user sees in the box", () => {
  it("hides the prefix it supplied", () => {
    expect(localPart("+966552664264")).toEqual({ text: "552664264", showsPrefix: true });
  });

  it("shows a foreign number whole, prefix and all", () => {
    // Hiding +971 behind a box labelled +966 would misreport the record.
    expect(localPart("+971501234567")).toEqual({ text: "+971501234567", showsPrefix: false });
  });

  it("starts empty with the prefix showing", () => {
    expect(localPart("")).toEqual({ text: "", showsPrefix: true });
  });

  it("round-trips: what is shown, recomposed, is what was stored", () => {
    for (const stored of ["+966552664264", "+971501234567"]) {
      const { text } = localPart(stored);
      expect(composePhone(text)).toBe(stored);
    }
  });
});

describe("validity is decided in one place", () => {
  it("agrees with the WhatsApp normaliser rather than having its own opinion", () => {
    expect(isUsablePhone(composePhone("0552664264"))).toBe(true);
    expect(isUsablePhone(composePhone("123"))).toBe(false);
  });

  it("treats the prefix alone as not a number", () => {
    expect(isUsablePhone(SAUDI_PREFIX)).toBe(false);
  });
});
