import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { read, utils } from "./spreadsheet.ts";
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import { write, version } from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
Deno.test("Pinned spreadsheet parser round-trips Arabic and multiline cells", () => {
  assertEquals(version, "0.20.3");
  const source = [["name", "notes"], ["شركة الاختبار", "line one\nline two"]];
  const wb = utils.book_new(); utils.book_append_sheet(wb, utils.aoa_to_sheet(source), "Data");
  const parsed = read(write(wb, { type: "array", bookType: "xlsx" }), { type: "array" });
  assertEquals(utils.sheet_to_json(parsed.Sheets.Data, { header: 1 }), source);
});
