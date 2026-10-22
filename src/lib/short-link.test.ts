import { describe, expect, it } from "bun:test";
import { dealLink, normaliseProjectCode, shortLinkPath } from "@/lib/short-link";

describe("reading a code from a link", () => {
  it("accepts every format the numbering has issued", () => {
    expect(normaliseProjectCode("FA-26-0001")).toBe("FA-26-0001");
    expect(normaliseProjectCode("RFQ-2026-0014")).toBe("RFQ-2026-0014");
    expect(normaliseProjectCode("26-0007")).toBe("26-0007");
  });

  it("forgives the way people type and paste", () => {
    expect(normaliseProjectCode(" fa-26-0001 ")).toBe("FA-26-0001");
    expect(normaliseProjectCode("FA%2D26%2D0001")).toBe("FA-26-0001");
  });

  it("refuses anything that cannot be a code, so it never reaches the database", () => {
    expect(normaliseProjectCode("")).toBeNull();
    expect(normaliseProjectCode(null)).toBeNull();
    expect(normaliseProjectCode("FA 26 0001")).toBeNull();
    expect(normaliseProjectCode("FA-26-0001,1=1")).toBeNull();
    expect(normaliseProjectCode("-FA-26")).toBeNull();
    expect(normaliseProjectCode("FA-26-")).toBeNull();
    expect(normaliseProjectCode("%")).toBeNull();
    expect(normaliseProjectCode("A".repeat(41))).toBeNull();
  });
});

describe("the link to copy", () => {
  it("is short when the deal has a code", () => {
    expect(shortLinkPath("FA-26-0001")).toBe("/p/FA-26-0001");
    expect(dealLink("https://agent.phc-sa.com/", "0b1c", "fa-26-0001")).toBe("https://agent.phc-sa.com/p/FA-26-0001");
  });

  it("falls back to the full address when it has none", () => {
    expect(dealLink("https://agent.phc-sa.com", "0b1c", null)).toBe("https://agent.phc-sa.com/opportunities/0b1c");
    expect(dealLink("https://agent.phc-sa.com", "0b1c", "not a code")).toBe("https://agent.phc-sa.com/opportunities/0b1c");
  });
});
