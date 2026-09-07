const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function legacyOpportunityContext(extraData: unknown) {
  const extra = object(extraData);
  const canonical =
    typeof extra?.canonical_opportunity_id === "string" && UUID.test(extra.canonical_opportunity_id)
      ? extra.canonical_opportunity_id
      : null;
  const sources = Object.entries(object(extra?.legacy_import_sources) ?? {}).flatMap(
    ([id, value]) => {
      const source = object(value);
      if (!UUID.test(id) || source?.source !== "PHC Quotation List 2022-2026") return [];
      return [
        {
          id,
          salesCode: typeof source.sales_code === "string" ? source.sales_code : "",
          note: typeof source.update_log === "string" ? source.update_log : "",
          subject: typeof source.email_subject === "string" ? source.email_subject : "",
        },
      ];
    },
  );
  return { canonical, sources };
}
