import { describe, expect, it } from "bun:test";
import { approvalRoleLabel, approvalTypeLabel, isManagerDecision } from "@/lib/approval-labels";

describe("only real manager decisions are decisions (reported 2026-10-19)", () => {
  it("counts discounts, exceptions and award confirmations", () => {
    expect(isManagerDecision("bafo", "BAFO")).toBe(true);
    expect(isManagerDecision("record", "discount")).toBe(true);
    expect(isManagerDecision("record", "below_300k_exception")).toBe(true);
    expect(isManagerDecision("record", "TENDER_TO_JIH_APPROVAL")).toBe(true);
    expect(isManagerDecision("record", "WON_APPROVAL")).toBe(true);
  });

  it("leaves routine requests out", () => {
    for (const t of ["ai_recommendation", "management_review", "quotation", "discussion_review", "delete_request", "SURE_WIN_APPROVAL"]) {
      expect(isManagerDecision("record", t)).toBe(false);
    }
    expect(isManagerDecision("intake", "Intake review")).toBe(false);
  });
});

describe("approval names", () => {
  it("never shows a raw code", () => {
    expect(approvalTypeLabel("TENDER_TO_JIH_APPROVAL", "ar")).toBe("تحويل المناقصة إلى JIH");
    expect(approvalTypeLabel("TENDER_TO_JIH_APPROVAL", "en")).toBe("Convert tender to JIH");
    expect(approvalTypeLabel("BAFO", "en")).toBe("Final offer / discount (BAFO)");
  });

  it("falls back to readable text for an unknown type", () => {
    expect(approvalTypeLabel("SOMETHING_NEW", "en")).toBe("Something new");
    expect(approvalTypeLabel(null, "ar")).toBe("اعتماد");
  });

  it("names the role in words", () => {
    expect(approvalRoleLabel("executive / sales_manager", "ar")).toBe("المدير العام أو مدير المبيعات");
    expect(approvalRoleLabel("unknown_role", "en")).toBe("unknown_role");
  });
});
