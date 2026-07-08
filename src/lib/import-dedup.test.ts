// Data Import Center — duplicate detection. Run with `bun test src`.
import { test, expect } from "bun:test";
import {
  normalizeArabic,
  normalizeName,
  compareSignals,
  findWithinFileDuplicates,
  similarity,
  type DedupSignals,
} from "../../supabase/functions/_shared/import-dedup";

test("Arabic normalization unifies alef / taa-marbuta / diacritics / tatweel", () => {
  expect(normalizeArabic("شَرِكَة")).toBe("شركه");
  expect(normalizeArabic("أحمد")).toBe("احمد");
  expect(normalizeArabic("الرياضـــة")).toBe("الرياضه");
});

test("company-name normalization drops AR + EN stopwords", () => {
  expect(normalizeName("Al Rajhi Contracting Co. LLC")).toBe("al rajhi");
  // "شركة" -> normalized "شركه" is a stopword; the "لل" prefix is left as-is.
  expect(normalizeName("شركة الراجحي للمقاولات")).toBe("الراجحي للمقاولات");
});

test("CR number match is highest confidence + link suggestion", () => {
  const hit = compareSignals({ cr_number: "1010-1111" }, { cr_number: "10101111" });
  expect(hit?.reason_code).toBe("same_cr_number");
  expect(hit?.confidence).toBeGreaterThanOrEqual(0.95);
  expect(hit?.suggested_action).toBe("link_to_existing");
});

test("domain and email matches are detected with reason codes", () => {
  expect(compareSignals({ website_domain: "https://www.phc-sa.com/x" }, { website_domain: "phc-sa.com" })?.reason_code).toBe("same_website_domain");
  expect(compareSignals({ email: "A@Phc-sa.com" }, { email: "a@phc-sa.com" })?.reason_code).toBe("same_email");
});

test("fuzzy name similarity flags likely duplicates for review", () => {
  // Single-character typo in a multi-token name → high similarity, over threshold.
  const hit = compareSignals({ company_name: "Riyadh Metro Consultants" }, { company_name: "Riyad Metro Consultants" });
  expect(hit).not.toBeNull();
  expect(["same_normalized_name", "similar_company_name"]).toContain(hit!.reason_code);
  expect(hit!.suggested_action).toBe("needs_manual_review");
  expect(similarity("al rajhi", "al rajhi")).toBe(1);
  expect(similarity("al rajhi", "al rajih")).toBeGreaterThan(0.7);
});

test("distinct records produce no hit", () => {
  expect(compareSignals({ company_name: "Alpha", cr_number: "1" }, { company_name: "Beta", cr_number: "2" })).toBeNull();
});

test("within-file duplicates return earlier-row pairs with hits", () => {
  const rows: { id: string; signals: DedupSignals }[] = [
    { id: "r1", signals: { company_name: "PHC", cr_number: "555" } },
    { id: "r2", signals: { company_name: "Other", cr_number: "999" } },
    { id: "r3", signals: { company_name: "PHC Signs", cr_number: "555" } }, // dup of r1 by CR
  ];
  const dups = findWithinFileDuplicates(rows);
  expect(dups.length).toBe(1);
  expect(dups[0].rowId).toBe("r3");
  expect(dups[0].otherRowId).toBe("r1");
  expect(dups[0].hit.reason_code).toBe("same_cr_number");
});
