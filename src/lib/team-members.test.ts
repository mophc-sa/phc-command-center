import { describe, expect, test } from "bun:test";
import { isAssignableTeamMember } from "./team-members";

describe("isAssignableTeamMember", () => {
  test("an active staff account is assignable", () => {
    expect(isAssignableTeamMember({ status: "active", is_display_account: false, vendor_id: null })).toBe(true);
    expect(isAssignableTeamMember({ status: "active" })).toBe(true);
  });

  test("a supplier account (vendor_id set) is never assignable", () => {
    expect(isAssignableTeamMember({ status: "active", is_display_account: false, vendor_id: "v-1" })).toBe(false);
  });

  test("inactive and display accounts are not assignable", () => {
    expect(isAssignableTeamMember({ status: "suspended", vendor_id: null })).toBe(false);
    expect(isAssignableTeamMember({ status: "active", is_display_account: true })).toBe(false);
  });
});
