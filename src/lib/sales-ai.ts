// =============================================================================
// PHC Sales OS — Sales AI discipline (Phase 5).
//
// NO NEW AGENT. The registry already carries opportunity_evaluation,
// sales_report_insights, commercial_risk_assessment and risk_finance, all
// fronted by the single ai-orchestrator Edge Function. This module is the layer
// around them, and it does two jobs:
//
// 1. SEPARATES WHAT IS KNOWN FROM WHAT IS GUESSED.
//    A management brief that mixes "this deal has had no activity for 12 days"
//    with "this deal is at risk" teaches the reader to trust both equally. The
//    first is a fact anyone can verify; the second is a model's opinion. Every
//    line therefore carries its provenance, and the UI renders them differently.
//
// 2. KEEPS AI ADVISORY. The forbidden-action list is enforced here as a
//    checkable predicate rather than left as a prompt instruction, because a
//    prompt is a request and a guard is a rule. The database is still the real
//    boundary — nothing in this file grants write access — but a recommendation
//    that proposes a forbidden action is refused before it reaches a human, so
//    nobody is invited to rubber-stamp it.
//
// The deterministic brief below needs no model at all. AI commentary is an
// optional layer on top of facts that already stand on their own.
//
// Pure. See sales-ai.test.ts.
// =============================================================================

import {
  executiveKpis,
  pipelineHealth,
  resolveProbability,
  type KpiContext,
  type OppRow,
} from "@/lib/sales-kpis";

// ---- Provenance (PRD §36) ---------------------------------------------------

export type Provenance = "fact" | "calculated" | "inference" | "recommendation";

export type BriefLine = {
  provenance: Provenance;
  text: string;
  /** What backs this line: a table, a formula, or the agent that produced it. */
  basis: string;
  entityId?: string;
  href?: string;
};

export const PROVENANCE_LABEL: Record<Provenance, { en: string; ar: string }> = {
  fact: { en: "FACT", ar: "حقيقة" },
  calculated: { en: "CALCULATED", ar: "محسوب" },
  inference: { en: "AI INFERENCE", ar: "استنتاج ذكاء اصطناعي" },
  recommendation: { en: "RECOMMENDATION", ar: "توصية" },
};

/** True for lines a model produced — the UI marks these visually. */
export function isAiGenerated(line: BriefLine): boolean {
  return line.provenance === "inference" || line.provenance === "recommendation";
}

// ---- Forbidden actions (PRD §37) -------------------------------------------

/**
 * Everything AI may never do. Each is a state change with commercial or
 * governance consequence — the kind of decision that must have a person's name
 * on it.
 */
export const AI_FORBIDDEN_ACTIONS = [
  "change_sales_stage",
  "change_tender_stage",
  "change_owner",
  "change_human_probability",
  "approve_bafo",
  "record_won",
  "record_lost",
  "close_action",
  "change_target",
  "issue_project_number",
  "validate_boq",
  "send_email",
  "send_whatsapp",
  "create_commercial_commitment",
] as const;

export type ForbiddenAction = (typeof AI_FORBIDDEN_ACTIONS)[number];

export type AiRecommendation = {
  id: string;
  text: string;
  /** What the model proposes a HUMAN should do. */
  proposedAction: string;
  entityId?: string;
};

export type RecommendationCheck =
  | { allowed: true }
  | { allowed: false; violated: ForbiddenAction; reason: string };

/**
 * Matched on intent, not on an exact string, because a model will phrase the
 * same proposal a dozen ways. Over-matching is the safe direction: a refused
 * recommendation costs a suggestion, an accepted one costs a governance
 * boundary.
 */
const FORBIDDEN_PATTERNS: Array<{ action: ForbiddenAction; re: RegExp }> = [
  // Tender is tested before the generic stage rule: the sales pattern matches a
  // bare "stage", which would otherwise swallow "tender stage" and report the
  // wrong action. Either way the recommendation is refused — this only keeps the
  // reason given to the reader accurate.
  { action: "change_tender_stage", re: /\b(set|change|move|advance|update)\b[^.]{0,40}\btender[_ ]?stage\b/i },
  { action: "change_sales_stage", re: /\b(set|change|move|advance|update)\b[^.]{0,40}\b(sales[_ ]?stage|stage)\b/i },
  { action: "change_owner", re: /\b(reassign|change[^.]{0,20}owner|set[^.]{0,20}owner)\b/i },
  { action: "change_human_probability", re: /\b(set|change|update|override)\b[^.]{0,40}\b(manager|human)[_ ]?probability\b/i },
  { action: "approve_bafo", re: /\bapprove\b[^.]{0,30}\bbafo\b/i },
  { action: "record_won", re: /\b(mark|record|set)\b[^.]{0,30}\b(as\s+)?won\b/i },
  { action: "record_lost", re: /\b(mark|record|set)\b[^.]{0,30}\b(as\s+)?lost\b/i },
  { action: "close_action", re: /\b(close|complete|dismiss|resolve)\b[^.]{0,30}\b(action|flag|task)\b/i },
  { action: "change_target", re: /\b(set|change|update|adjust)\b[^.]{0,30}\btarget\b/i },
  { action: "issue_project_number", re: /\b(issue|assign|generate|create)\b[^.]{0,30}\bproject[_ ]?number\b/i },
  { action: "validate_boq", re: /\b(validate|approve|confirm|verify)\b[^.]{0,30}\bboq\b/i },
  { action: "send_email", re: /\bsend\b[^.]{0,20}\b(e-?mail)\b/i },
  { action: "send_whatsapp", re: /\bsend\b[^.]{0,20}\b(whatsapp|sms|message)\b/i },
  { action: "create_commercial_commitment", re: /\b(commit|promise|guarantee|offer)\b[^.]{0,30}\b(price|discount|delivery|contract)\b/i },
];

export function checkRecommendation(r: AiRecommendation): RecommendationCheck {
  const haystack = `${r.text} ${r.proposedAction}`;
  for (const { action, re } of FORBIDDEN_PATTERNS) {
    if (re.test(haystack)) {
      return {
        allowed: false,
        violated: action,
        reason: `AI is advisory only and may not ${action.replace(/_/g, " ")}. A person decides this.`,
      };
    }
  }
  return { allowed: true };
}

/** Drops anything that proposes a forbidden action, keeping the rest. */
export function filterRecommendations(list: AiRecommendation[]): {
  allowed: AiRecommendation[];
  refused: Array<{ rec: AiRecommendation; violated: ForbiddenAction }>;
} {
  const allowed: AiRecommendation[] = [];
  const refused: Array<{ rec: AiRecommendation; violated: ForbiddenAction }> = [];
  for (const rec of list) {
    const c = checkRecommendation(rec);
    if (c.allowed) allowed.push(rec);
    else refused.push({ rec, violated: c.violated });
  }
  return { allowed, refused };
}

// ---- AI vs human probability (PRD §38) -------------------------------------

export type ProbabilityComparison = {
  opportunityId: string;
  label: string;
  ai: number | null;
  human: number | null;
  delta: number | null;
  /** True when the gap is wide enough to be worth a conversation. */
  divergent: boolean;
  note: string;
};

export const DIVERGENCE_THRESHOLD = 20;

/**
 * Shows both numbers side by side and never reconciles them. A wide gap is
 * surfaced as something to discuss, not resolved by picking a winner — the
 * manager's number stands, and the disagreement itself is the signal.
 */
export function compareProbabilities(
  opps: OppRow[],
  threshold = DIVERGENCE_THRESHOLD,
): ProbabilityComparison[] {
  return opps.map((o) => {
    const p = resolveProbability(o);
    const label = o.project_name ?? o.id.slice(0, 8);
    const divergent = p.delta !== null && Math.abs(p.delta) >= threshold;

    let note: string;
    if (p.human === null && p.ai === null) note = "Neither a manager nor an AI probability has been recorded.";
    else if (p.human === null) note = "AI-estimated only — no manager judgement recorded.";
    else if (p.ai === null) note = "Manager judgement only — not yet scored by AI.";
    else if (divergent) {
      note = `Manager is ${p.delta! > 0 ? "more" : "less"} confident than the model by ${Math.abs(p.delta!)} points.`;
    } else note = "Manager and AI broadly agree.";

    return { opportunityId: o.id, label, ai: p.ai, human: p.human, delta: p.delta, divergent, note };
  });
}

// ---- Deterministic management brief (PRD §39) ------------------------------

export type ManagementBrief = {
  whatChanged: BriefLine[];
  needsAttention: BriefLine[];
  forecast: BriefLine[];
  focus: BriefLine[];
};

const money = (n: number) => `SAR ${Math.round(n).toLocaleString("en-US")}`;

/**
 * Built entirely from counted records. No model is called; the AI layer, when
 * enabled, adds commentary ON TOP of these lines rather than replacing them, so
 * the brief still works — and is still true — with AI switched off entirely.
 */
export function buildManagementBrief(input: {
  opportunities: OppRow[];
  ctx: KpiContext;
  recentEvents?: Array<{ type: string; title: string; at: string; entityId?: string }>;
  targetAmount?: number | null;
}): ManagementBrief {
  const { opportunities, ctx } = input;
  const k = executiveKpis(opportunities, ctx);
  const health = pipelineHealth(opportunities, ctx);

  const whatChanged: BriefLine[] = [];
  const moves = (input.recentEvents ?? []).filter((e) => e.type === "stage_changed");
  if (moves.length > 0) {
    whatChanged.push({
      provenance: "fact",
      text: `${moves.length} opportunit${moves.length === 1 ? "y" : "ies"} changed stage.`,
      basis: "stage_transition_history",
    });
  }
  if (k.wonValue.recordCount > 0) {
    whatChanged.push({
      provenance: "calculated",
      text: `${k.wonValue.recordCount} deal${k.wonValue.recordCount === 1 ? "" : "s"} won, ${money(k.wonValue.value ?? 0)}.`,
      basis: k.wonValue.formula,
    });
  }
  if (k.lostValue.recordCount > 0) {
    whatChanged.push({
      provenance: "calculated",
      text: `${k.lostValue.recordCount} lost, ${money(k.lostValue.value ?? 0)}.`,
      basis: k.lostValue.formula,
    });
  }
  if (whatChanged.length === 0) {
    whatChanged.push({ provenance: "fact", text: "No stage movement or closures recorded in this period.", basis: "opportunities" });
  }

  const needsAttention: BriefLine[] = [];
  const byIssue = (issue: string) => health.filter((h) => h.issue === issue);
  for (const [issue, phrase] of [
    ["expected_close_overdue", "past their expected close date"],
    ["stalled", "with no recent activity"],
    ["no_next_action", "with no next action set"],
    ["high_value_low_probability", "high value at low probability"],
  ] as const) {
    const n = byIssue(issue).length;
    if (n > 0) {
      needsAttention.push({
        provenance: "fact",
        text: `${n} opportunit${n === 1 ? "y" : "ies"} ${phrase}.`,
        basis: "deterministic pipeline health checks",
      });
    }
  }
  if (needsAttention.length === 0) {
    needsAttention.push({ provenance: "fact", text: "Nothing is flagged by the health checks.", basis: "deterministic pipeline health checks" });
  }

  const forecast: BriefLine[] = [
    {
      provenance: "calculated",
      text:
        k.weightedPipeline.value === null
          ? "Weighted forecast cannot be computed — no open deal carries a probability."
          : `Weighted forecast ${money(k.weightedPipeline.value)} from ${money(k.openPipeline.value ?? 0)} open pipeline.`,
      basis: k.weightedPipeline.formula,
    },
  ];
  if (k.weightedPipeline.caveat) {
    // The caveat is a structured fact now; this consumer builds prose, so it
    // renders the key. Package D will translate it at the presentation layer
    // like every other caveat.
    forecast.push({
      provenance: "fact",
      text: k.weightedPipeline.caveat.key,
      basis: "opportunities probability columns",
    });
  }
  // Exposure is stated separately, in the same breath as the warning.
  if ((k.lateStageExposure.value ?? 0) > 0) {
    forecast.push({
      provenance: "calculated",
      text: `${money(k.lateStageExposure.value ?? 0)} sits at verbal award or contract stage — exposure, not revenue, and not counted toward target.`,
      basis: k.lateStageExposure.formula,
    });
  }
  if (typeof input.targetAmount === "number" && input.targetAmount > 0) {
    const gap = Math.max(0, input.targetAmount - (k.wonValue.value ?? 0));
    forecast.push({
      provenance: "calculated",
      text: gap > 0 ? `${money(gap)} remaining to target.` : "Target met.",
      basis: "max(0, target − won value)",
    });
  }

  // Biggest open deals — a fact, ordered by value.
  const focus: BriefLine[] = [...opportunities]
    .filter((o) => k.openPipeline.recordIds.includes(o.id))
    .map((o) => ({ o, v: Number(o.contract_value ?? o.quotation_value ?? o.estimated_value_max ?? 0) }))
    .filter((x) => Number.isFinite(x.v) && x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map(({ o, v }) => ({
      provenance: "fact" as const,
      text: `${o.project_name ?? o.id.slice(0, 8)} — ${money(v)}`,
      basis: "largest open opportunities by value",
      entityId: o.id,
      href: `/opportunities/${o.id}`,
    }));
  if (focus.length === 0) {
    focus.push({ provenance: "fact", text: "No valued open opportunities.", basis: "opportunities" });
  }

  return { whatChanged, needsAttention, forecast, focus };
}

/**
 * Merges optional AI commentary into a deterministic brief, marking every added
 * line as inference or recommendation and dropping anything that proposes a
 * forbidden action.
 */
export function withAiCommentary(
  brief: ManagementBrief,
  commentary: { inferences?: string[]; recommendations?: AiRecommendation[]; agentKey: string },
): { brief: ManagementBrief; refused: Array<{ rec: AiRecommendation; violated: ForbiddenAction }> } {
  const { allowed, refused } = filterRecommendations(commentary.recommendations ?? []);
  return {
    brief: {
      ...brief,
      needsAttention: [
        ...brief.needsAttention,
        ...(commentary.inferences ?? []).map((text) => ({
          provenance: "inference" as const,
          text,
          basis: `ai-orchestrator · ${commentary.agentKey}`,
        })),
        ...allowed.map((r) => ({
          provenance: "recommendation" as const,
          text: r.text,
          basis: `ai-orchestrator · ${commentary.agentKey}`,
          entityId: r.entityId,
        })),
      ],
    },
    refused,
  };
}
