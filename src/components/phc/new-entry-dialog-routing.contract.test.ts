// Contract test for NewEntryDialog's type -> create-function routing —
// static source inspection (this repo has no React-rendering test harness;
// every existing test asserts source/behavior statically). The one thing
// worth pinning down here is that each Record Type branch calls the correct
// existing create* function and no other — a copy-paste mistake between
// branches would silently write the wrong record type. Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "NewEntryDialog.tsx"), "utf8");

function branchSource(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

test("imports every create* function it routes to, exactly once each", () => {
  for (const fn of ["createInboxItem", "createLead", "createRfq", "createQuotation", "createBoq"]) {
    const matches = source.match(new RegExp(`\\b${fn}\\b`, "g")) ?? [];
    // At least 2: the import statement and at least one call site.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  }
});

test('the "intake" branch calls createInboxItem, not any other create function', () => {
  const branch = branchSource('if (entryType === "intake")', '} else if (entryType === "lead")');
  expect(branch).toMatch(/await createInboxItem\(/);
  for (const other of ["createLead", "createRfq", "createQuotation", "createBoq"]) {
    expect(branch).not.toMatch(new RegExp(`await ${other}\\(`));
  }
});

test('the "lead" branch calls createLead, not any other create function', () => {
  const branch = branchSource('} else if (entryType === "lead")', '} else if (entryType === "rfq")');
  expect(branch).toMatch(/await createLead\(/);
  for (const other of ["createInboxItem", "createRfq", "createQuotation", "createBoq"]) {
    expect(branch).not.toMatch(new RegExp(`await ${other}\\(`));
  }
});

test('the "rfq" branch calls createRfq, not any other create function', () => {
  const branch = branchSource('} else if (entryType === "rfq")', '} else if (entryType === "quotation")');
  expect(branch).toMatch(/await createRfq\(/);
  for (const other of ["createInboxItem", "createLead", "createQuotation", "createBoq"]) {
    expect(branch).not.toMatch(new RegExp(`await ${other}\\(`));
  }
});

test('the "quotation" branch calls createQuotation, not any other create function', () => {
  const branch = branchSource('} else if (entryType === "quotation")', "} else {");
  expect(branch).toMatch(/await createQuotation\(/);
  for (const other of ["createInboxItem", "createLead", "createRfq", "createBoq"]) {
    expect(branch).not.toMatch(new RegExp(`await ${other}\\(`));
  }
});

test('the final "else" branch (boq) calls createBoq, not any other create function', () => {
  const elseIdx = source.indexOf('} else if (entryType === "quotation")');
  const boqBranchStart = source.indexOf("} else {", elseIdx);
  const boqBranchEnd = source.indexOf("onOpenChange(false);", boqBranchStart);
  const branch = source.slice(boqBranchStart, boqBranchEnd);
  expect(branch).toMatch(/await createBoq\(/);
  for (const other of ["createInboxItem", "createLead", "createRfq", "createQuotation"]) {
    expect(branch).not.toMatch(new RegExp(`await ${other}\\(`));
  }
});

test("quotation and boq field builders require an opportunityId (both are opportunity-scoped, unlike intake/lead/rfq)", () => {
  expect(source).toMatch(/function quotationFields[\s\S]*?key: "opportunityId"[\s\S]*?required: true/);
  expect(source).toMatch(/function boqFields[\s\S]*?key: "opportunityId"[\s\S]*?required: true/);
});
