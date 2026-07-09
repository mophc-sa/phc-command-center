// =============================================================================
// PHC Sales OS — Opportunity Scoring Engine (pure, real-data, unit-testable).
//
// Mirrors the shape of supabase/functions/_shared/lead-scoring.ts: scores an
// opportunity 0..100 from signals already present on the record — no
// external model, no invented data. Missing signals lower confidence and are
// listed explicitly rather than guessed. Every result carries the evidence
// used, human-readable reason codes, risk flags (drawn from the existing
// public.risk_flag vocabulary so they can feed opportunity_flags directly),
// and a single highest-impact recommended next action.
//
// Tier is A/B/C/Not Qualified — a scoring-model output distinct from the
// existing opportunities.tier (public.priority_tier), which stays a
// separate, manually-set field. See the migration comment for why.
//
// Sure Win stays a forecast flag (win_confidence), never a stage: this
// engine only *suggests* a win_confidence value as part of its output; it
// never writes win_confidence itself (that remains the existing
// setWinConfidence action, a deliberate human decision).
// =============================================================================

export const OPPORTUNITY_VALUE_THRESHOLD = 300000;

export type OpportunityScoreInput = {
  project_stage?: string | null;
  signage_package_status?: string | null;
  signage_package_confidence?: string | null; // confidence_level: high | medium | low
  main_contractor_confirmed?: boolean | null;
  contractor_decision_maker?: string | null;
  next_action_due?: string | null; // date
  expected_contract_date?: string | null; // date
  estimated_value_max?: number | null;
  estimated_value_min?: number | null;
  quotation_value?: number | null;
  evidence_count?: number | null;
};

export type ScoreEvidence = { label: string; field: string; value: string; weight: number; max: number };

export type OpportunityScoreTier = "A" | "B" | "C" | "not_qualified";
export type SuggestedWinConfidence = "low" | "possible" | "strong" | "sure_win";

export type OpportunityScoreResult = {
  score: number; // 0..100
  tier: OpportunityScoreTier;
  confidence: "high" | "medium" | "low";
  evidence: ScoreEvidence[];
  reasons: string[];
  missing_data: string[];
  risk_flags: string[]; // subset of public.risk_flag values where applicable
  recommended_next_action: string;
  suggested_win_confidence: SuggestedWinConfidence;
};

// Category weights — sum to 100, matching the Sprint 4 spec exactly.
const W = { projectFit: 25, packageStatus: 20, buyerAccess: 20, timing: 15, valuePotential: 10, evidence: 10 };

const STAGE_FIT: Record<string, number> = {
  tender: 1,
  awarded: 1,
  under_construction: 0.85,
  design_development: 0.6,
  early_planning: 0.4,
  near_handover: 0.3,
  unknown: 0.15,
  completed: 0,
};

const PACKAGE_FIT: Record<string, number> = {
  confirmed: 1,
  likely: 0.6,
  unknown: 0.25,
  not_applicable: 0,
  no_package_identified: 0,
};

const CONFIDENCE_MULT: Record<string, number> = { high: 1, medium: 0.75, low: 0.5 };

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.round((dt.getTime() - Date.now()) / 86400000);
}

function tierOf(score: number): OpportunityScoreTier {
  if (score >= 75) return "A";
  if (score >= 50) return "B";
  if (score >= 30) return "C";
  return "not_qualified";
}

export function scoreOpportunity(o: OpportunityScoreInput): OpportunityScoreResult {
  const evidence: ScoreEvidence[] = [];
  const reasons: string[] = [];
  const missing: string[] = [];
  const risk_flags: string[] = [];
  let score = 0;
  let categoriesWithData = 0;
  const totalCategories = 6;

  // 1. Project Fit (25) — is the project's construction stage inside the
  // window where a signage package is typically decided/buyable.
  const stage = (o.project_stage ?? "").toLowerCase();
  if (stage && stage in STAGE_FIT) {
    const pts = Math.round(W.projectFit * STAGE_FIT[stage]);
    score += pts;
    categoriesWithData++;
    evidence.push({ label: "Project stage", field: "project_stage", value: stage, weight: pts, max: W.projectFit });
    reasons.push(STAGE_FIT[stage] >= 0.6 ? "project_stage_in_window" : STAGE_FIT[stage] <= 0.2 ? "project_stage_outside_window" : "project_stage_moderate_fit");
    if (stage === "unknown") risk_flags.push("project_stage_unverified");
  } else {
    missing.push("project_stage");
    reasons.push("project_stage_unknown");
    risk_flags.push("project_stage_unverified");
  }

  // 2. Package Status (20) — signage package status, discounted by how
  // confident that status is.
  const pkgStatus = (o.signage_package_status ?? "").toLowerCase();
  if (pkgStatus && pkgStatus in PACKAGE_FIT) {
    const conf = (o.signage_package_confidence ?? "").toLowerCase();
    const mult = CONFIDENCE_MULT[conf] ?? 0.75;
    const pts = Math.round(W.packageStatus * PACKAGE_FIT[pkgStatus] * mult);
    score += pts;
    categoriesWithData++;
    evidence.push({ label: "Signage package status", field: "signage_package_status", value: pkgStatus, weight: pts, max: W.packageStatus });
    reasons.push(PACKAGE_FIT[pkgStatus] >= 0.6 ? "package_confirmed_or_likely" : "package_status_weak");
    if (pkgStatus === "no_package_identified" || pkgStatus === "not_applicable") risk_flags.push("package_may_be_closed");
    if (!conf) missing.push("signage_package_confidence");
  } else {
    missing.push("signage_package_status");
    reasons.push("package_status_unknown");
    risk_flags.push("package_may_be_closed");
  }

  // 3. Buyer Access (20) — can we actually reach the person who decides.
  const hasContractor = !!o.main_contractor_confirmed;
  const hasDecisionMaker = !!(o.contractor_decision_maker && String(o.contractor_decision_maker).trim());
  if (hasContractor && hasDecisionMaker) {
    score += W.buyerAccess;
    categoriesWithData++;
    evidence.push({ label: "Buyer access", field: "contractor_decision_maker", value: String(o.contractor_decision_maker), weight: W.buyerAccess, max: W.buyerAccess });
    reasons.push("buyer_access_confirmed");
  } else if (hasContractor || hasDecisionMaker) {
    const pts = Math.round(W.buyerAccess * 0.55);
    score += pts;
    categoriesWithData++;
    evidence.push({ label: "Buyer access", field: hasContractor ? "main_contractor_confirmed" : "contractor_decision_maker", value: "partial", weight: pts, max: W.buyerAccess });
    reasons.push("buyer_access_partial");
    missing.push(hasContractor ? "contractor_decision_maker" : "main_contractor_confirmed");
  } else {
    missing.push("main_contractor_confirmed", "contractor_decision_maker");
    reasons.push("buyer_access_missing");
    risk_flags.push("contact_not_confirmed");
  }

  // 4. Timing (15) — is there a live, near-term next action or contract date.
  const dueDays = daysUntil(o.next_action_due) ?? daysUntil(o.expected_contract_date);
  if (dueDays != null) {
    let ratio: number;
    if (dueDays < 0) ratio = 0.4; // overdue — still "timely" in the sense of active, but flagged as risk below
    else if (dueDays <= 14) ratio = 1;
    else if (dueDays <= 45) ratio = 0.7;
    else if (dueDays <= 90) ratio = 0.4;
    else ratio = 0.2;
    const pts = Math.round(W.timing * ratio);
    score += pts;
    categoriesWithData++;
    evidence.push({ label: "Timing", field: o.next_action_due ? "next_action_due" : "expected_contract_date", value: `${dueDays}d`, weight: pts, max: W.timing });
    reasons.push(dueDays < 0 ? "next_action_overdue" : dueDays <= 14 ? "timing_urgent" : "timing_on_track");
    if (dueDays < 0) risk_flags.push("follow_up_overdue");
  } else {
    missing.push("next_action_due");
    reasons.push("timing_unknown");
  }

  // 5. Value Potential (10) — estimated/quoted value vs the signage threshold.
  const value = o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min;
  if (value != null && !Number.isNaN(value)) {
    const ratio = Math.min(1, value / OPPORTUNITY_VALUE_THRESHOLD);
    const pts = Math.round(W.valuePotential * ratio);
    score += pts;
    categoriesWithData++;
    evidence.push({ label: "Value potential", field: "estimated_value", value: String(value), weight: pts, max: W.valuePotential });
    reasons.push(value >= OPPORTUNITY_VALUE_THRESHOLD ? "value_above_threshold" : "value_below_threshold");
  } else {
    missing.push("estimated_value");
    reasons.push("value_unknown");
  }

  // 6. Evidence (10) — how many evidence items support this opportunity.
  const evCount = o.evidence_count ?? 0;
  if (evCount > 0) {
    const pts = Math.min(W.evidence, evCount * 2);
    score += pts;
    categoriesWithData++;
    evidence.push({ label: "Evidence", field: "evidence_count", value: String(evCount), weight: pts, max: W.evidence });
    reasons.push(evCount >= 3 ? "well_evidenced" : "lightly_evidenced");
  } else {
    missing.push("evidence_count");
    reasons.push("no_evidence");
  }

  score = Math.max(0, Math.min(100, score));
  const tier = tierOf(score);

  const confidence: OpportunityScoreResult["confidence"] =
    categoriesWithData >= 5 ? "high" : categoriesWithData >= 3 ? "medium" : "low";

  // Recommended next action: address the single highest-impact gap first.
  let recommended_next_action = "Continue routine follow-up.";
  if (missing.includes("main_contractor_confirmed") || missing.includes("contractor_decision_maker")) {
    recommended_next_action = "Identify and confirm the buyer/decision-maker.";
  } else if (missing.includes("signage_package_status")) {
    recommended_next_action = "Verify the signage package status.";
  } else if (missing.includes("evidence_count")) {
    recommended_next_action = "Attach supporting evidence.";
  } else if (missing.includes("estimated_value")) {
    recommended_next_action = "Estimate the signage value.";
  } else if (missing.includes("next_action_due")) {
    recommended_next_action = "Schedule a next action / follow-up date.";
  } else if (risk_flags.includes("follow_up_overdue")) {
    recommended_next_action = "Follow up now — the last scheduled action is overdue.";
  } else if (tier === "A") {
    recommended_next_action = "Prioritize for quotation / commercial push.";
  } else if (tier === "not_qualified") {
    recommended_next_action = "Re-qualify or consider excluding.";
  }

  // Advisory only — never written automatically.
  let suggested_win_confidence: SuggestedWinConfidence = "low";
  if (score >= 85 && risk_flags.length === 0 && evCount >= 3) suggested_win_confidence = "sure_win";
  else if (score >= 75) suggested_win_confidence = "strong";
  else if (score >= 50) suggested_win_confidence = "possible";

  return {
    score,
    tier,
    confidence,
    evidence,
    reasons,
    missing_data: [...new Set(missing)],
    risk_flags: [...new Set(risk_flags)],
    recommended_next_action,
    suggested_win_confidence,
  };
}
