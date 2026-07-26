// Duplicate Detection Engine. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  findDuplicateGroups,
  normalizeDomain,
  normalizePhone,
  type DupRecord,
} from "../../supabase/functions/_shared/duplicates";
import { normalizeCompanyName } from "../../supabase/functions/_shared/company-normalize";

test("normalizers strip noise", () => {
  expect(normalizeCompanyName("Al-Rajhi Contracting Co. LLC")).toBe("al rajhi");
  expect(normalizeDomain("https://www.phc-sa.com/about")).toBe("phc-sa.com");
  expect(normalizeDomain("sales@phc-sa.com")).toBe("phc-sa.com");
  expect(normalizePhone("+966 50 123 4567")).toBe("501234567");
});

test("detects duplicates by CR number with high confidence and explanation", () => {
  const recs: DupRecord[] = [
    { id: "a", name: "Alpha Contracting", cr_number: "1010-11111" },
    { id: "b", name: "ALPHA CONTRACTING CO", cr_number: "101011111" },
    { id: "c", name: "Beta Trading", cr_number: "2020" },
  ];
  const groups = findDuplicateGroups(recs, "company");
  expect(groups.length).toBe(1);
  expect(groups[0].members.map((m) => m.entity_id).sort()).toEqual(["a", "b"]);
  expect(groups[0].matched_fields).toContain("cr_number");
  expect(groups[0].confidence).toBeGreaterThanOrEqual(0.9);
  expect(groups[0].match_reason).toMatch(/cr_number|name/);
});

test("groups records transitively across shared domain/phone", () => {
  const recs: DupRecord[] = [
    { id: "a", name: "PHC", website_domain: "phc-sa.com" },
    { id: "b", name: "PHC Signs", website_domain: "www.phc-sa.com", phone: "0500000000" },
    { id: "c", name: "Different", phone: "+966 50 000 0000" },
  ];
  const groups = findDuplicateGroups(recs, "company");
  expect(groups.length).toBe(1);
  expect(groups[0].members.map((m) => m.entity_id).sort()).toEqual(["a", "b", "c"]);
});

test("distinct records produce no groups", () => {
  const recs: DupRecord[] = [
    { id: "a", name: "Alpha", cr_number: "1" },
    { id: "b", name: "Beta", cr_number: "2" },
  ];
  expect(findDuplicateGroups(recs)).toEqual([]);
});

test("name-only matches are flagged with lower confidence than CR matches", () => {
  const nameOnly = findDuplicateGroups([
    { id: "a", name: "Gamma Est" },
    { id: "b", name: "GAMMA establishment" },
  ]);
  expect(nameOnly.length).toBe(1);
  expect(nameOnly[0].confidence).toBeLessThan(0.9);
});

test("findDuplicateGroups now matches Arabic company names via shared normalization (previously missed)", () => {
  const recs: DupRecord[] = [
    { id: "a", name: "شركة الراجحي للمقاولات" }, // taa marbuta (ة)
    { id: "b", name: "شركه الراجحي للمقاولات" }, // already-normalized taa (ه) — a real-world data-entry variant
  ];
  const groups = findDuplicateGroups(recs, "company");
  expect(groups.length).toBe(1);
  expect(groups[0].matched_fields).toContain("name");
  expect(new Set(groups[0].members.map((m) => m.entity_id))).toEqual(new Set(["a", "b"]));
  // Confirms the specific normalization: both collapse to the same signal.
  expect(normalizeCompanyName(recs[0].name)).toBe("الراجحي للمقاولات");
  expect(normalizeCompanyName(recs[1].name)).toBe("الراجحي للمقاولات");
});
