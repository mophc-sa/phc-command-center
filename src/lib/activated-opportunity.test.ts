import { describe, expect, test } from "bun:test";
import { isAssignableTeamMember } from "./team-members";
import { opportunityClassification } from "./opportunity-classification";

describe("new assignments preserve historical attribution", () => {
  test("only active human accounts can receive new work", () => {
    const directory = [
      { id: "active", status: "active" },
      { id: "suspended", status: "suspended" },
      { id: "pending", status: "pending_approval" },
      { id: "display", status: "active", is_display_account: true },
      { id: "unknown", status: null },
    ];
    expect(directory.filter(isAssignableTeamMember).map(m => m.id)).toEqual(["active"]);
    expect(directory.find(m => m.id === "suspended")).toBeDefined();
  });
});

describe("historical opportunity classification", () => {
  test("shows the stored JIH or tender route without requiring a new RFQ", () => {
    expect(opportunityClassification(null, { source: "historical_promotion", source_route: "JIH" })).toBe("jih");
    expect(opportunityClassification(null, { source: "historical_promotion", source_route: "TENDER" })).toBe("tender");
  });
  test("keeps a live RFQ decision authoritative", () => {
    expect(opportunityClassification("other", { source: "historical_promotion", source_route: "JIH" })).toBe("other");
  });
  test("does not infer a route from unrelated or absent metadata", () => {
    for (const metadata of [null, [], {}, { source_route: "JIH" }, { source: "historical_promotion", source_route: "unknown" }]) {
      expect(opportunityClassification(null, metadata)).toBeNull();
    }
  });
});
