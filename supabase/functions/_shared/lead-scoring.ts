// =============================================================================
// PHC Sales OS — Lead Scoring Engine (pure, real-data, unit-testable).
//
// Scores a lead 0..100 from the signals actually present on the record — no
// external model, no invented data. Every score returns the evidence it used,
// the reason codes, what information is missing, and the next best action, so
// the AI Evidence Panel can show WHY. Missing signals lower confidence rather
// than being guessed.
// =============================================================================

export const SIGNAGE_VALUE_THRESHOLD = 300000;

export type LeadInput = {
  id?: string;
  project_name?: string | null;
  main_contractor_guess?: string | null;
  project_stage_estimate?: string | null; // project_stage enum value
  signage_potential?: string | null; // high | medium | low
  estimated_value?: number | null;
  location?: string | null;
  source?: string | null;
};

export type LeadScoreEvidence = { label: string; field: string; value: string; weight: number };

export type LeadScoreResult = {
  score: number;
  band: "hot" | "warm" | "cool" | "cold";
  reason_codes: string[];
  evidence: LeadScoreEvidence[];
  missing_information: string[];
  next_best_action: string;
};

// Weights sum to 100.
const W = { signage: 30, stage: 20, value: 25, contractor: 15, completeness: 10 };

const STAGE_FIT: Record<string, number> = {
  tender: 1,
  awarded: 1,
  under_construction: 0.8,
  design_development: 0.6,
  early_planning: 0.4,
  near_handover: 0.3,
  unknown: 0.2,
  completed: 0,
};
const SIGNAGE_FIT: Record<string, number> = { high: 1, medium: 0.6, low: 0.3 };

function band(score: number): LeadScoreResult["band"] {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  if (score >= 30) return "cool";
  return "cold";
}

export function scoreLead(l: LeadInput): LeadScoreResult {
  const evidence: LeadScoreEvidence[] = [];
  const reason_codes: string[] = [];
  const missing: string[] = [];
  let score = 0;

  // 1. Signage package fit
  const sig = (l.signage_potential ?? "").toLowerCase();
  if (sig in SIGNAGE_FIT) {
    const pts = Math.round(W.signage * SIGNAGE_FIT[sig]);
    score += pts;
    evidence.push({ label: "Signage potential", field: "signage_potential", value: sig, weight: pts });
    reason_codes.push(sig === "high" ? "strong_signage_fit" : sig === "low" ? "weak_signage_fit" : "moderate_signage_fit");
  } else {
    missing.push("signage_potential");
    reason_codes.push("signage_fit_unknown");
  }

  // 2. Project stage fit
  const stage = (l.project_stage_estimate ?? "").toLowerCase();
  if (stage in STAGE_FIT) {
    const pts = Math.round(W.stage * STAGE_FIT[stage]);
    score += pts;
    evidence.push({ label: "Project stage", field: "project_stage_estimate", value: stage, weight: pts });
    if (STAGE_FIT[stage] >= 0.8) reason_codes.push("stage_in_signage_window");
    else if (STAGE_FIT[stage] <= 0.3) reason_codes.push("stage_outside_signage_window");
  } else {
    missing.push("project_stage_estimate");
    reason_codes.push("stage_unknown");
  }

  // 3. Estimated value vs 300k
  if (l.estimated_value != null && !Number.isNaN(l.estimated_value)) {
    const ratio = Math.min(1, l.estimated_value / SIGNAGE_VALUE_THRESHOLD);
    const pts = Math.round(W.value * ratio);
    score += pts;
    evidence.push({ label: "Estimated value", field: "estimated_value", value: String(l.estimated_value), weight: pts });
    reason_codes.push(l.estimated_value >= SIGNAGE_VALUE_THRESHOLD ? "value_above_threshold" : "value_below_threshold");
  } else {
    missing.push("estimated_value");
    reason_codes.push("value_unknown");
  }

  // 4. Main contractor clarity
  if (l.main_contractor_guess && String(l.main_contractor_guess).trim()) {
    score += W.contractor;
    evidence.push({ label: "Main contractor", field: "main_contractor_guess", value: String(l.main_contractor_guess), weight: W.contractor });
    reason_codes.push("contractor_identified");
  } else {
    missing.push("main_contractor_guess");
    reason_codes.push("contractor_unclear");
  }

  // 5. Data completeness (of the core fields)
  const core = [l.signage_potential, l.project_stage_estimate, l.estimated_value, l.main_contractor_guess, l.location];
  const present = core.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").length;
  const pts = Math.round((W.completeness * present) / core.length);
  score += pts;
  evidence.push({ label: "Data completeness", field: "_completeness", value: `${present}/${core.length}`, weight: pts });

  score = Math.max(0, Math.min(100, score));

  // Next best action: address the highest-impact gap first.
  let next = "Review and qualify the lead.";
  if (missing.includes("main_contractor_guess")) next = "Identify the main contractor before qualifying.";
  else if (missing.includes("signage_potential")) next = "Assess the signage package potential.";
  else if (missing.includes("estimated_value")) next = "Estimate the signage value.";
  else if (missing.includes("project_stage_estimate")) next = "Verify the project stage.";
  else if (score >= 75) next = "Escalate to BD for contact planning and outreach.";

  return { score, band: band(score), reason_codes, evidence, missing_information: missing, next_best_action: next };
}
