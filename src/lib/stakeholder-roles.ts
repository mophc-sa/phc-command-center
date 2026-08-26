// =============================================================================
// Phase 5.1 §19 — opportunity roles on the EXISTING stakeholder model.
//
// `stakeholders` is already per-opportunity (opportunity_id NOT NULL) and
// already carries a `role` column. Nothing here creates a second contacts
// system: the identity of a person stays where it is, and this only says what
// that person is TO THIS DEAL. The same human can be the decision maker on one
// opportunity and a technical reviewer on another, which is why the role
// belongs on the link and not on the contact.
//
// WHY A SECOND COLUMN RATHER THAN A CONSTRAINT ON `role`
//
// `role` is free text and may hold anything an import wrote years ago. A CHECK
// on it would reject every historical row on the next write that touched it,
// and rewriting those values needs a mapping nobody has proven — the live data
// could not be read to derive one. So `role_code` is added alongside, closed
// and constrained, and `role` is preserved untouched as the historical record.
//
// Reads prefer role_code, fall back to a best-effort reading of the old text,
// and say "unknown" rather than guessing when the text means nothing to us.
// =============================================================================

export const STAKEHOLDER_ROLES = [
  "decision_maker",
  "influencer",
  "technical",
  "procurement",
  "finance",
  "gatekeeper",
  "other",
] as const;

export type StakeholderRole = (typeof STAKEHOLDER_ROLES)[number];

export function isStakeholderRole(v: unknown): v is StakeholderRole {
  return typeof v === "string" && (STAKEHOLDER_ROLES as readonly string[]).includes(v);
}

/**
 * Best-effort reading of a historical free-text role.
 *
 * Deliberately conservative: it recognises phrasings that can only mean one
 * thing and returns null for everything else. A wrong confident mapping is
 * worse than an honest unknown here — "Decision Maker Identified: Yes" on a
 * guess would be exactly the kind of false completeness this phase has spent
 * its time removing. Nothing is ever WRITTEN from this; it only affects how an
 * existing row is displayed and counted.
 */
export function normalizeHistoricalRole(raw: string | null | undefined): StakeholderRole | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (isStakeholderRole(s)) return s;

  if (/\bdecision\s*[-_ ]?maker\b|\bdm\b|صانع\s*القرار|متخذ\s*القرار/.test(s)) return "decision_maker";
  if (/\binfluenc|مؤثر/.test(s)) return "influencer";
  if (/\btechnical\b|\bengineer|\bconsultant\b|فني|مهندس|استشاري/.test(s)) return "technical";
  if (/\bprocure|\bpurchas|\bbuyer\b|مشتريات|شراء/.test(s)) return "procurement";
  if (/\bfinance\b|\bfinancial\b|\baccount(s|ing)\b|مالي|محاسب/.test(s)) return "finance";
  if (/\bgatekeeper\b|\bassistant\b|\bsecretary\b|حاجب|سكرتير/.test(s)) return "gatekeeper";
  return null;
}

export type StakeholderRow = {
  id: string;
  opportunity_id?: string | null;
  name?: string | null;
  role?: string | null;
  role_code?: string | null;
  organization?: string | null;
  email?: string | null;
  phone?: string | null;
  last_interaction_at?: string | null;
};

/** The role in force: the controlled value, else a reading of the old text. */
export function effectiveRole(s: StakeholderRow): StakeholderRole | null {
  if (isStakeholderRole(s.role_code)) return s.role_code;
  return normalizeHistoricalRole(s.role);
}

/**
 * Three states, not two.
 *
 * "No" and "we cannot tell" are different facts and must not look the same —
 * the same rule the metric states follow. An opportunity with stakeholders
 * whose roles are all unreadable legacy text has NOT been shown to lack a
 * decision maker; nobody has recorded one in a form we can read.
 */
export type DecisionMakerState = "yes" | "no" | "unknown";

export function decisionMakerState(
  stakeholders: StakeholderRow[],
  /** The denormalised column the scorer already uses. A name here is evidence. */
  contractorDecisionMaker?: string | null,
): DecisionMakerState {
  if (stakeholders.some((s) => effectiveRole(s) === "decision_maker")) return "yes";
  if (contractorDecisionMaker && contractorDecisionMaker.trim() !== "") return "yes";

  // Somebody is attached, but nothing tells us who decides.
  if (stakeholders.length === 0) return "no";
  const anyReadable = stakeholders.some((s) => effectiveRole(s) !== null);
  return anyReadable ? "no" : "unknown";
}

/** Roles present on a deal, for the completeness read. */
export function rolesPresent(stakeholders: StakeholderRow[]): StakeholderRole[] {
  const seen = new Set<StakeholderRole>();
  for (const s of stakeholders) {
    const r = effectiveRole(s);
    if (r) seen.add(r);
  }
  return STAKEHOLDER_ROLES.filter((r) => seen.has(r));
}
