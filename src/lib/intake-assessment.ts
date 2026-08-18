// Intake package assessment — what the reviewer needs to know at a glance.
//
// PRD 2026-08-12 §14 lists AI help at intake: missing-data check, JIH/Tender
// suggestion, duplicate detection, deadline extraction, and a concise
// qualification recommendation.
//
// Several of those are not AI problems. "Is there a deadline?" and "did a BOQ
// arrive?" are facts already on the record — answering them with a model would
// be slower, non-deterministic, and impossible to unit-test, for no gain. So
// the deterministic half lives here and runs instantly on every request.
//
// What genuinely needs the orchestrator is the half that reads unstructured
// input: extracting fields out of an emailed PDF, pulling a deadline from prose,
// and writing the qualification note. That needs a new ai-orchestrator agent
// AND an Edge Function deploy, which is gated — see the Phase 2 report.
//
// Nothing here decides anything. It reports; the reviewer decides.

export type IntakeRequestTypeLike = "jih" | "tender_contractor" | "tender_government" | "unknown" | null | undefined;

export type IntakeRecord = {
  request_type?: IntakeRequestTypeLike;
  project_name?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  main_contractor?: string | null;
  consultant?: string | null;
  owner_entity?: string | null;
  location?: string | null;
  location_city?: string | null;
  deadline?: string | null;
  scope?: string | null;
  scope_type?: string | null;
  client_rfq_reference?: string | null;
  has_boq?: boolean | null;
  has_drawings?: boolean | null;
  has_specs?: boolean | null;
  assigned_owner_id?: string | null;
};

export type MissingField = { key: string; blocking: boolean };

/**
 * Fields the PRD's minimum-intake list calls for.
 *
 * `blocking` marks the ones a reviewer cannot sensibly approve without — not
 * a hard stop (the reviewer may still approve; they own the judgement), but
 * the difference between "incomplete" and "not reviewable".
 */
export function missingIntakeFields(r: IntakeRecord): MissingField[] {
  const out: MissingField[] = [];
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

  if (blank(r.project_name)) out.push({ key: "project", blocking: true });
  if (blank(r.company_name)) out.push({ key: "client", blocking: true });
  if (!r.request_type || r.request_type === "unknown") out.push({ key: "request_type", blocking: true });
  if (blank(r.contact_name) && blank(r.email) && blank(r.phone)) out.push({ key: "contact", blocking: true });
  if (blank(r.deadline)) out.push({ key: "deadline", blocking: false });
  if (blank(r.location) && blank(r.location_city)) out.push({ key: "location", blocking: false });
  if (blank(r.scope) && blank(r.scope_type)) out.push({ key: "scope", blocking: false });
  if (blank(r.assigned_owner_id)) out.push({ key: "sales_owner", blocking: false });
  if (!r.has_boq) out.push({ key: "boq", blocking: false });
  if (!r.has_drawings) out.push({ key: "drawings", blocking: false });
  if (!r.has_specs) out.push({ key: "specs", blocking: false });

  // A tender against a government/owner needs the entity named; a JIH needs
  // the contractor. Asking for both on every request would be noise.
  if (r.request_type === "tender_government" && blank(r.owner_entity)) {
    out.push({ key: "owner_entity", blocking: true });
  }
  if (r.request_type === "jih" && blank(r.main_contractor)) {
    out.push({ key: "main_contractor", blocking: false });
  }
  return out;
}

/** 0-100. Weighted so a blocking gap costs more than a nice-to-have. */
export function packageCompleteness(r: IntakeRecord): number {
  const missing = missingIntakeFields(r);
  const cost = missing.reduce((sum, m) => sum + (m.blocking ? 3 : 1), 0);
  // 4 blocking (12) + 8 non-blocking (8) is the worst realistic case.
  const worst = 20;
  return Math.max(0, Math.round(100 - (cost / worst) * 100));
}

/**
 * Suggests a track from the shape of the request. A suggestion only — the
 * reviewer sets the type, and approval routes on the stored value, not this.
 */
export function suggestRequestType(r: IntakeRecord): {
  suggestion: "jih" | "tender_contractor" | "tender_government" | "unknown";
  because: string;
} {
  if (r.request_type && r.request_type !== "unknown") {
    return { suggestion: r.request_type, because: "stated_on_request" };
  }
  const hasOwnerEntity = !!r.owner_entity?.trim();
  const hasContractor = !!r.main_contractor?.trim();
  if (hasOwnerEntity && !hasContractor) {
    return { suggestion: "tender_government", because: "owner_entity_without_contractor" };
  }
  if (hasContractor && !hasOwnerEntity) {
    return { suggestion: "jih", because: "named_contractor" };
  }
  if (hasContractor && hasOwnerEntity) {
    return { suggestion: "tender_contractor", because: "contractor_and_owner_both_named" };
  }
  return { suggestion: "unknown", because: "insufficient_information" };
}

/** True when nothing blocking is missing — the reviewer can judge it on merits. */
export function isReviewable(r: IntakeRecord): boolean {
  return missingIntakeFields(r).every((m) => !m.blocking);
}
