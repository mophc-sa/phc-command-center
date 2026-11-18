import { describe, expect, it } from "bun:test";
import { parseContact, parseMasterList, planImport, sheetDate, targetStage, type ExistingDeal, type MlRow } from "./master-list-import";

const HEADER = ["PRIORITY", "Project Code", "Project Name", "Updated Amount", "Status", "Next Action Date", "JIH/TENDER", "RFQ Contact", "Main Client", "Location", "Last Update", "Remarks"];
let n = 0;
const deal = (p: Partial<ExistingDeal>): ExistingDeal => ({
  id: `d${++n}`, stage: "quotation", sales_stage: "jih", quotation_value: null, contract_value: null, project_name: "P",
  code: null, created_at: "2026-01-01", has_master_list: true, duplicate_of: null, value_counted_on: null, owner_id: "u", last_activity_at: null, ...p,
});
const row = (p: Partial<MlRow>): MlRow => ({ row_no: ++n, status: "SUBMITTED", ...p });

describe("master list import", () => {
  it("reads the sheet by its header and drops blank rows", () => {
    const rows = parseMasterList([["title"], HEADER, ["NEED FOLLOW-UP", " fa25106-b ", "Tower", 100, "SUBMITTED", "2026-11-18T21:00:00.000Z"], [null, null, null], []]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "FA25106-B", amount: 100, priority: "NEED FOLLOW-UP", next_action_date: "2026-11-19" });
  });

  it("dates follow the Riyadh calendar", () => {
    expect(sheetDate("2026-11-18T21:00:00.000Z")).toBe("2026-11-19");
    expect(sheetDate(46000)).toBe("2025-12-09");
    expect(sheetDate("not a date")).toBeUndefined();
  });

  it("maps columns A and E to a stage, and never guesses an unknown status", () => {
    expect(targetStage(row({ status: "Submitted - Discount" }))).toBe("jih_bafo");
    expect(targetStage(row({ status: "Verbally Awarded" }))).toBe("verbally_awarded");
    expect(targetStage(row({ priority: "ON-HOLD", status: "SUBMITTED" }))).toBe("on_hold");
    expect(targetStage(row({ priority: "DEAD PROJECT", status: "SUBMITTED" }))).toBe("lost");
    expect(targetStage(row({ status: "Pending something" }))).toBeNull();
  });

  it("one tender = number + value; each contractor is its own record, value counted once", () => {
    const existing = deal({ code: "OM25106", quotation_value: 1000 });
    const plan = planImport(
      [
        row({ code: "OM25106", amount: 1000, rfq_contact: "FIRST GROUP | A" }),
        row({ code: "FA25106-B", amount: 1000, rfq_contact: "MBL | B" }),
        row({ code: "FA25106-B", amount: 1000, rfq_contact: "MBL | B" }), // a revision to the same contractor
        row({ code: "FA25106", amount: 2000, rfq_contact: "ACC | C" }), // same number, other value: another tender
      ],
      [existing],
      {},
    );
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ kind: "update", dealId: existing.id, countedOn: null });
    expect(plan[1]).toMatchObject({ kind: "create", countedOn: existing.id });
    expect(plan[1].rowNos).toHaveLength(2);
    expect(plan[1].changes.quotation_value).toBeNull();
    // Same number, other value, while a deal with that number exists: a person decides.
    expect(plan[2]).toMatchObject({ kind: "conflict", countedOn: null, apply: false });
  });

  it("a won deal the file shows open is a conflict, kept by default", () => {
    const won = deal({ code: "AH26085", quotation_value: 500, sales_stage: "won", stage: "won" });
    const [p] = planImport([row({ code: "AH26085", amount: 500, status: "Submitted - Original" })], [won], {});
    expect(p).toMatchObject({ kind: "conflict", apply: false });
  });

  it("restores a deal archived as a duplicate of a different value", () => {
    const kept = deal({ code: "OM24130-1-RV.01", quotation_value: 15000, sales_stage: "won", stage: "won" });
    const arch = deal({ code: "OM24130-1-RV.01", quotation_value: 109250, stage: "archived", duplicate_of: kept.id });
    const [p] = planImport([row({ code: "OM24130-1-RV.01", amount: 109250, status: "Submitted - Revised" })], [kept, arch], {});
    expect(p).toMatchObject({ kind: "restore", dealId: arch.id });
  });

  it("does not move an open deal backwards", () => {
    const d = deal({ code: "FA26001", quotation_value: 10, sales_stage: "verbally_awarded" });
    const [p] = planImport([row({ code: "FA26001", amount: 10, status: "SUBMITTED" })], [d], {});
    expect(p.changes.sales_stage).toBeUndefined();
  });

  it("a code without a number joins the tender with the same project and value", () => {
    const d = deal({ code: "FA25106", quotation_value: 2313000, project_name: "IMC Obhur Hospital" });
    const plan = planImport(
      [row({ code: "FA25106", amount: 2313000, project: "IMC Obhur Hospital", rfq_contact: "ACC | A" }),
       row({ code: "OM", amount: 2313000, project: "IMC Obhur Hospital ", rfq_contact: "ROAD TECHNOLOGY | B" })],
      [d], {});
    expect(plan.map((p) => p.countedOn)).toEqual([null, d.id]);
  });

  it("reads a contact block", () => {
    expect(parseContact("SAUDI BINLADEN GROUP SBG | Adel Mahmoud | Procurement | Mobile: 05563203668")).toMatchObject({
      company: "SAUDI BINLADEN GROUP SBG", name: "Adel Mahmoud", title: "Procurement",
    });
    expect(parseContact("SAC CONTRACTING\nAHMED SHAQRAN\nTENDERING MANAGER\nM 0549142944")?.company).toBe("SAC CONTRACTING");
  });
});
