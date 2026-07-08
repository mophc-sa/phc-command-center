// =============================================================================
// PHC Sales OS — RFQ/Tender -> JIH conversion rules (pure, unit-testable).
//
// A conversion is only allowed when every PHC gate passes AND the estimated
// signage value clears the 300k SAR threshold. If everything else passes but
// the value is below the threshold, conversion is not blocked outright — it
// requires an executive (Mr. Omar) exception approval instead.
//
// No I/O here: the sales-os-api handler collects the review, calls this, and
// enforces the decision server-side (see src/lib/conversion.rules.test.ts).
// =============================================================================

export const SIGNAGE_VALUE_THRESHOLD = 300000;

// Signage package statuses considered "open / suitable" for conversion.
const SUITABLE_PACKAGE_STATUSES = ["confirmed", "likely", "open", "active", "suitable"];
// Confidence levels considered acceptable.
const ACCEPTABLE_CONFIDENCE = ["high", "medium"];

export type ConversionReview = {
  project_stage_suitable: boolean;
  package_not_closed: boolean;
  estimated_signage_value: number | null;
  contact_plan_ready: boolean;
  main_contractor_confirmed: boolean;
  signage_package_status: string | null;
  signage_package_confidence: string | null;
  conversion_reason: string | null;
};

export type ConversionReasonCode =
  | "project_stage_not_suitable"
  | "package_closed"
  | "contact_plan_missing"
  | "main_contractor_not_confirmed"
  | "signage_package_not_suitable"
  | "signage_confidence_low"
  | "conversion_reason_missing"
  | "signage_value_missing";

export type ConversionDecision = {
  ok: boolean; // all gates pass AND value >= threshold — safe to convert
  blocked: ConversionReasonCode[]; // hard blocks (never auto-convert)
  requiresException: boolean; // gates pass but value < threshold
};

function isBlank(s: string | null | undefined): boolean {
  return !s || !String(s).trim();
}

export function evaluateConversion(r: ConversionReview): ConversionDecision {
  const blocked: ConversionReasonCode[] = [];

  if (!r.project_stage_suitable) blocked.push("project_stage_not_suitable");
  if (!r.package_not_closed) blocked.push("package_closed");
  if (!r.contact_plan_ready) blocked.push("contact_plan_missing");
  if (!r.main_contractor_confirmed) blocked.push("main_contractor_not_confirmed");
  if (isBlank(r.signage_package_status) || !SUITABLE_PACKAGE_STATUSES.includes(r.signage_package_status!)) {
    blocked.push("signage_package_not_suitable");
  }
  if (isBlank(r.signage_package_confidence) || !ACCEPTABLE_CONFIDENCE.includes(r.signage_package_confidence!)) {
    blocked.push("signage_confidence_low");
  }
  if (isBlank(r.conversion_reason)) blocked.push("conversion_reason_missing");

  const value = r.estimated_signage_value;
  const valueMissing = value === null || value === undefined || Number.isNaN(value);
  if (valueMissing) blocked.push("signage_value_missing");

  // Any hard block (including a missing value) stops the conversion outright.
  if (blocked.length > 0) return { ok: false, blocked, requiresException: false };

  // All gates pass — decide on the value threshold.
  if ((value as number) >= SIGNAGE_VALUE_THRESHOLD) {
    return { ok: true, blocked: [], requiresException: false };
  }
  return { ok: false, blocked: [], requiresException: true };
}

// Build a ConversionReview from a stored tender/rfq row + an optional review
// override payload (the UI answers). Explicit review values win; otherwise fall
// back to persisted columns. `mainContractorPresent` lets the caller feed the
// main_contractor_id presence signal.
export function reviewFromRecord(
  rec: Record<string, unknown>,
  override: Record<string, unknown> = {},
  mainContractorPresent = false,
): ConversionReview {
  const bool = (k: string, fallback = false): boolean => {
    const o = override[k];
    if (o !== undefined) return o === true || o === "true" || o === "yes";
    return rec[k] === true ? true : fallback;
  };
  const num = (k: string): number | null => {
    const o = override[k] ?? rec[k];
    if (o === null || o === undefined || o === "") return null;
    const n = Number(o);
    return Number.isNaN(n) ? null : n;
  };
  const str = (k: string): string | null => {
    const o = override[k] ?? rec[k];
    return o == null || o === "" ? null : String(o);
  };

  return {
    project_stage_suitable: bool("project_stage_suitable"),
    package_not_closed: bool("package_not_closed"),
    estimated_signage_value: num("estimated_signage_value"),
    contact_plan_ready: bool("contact_plan_ready"),
    main_contractor_confirmed: bool("main_contractor_confirmed", mainContractorPresent),
    signage_package_status: str("signage_package_status"),
    signage_package_confidence: str("signage_package_confidence"),
    conversion_reason: str("conversion_reason"),
  };
}
