// =============================================================================
// Data Import Center — duplicate detection helpers (pure, unit-testable).
//
// Used by the import-pipeline edge function to detect likely duplicates:
//   1. within the uploaded file itself,
//   2. against existing CRM records,
//   3. against previous import batches.
// Every hit carries matched fields, a confidence score, a reason code, and a
// suggested action. Nothing here mutates data or auto-merges.
// =============================================================================

import { normalizeCompanyName } from "./company-normalize.ts";

export function normalizeDomain(v: string | null | undefined): string {
  if (!v) return "";
  let s = String(v).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0];
  if (s.includes("@")) s = s.split("@")[1] ?? "";
  return s;
}

export function normalizePhone(v: string | null | undefined): string {
  if (!v) return "";
  const d = String(v).replace(/\D/g, "");
  return d.length > 9 ? d.slice(-9) : d;
}

export function normalizeEmail(v: string | null | undefined): string {
  return v ? String(v).toLowerCase().trim() : "";
}

export function normalizeCr(v: string | null | undefined): string {
  return v ? String(v).replace(/\D/g, "") : "";
}

// Levenshtein similarity ratio 0..1 (works on Arabic + Latin code points).
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return 1 - dp[m] / Math.max(m, n);
}

export type DedupSignals = {
  company_name?: string | null;
  cr_number?: string | null;
  website_domain?: string | null;
  email?: string | null;
  phone?: string | null;
  project_name?: string | null;
  main_contractor?: string | null;
  tender_ref?: string | null;
};

export type MatchType = "exact" | "cr_number" | "domain" | "name" | "fuzzy";
export type SuggestedAction = "link_to_existing" | "skip_row" | "needs_manual_review" | "keep_as_new";

export type DuplicateHit = {
  match_type: MatchType;
  matched_fields: string[];
  confidence: number; // 0..1
  reason_code: string;
  suggested_action: SuggestedAction;
};

export const NAME_SIMILARITY_THRESHOLD = 0.86;

// Compare two records' signals; return the strongest duplicate hit, or null.
export function compareSignals(a: DedupSignals, b: DedupSignals): DuplicateHit | null {
  const crA = normalizeCr(a.cr_number), crB = normalizeCr(b.cr_number);
  if (crA && crA === crB) {
    return { match_type: "cr_number", matched_fields: ["cr_number"], confidence: 0.98, reason_code: "same_cr_number", suggested_action: "link_to_existing" };
  }
  const domA = normalizeDomain(a.website_domain), domB = normalizeDomain(b.website_domain);
  if (domA && domA === domB) {
    return { match_type: "domain", matched_fields: ["website_domain"], confidence: 0.9, reason_code: "same_website_domain", suggested_action: "link_to_existing" };
  }
  const emA = normalizeEmail(a.email), emB = normalizeEmail(b.email);
  if (emA && emA === emB) {
    return { match_type: "exact", matched_fields: ["email"], confidence: 0.9, reason_code: "same_email", suggested_action: "link_to_existing" };
  }
  const tA = normalizeCompanyName(a.tender_ref), tB = normalizeCompanyName(b.tender_ref);
  if (tA && tA === tB) {
    return { match_type: "exact", matched_fields: ["tender_ref"], confidence: 0.9, reason_code: "same_tender_ref", suggested_action: "needs_manual_review" };
  }
  const phA = normalizePhone(a.phone), phB = normalizePhone(b.phone);
  if (phA && phA === phB) {
    return { match_type: "exact", matched_fields: ["phone"], confidence: 0.8, reason_code: "same_phone", suggested_action: "needs_manual_review" };
  }
  const nA = normalizeCompanyName(a.company_name), nB = normalizeCompanyName(b.company_name);
  if (nA && nA === nB) {
    return { match_type: "name", matched_fields: ["company_name"], confidence: 0.78, reason_code: "same_normalized_name", suggested_action: "needs_manual_review" };
  }
  if (nA && nB) {
    const sim = similarity(nA, nB);
    if (sim >= NAME_SIMILARITY_THRESHOLD) {
      return { match_type: "fuzzy", matched_fields: ["company_name"], confidence: Math.round(sim * 100) / 100, reason_code: "similar_company_name", suggested_action: "needs_manual_review" };
    }
  }
  const pA = normalizeCompanyName(a.project_name), pB = normalizeCompanyName(b.project_name);
  if (pA && pA === pB) {
    return { match_type: "name", matched_fields: ["project_name"], confidence: 0.7, reason_code: "same_project_name", suggested_action: "needs_manual_review" };
  }
  return null;
}

// Within-file duplicates: return every earlier row a given row collides with.
export function findWithinFileDuplicates(
  rows: { id: string; signals: DedupSignals }[],
): { rowId: string; otherRowId: string; hit: DuplicateHit }[] {
  const out: { rowId: string; otherRowId: string; hit: DuplicateHit }[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < i; j++) {
      const hit = compareSignals(rows[i].signals, rows[j].signals);
      if (hit) out.push({ rowId: rows[i].id, otherRowId: rows[j].id, hit });
    }
  }
  return out;
}
