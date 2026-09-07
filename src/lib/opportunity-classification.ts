/** Live RFQ classification takes precedence; archive provenance is a display fallback. */
export function opportunityClassification(
  rfqClassification: unknown,
  provenance: unknown,
): "jih" | "tender" | "other" | null {
  if (
    rfqClassification === "jih" ||
    rfqClassification === "tender" ||
    rfqClassification === "other"
  ) {
    return rfqClassification;
  }
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return null;
  const source = provenance as Record<string, unknown>;
  const rawRoute =
    source.source === "historical_promotion"
      ? source.source_route
      : source.source === "PHC Quotation List 2022-2026"
        ? source.jih_tender
        : null;
  const route = typeof rawRoute === "string" ? rawRoute.toLowerCase() : null;
  return route === "jih" || route === "tender" ? route : null;
}
