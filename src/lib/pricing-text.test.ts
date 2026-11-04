import { describe, expect, it } from "bun:test";
import { asError, dbMessage, pick } from "@/lib/pricing-text";

describe("pick", () => {
  it("returns the reader's language", () => {
    expect(pick({ en: "Freeze", ar: "تجميد" }, "en")).toBe("Freeze");
    expect(pick({ en: "Freeze", ar: "تجميد" }, "ar")).toBe("تجميد");
  });
});

describe("dbMessage shows the reader's half of a bilingual database error", () => {
  const e = { message: "Only the GM sets the margin. | الهامش يضعه المدير العام.", code: "42501" };
  it("English half", () => expect(dbMessage(e, "en")).toBe("Only the GM sets the margin."));
  it("Arabic half", () => expect(dbMessage(e, "ar")).toBe("الهامش يضعه المدير العام."));
  it("a one-language message is shown as it is", () => {
    expect(dbMessage(new Error("Network down"), "ar")).toBe("Network down");
  });
  it("anything else becomes text", () => expect(dbMessage("boom", "en")).toBe("boom"));
  it("asError wraps it for ActionDialog", () => {
    expect(asError(e, "en")).toBeInstanceOf(Error);
    expect(asError(e, "en").message).toBe("Only the GM sets the margin.");
  });
});
