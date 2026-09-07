import { describe, expect, test } from "bun:test";
import { legacyOpportunityContext } from "./legacy-opportunity-context";
import { opportunityClassification } from "./opportunity-classification";
const id = "b1453865-79dc-4c02-a5a3-0980918037b6";
describe("legacy opportunity context", () => {
  test("only valid record links and known import provenance are rendered", () => {
    expect(
      legacyOpportunityContext({
        canonical_opportunity_id: "javascript:alert(1)",
        legacy_import_sources: { bad: {}, [id]: { source: "other" } },
      }),
    ).toEqual({ canonical: null, sources: [] });
    expect(legacyOpportunityContext([])).toEqual({ canonical: null, sources: [] });
  });
  test("preserves original notes as text and links both directions", () => {
    const source = {
      source: "PHC Quotation List 2022-2026",
      update_log: "<script>text</script>\nFollow up",
      email_subject: "Original subject",
      sales_code: "OM26006",
    };
    const result = legacyOpportunityContext({
      canonical_opportunity_id: id,
      legacy_import_sources: { [id]: source },
    });
    expect(result.canonical).toBe(id);
    expect(result.sources).toEqual([
      { id, salesCode: "OM26006", note: source.update_log, subject: source.email_subject },
    ]);
  });
  test("legacy classification is a known provenance fallback only", () => {
    expect(
      opportunityClassification(null, {
        source: "PHC Quotation List 2022-2026",
        jih_tender: "JIH",
      }),
    ).toBe("jih");
    expect(
      opportunityClassification("tender", {
        source: "PHC Quotation List 2022-2026",
        jih_tender: "JIH",
      }),
    ).toBe("tender");
    expect(opportunityClassification(null, { source: "other", jih_tender: "JIH" })).toBeNull();
  });
});
