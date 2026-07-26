// Contract test for ActionDialog's creatable-select capability — static
// source inspection (this repo has no React-rendering test harness; every
// existing test asserts source/behavior statically). Run with `bun test src`.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ActionDialog.tsx"), "utf8");

test("DialogField's select variant declares optional onCreateNew and createLabel", () => {
  const selectStart = source.indexOf('type: "select";');
  const fileStart = source.indexOf('type: "file";');
  expect(selectStart).toBeGreaterThan(-1);
  expect(fileStart).toBeGreaterThan(selectStart);
  const selectVariant = source.slice(selectStart, fileStart);
  expect(selectVariant).toMatch(/onCreateNew\?: \(\) => Promise<\{ value: string; label: string \} \| null>/);
  expect(selectVariant).toMatch(/createLabel\?: string/);
});

test("select rendering handles the __create__ sentinel before the generic value-set branch", () => {
  const createBranchIdx = source.indexOf('if (v === "__create__")');
  const genericSetIdx = source.indexOf('setValues((prev) => ({ ...prev, [f.key]: v === "__none__" ? "" : v }));');
  expect(createBranchIdx).toBeGreaterThan(-1);
  expect(genericSetIdx).toBeGreaterThan(-1);
  expect(createBranchIdx).toBeLessThan(genericSetIdx);
});

test("the create-new SelectItem only renders when f.onCreateNew is present", () => {
  expect(source).toMatch(/\{f\.onCreateNew \? \(\s*<SelectItem value="__create__">/);
});

test("newly-created options are merged into the rendered option list via extraOptions state", () => {
  expect(source).toMatch(/const \[extraOptions, setExtraOptions\] = useState<Record<string, \{ value: string; label: string \}\[\]>>/);
  expect(source).toMatch(/\[\.\.\.f\.options, \.\.\.\(extraOptions\[f\.key\] \?\? \[\]\)\]\.map/);
});
