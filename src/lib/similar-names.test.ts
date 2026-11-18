import { expect, test } from "bun:test";
import { similarNames } from "./similar-names";

test("finds likely duplicates despite suffixes and spelling", () => {
  const names = ["Al Saad General Contracting", "MBL Contracting", "Saudi Binladen Group", "TGCC"];
  expect(similarNames("AL SAAD CONTRACTING", names)).toContain("Al Saad General Contracting");
  expect(similarNames("Saudi Bin Laden Group", names)).toContain("Saudi Binladen Group");
  expect(similarNames("Riyadh Metro", names)).toEqual([]);
  expect(similarNames("ab", names)).toEqual([]);
});
