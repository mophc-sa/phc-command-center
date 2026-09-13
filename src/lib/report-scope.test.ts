import { expect, test } from "bun:test";
import { inReportCohort } from "./report-scope";

test("report creation cohort includes both boundary days, not records outside them", () => {
  const scope = { owner: "all", from: "2026-09-01", to: "2026-09-30" };
  const dates = ["2026-08-31T23:59:59Z", "2026-09-01T00:00:00Z", "2026-09-30T23:59:59Z", "2026-10-01T00:00:00Z", null];
  expect(dates.filter(created_at => inReportCohort({ created_at }, scope))).toEqual(dates.slice(1, 3));
});
test("owner scope never includes unassigned or another owner's records", () => {
  const scope = { owner: "owner-a", from: "", to: "" };
  expect(["owner-a", "owner-b", null].filter(owner_id => inReportCohort({ owner_id }, scope))).toEqual(["owner-a"]);
});
test("unbounded reports retain undated records; inverted ranges match no records", () => {
  expect(inReportCohort({}, { owner: "all", from: "", to: "" })).toBe(true);
  expect(inReportCohort({ created_at: "2026-09-15" }, { owner: "all", from: "2026-09-30", to: "2026-09-01" })).toBe(false);
});
