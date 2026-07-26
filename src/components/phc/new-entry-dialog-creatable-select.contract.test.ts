// Contract test for NewEntryDialog's creatable-select capability. Unlike the
// other "New X" forms, NewEntryDialog does not render through ActionDialog
// (its field set must react live to the Record Type selector), so it needed
// its own onCreateNew wiring — added to fix the RFQ type's missing "add new
// company"/"add new project" options. Static source inspection (this repo
// has no React-rendering test harness). Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "NewEntryDialog.tsx"), "utf8");

test("rfqFields wires onCreateNew for both companyId and projectId", () => {
  const rfqFieldsStart = source.indexOf("function rfqFields(");
  const rfqFieldsEnd = source.indexOf("\n}", rfqFieldsStart);
  const body = source.slice(rfqFieldsStart, rfqFieldsEnd);
  expect(body).toMatch(/key: "companyId"[\s\S]*?onCreateNew: \(\) => new Promise\(\(resolve\) => setCreatingCompanyFor\(\(\) => resolve\)\)/);
  expect(body).toMatch(/key: "projectId"[\s\S]*?onCreateNew: \(\) => new Promise\(\(resolve\) => setCreatingProjectFor\(\(\) => resolve\)\)/);
});

test("select rendering handles the __create__ sentinel and merges extraOptions", () => {
  expect(source).toMatch(/if \(v === "__create__"\)/);
  expect(source).toMatch(/const \[extraOptions, setExtraOptions\] = useState<Record<string, \{ value: string; label: string \}\[\]>>/);
  expect(source).toMatch(/\[\.\.\.f\.options, \.\.\.\(extraOptions\[f\.key\] \?\? \[\]\)\]\.map/);
});

test("extraOptions resets whenever the dialog reopens or the record type changes", () => {
  const effectStart = source.indexOf("useEffect(() => {\n    if (!open) return;");
  const effectEnd = source.indexOf("}, [open, entryType]);");
  const body = source.slice(effectStart, effectEnd);
  expect(body).toMatch(/setExtraOptions\(\{\}\)/);
});

test("nested create-company and create-project dialogs resolve the picker's promise instead of leaving it pending on error", () => {
  expect(source).toMatch(/creatingCompanyFor\?\.\(\{ value: company\.id, label: company\.name \}\)/);
  expect(source).toMatch(/creatingProjectFor\?\.\(\{ value: project\.id, label: project\.name \}\)/);
  // Both success and catch branches must resolve (not just success), or the
  // select stays disabled forever if createCompany/createProject throws.
  const companyDialogStart = source.indexOf('title={t("wf_add_new_company")}');
  const companyDialogEnd = source.indexOf("/>", companyDialogStart);
  const companyDialogBody = source.slice(companyDialogStart, companyDialogEnd);
  expect(companyDialogBody.match(/creatingCompanyFor\?\.\(/g)?.length).toBe(2);
});
