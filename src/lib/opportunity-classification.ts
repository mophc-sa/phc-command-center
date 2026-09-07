/** Live RFQ classification takes precedence; archive provenance is a display fallback. */
export function opportunityClassification(rfqClassification: unknown, provenance: unknown): "jih" | "tender" | "other" | null {
  if (rfqClassification === "jih" || rfqClassification === "tender" || rfqClassification === "other") {
    return rfqClassification;
  }
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return null;
  const source = provenance as Record<string, unknown>;
  if (source.source !== "historical_promotion") return null;
  const route = typeof source.source_route === "string" ? source.source_route.toLowerCase() : null;
  return route === "jih" || route === "tender" ? route : null;
}
