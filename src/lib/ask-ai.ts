// =============================================================================
// Phase 5.1 §17/§18 — "Search or ask PHC AI".
//
// THE SHAPE, AND WHY IT IS THIS SHAPE
//
//   query ──▶ classifyIntent()  ──▶ record search   (existing CommandPalette)
//              DETERMINISTIC     └─▶ bounded filter (a named, closed set)
//                                         │
//                                         ▼
//                                   the user's own supabase client
//                                         │  ← RLS decides what exists
//                                         ▼
//                                   rows ──▶ optional AI explanation
//
// The classifier is regex and keywords, not a model. That is the security
// boundary, not a performance choice: a model that decides which query to run
// is a model that can be talked into running a different one. Here the set of
// possible retrievals is finite, written down, and reviewable — the query only
// selects among them.
//
// NO GENERATED SQL, EVER. Every retrieval is an existing PostgREST call made
// with the signed-in user's client, so RLS is enforced by the database rather
// than by anything in this file remembering to ask. A user cannot phrase their
// way into another owner's pipeline, because the rows never leave the database.
//
// The AI, when it runs at all, sees only rows that already came back. It cannot
// widen a result set; it can only describe one.
// =============================================================================

import {
  buildAttention,
  type AttentionItem,
  type AttentionOpp,
  type ReasonKind,
} from "@/lib/attention";

export type ManagementIntent =
  | "at_risk"
  | "stalled"
  | "closing_soon"
  | "no_next_action"
  | "no_decision_maker"
  | "missing_probability"
  | "above_value"
  | "overdue_follow_ups"
  | "summarize_entity";

export type Intent =
  | { kind: "record"; query: string }
  | { kind: "management"; intent: ManagementIntent; params: { minValue?: number; subject?: string } }
  | { kind: "empty" };

/**
 * Each intent's triggers, in both languages.
 *
 * Order matters: the first rule whose pattern matches wins, so the more
 * specific phrases sit above the general ones. A query matching nothing here
 * falls through to record search rather than to a model — the safe default is
 * the one that cannot invent anything.
 */
export const INTENT_RULES: Array<{ intent: ManagementIntent; patterns: RegExp[] }> = [
  {
    intent: "overdue_follow_ups",
    patterns: [/overdue\s+follow/i, /late\s+follow/i, /متابعات?\s*متأخر/, /متأخر\w*\s*متابع/u],
  },
  {
    intent: "no_next_action",
    patterns: [
      /no\s+(next\s+)?(action|follow[-\s]?up)/i,
      /without\s+(a\s+)?(next\s+)?action/i,
      /missing\s+next\s+action/i,
      /بلا\s+إجراء/,
      /بدون\s+إجراء/,
    ],
  },
  {
    intent: "no_decision_maker",
    patterns: [/no\s+decision\s?maker/i, /without\s+.*decision/i, /بلا\s+صانع\s+قرار/, /بدون\s+صانع/],
  },
  {
    intent: "missing_probability",
    patterns: [/no\s+probability/i, /missing\s+probability/i, /unscored/i, /بلا\s+احتمالي/],
  },
  { intent: "at_risk", patterns: [/at\s+risk/i, /\brisky\b/i, /للخطر/, /في\s+خطر/] },
  { intent: "stalled", patterns: [/stalled/i, /\bstuck\b/i, /متوقف/, /راكد/] },
  {
    intent: "closing_soon",
    patterns: [/clos\w*\s+(soon|this\s+week|this\s+month)/i, /expiring/i, /إغلاق\s+قريب/, /تنتهي/],
  },
  { intent: "summarize_entity", patterns: [/^summari[sz]e\s+/i, /^لخّ?ص\s+/, /^اختصر\s+/] },
];

/** "above SAR 1M", "over 500k", "أكثر من ٢ مليون". */
export function parseMinValue(q: string): number | undefined {
  const m = q.match(/(?:above|over|more\s+than|greater\s+than|أكثر\s+من|فوق)\s*(?:sar|ر\.?س\.?)?\s*([\d.,]+)\s*(m|million|k|thousand|مليون|ألف|الف)?/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] ?? "").toLowerCase();
  if (/^(m|million|مليون)$/.test(unit)) return n * 1_000_000;
  if (/^(k|thousand|ألف|الف)$/.test(unit)) return n * 1_000;
  return n;
}

/**
 * Deterministic. The same query always routes the same way, which is what makes
 * the retrieval surface auditable.
 */
export function classifyIntent(raw: string): Intent {
  const q = raw.trim();
  if (q === "") return { kind: "empty" };

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(q))) {
      if (rule.intent === "summarize_entity") {
        const subject = q.replace(/^(summari[sz]e|لخّ?ص|اختصر)\s+/i, "").trim();
        // "Summarize" with nothing after it names no subject, so it is not a
        // summary request — it is someone still typing.
        if (subject === "") return { kind: "record", query: q };
        return { kind: "management", intent: "summarize_entity", params: { subject } };
      }
      return { kind: "management", intent: rule.intent, params: { minValue: parseMinValue(q) } };
    }
  }

  // A bare value filter is still a management question.
  const minValue = parseMinValue(q);
  if (minValue !== undefined) return { kind: "management", intent: "above_value", params: { minValue } };

  return { kind: "record", query: q };
}

// ---- Bounded retrieval ------------------------------------------------------

/**
 * Which already-computed attention reason answers each intent.
 *
 * Reusing the attention engine rather than writing new filters means "at risk"
 * in the search box means exactly what "at risk" means on the dashboard. Two
 * definitions of at-risk would be worse than no search at all.
 */
const INTENT_REASON: Partial<Record<ManagementIntent, ReasonKind>> = {
  no_next_action: "no_next_action",
  no_decision_maker: "no_decision_maker",
  missing_probability: "unscored",
  overdue_follow_ups: "follow_up_overdue",
};

export type AnswerRow = {
  opportunityId: string;
  label: string;
  value: number | null;
  reasons: ReasonKind[];
};

export type BoundedAnswer = {
  intent: ManagementIntent;
  rows: AnswerRow[];
  /** How many the filter matched before any display cap. */
  matched: number;
  /** Named so a caller can show the reader what was actually asked. */
  filterDescription: { key: string; params?: Record<string, string | number> };
};

/**
 * Runs one named filter over rows the caller already holds.
 *
 * It takes ROWS, not a client. Anything reaching this function has already
 * passed RLS — the function cannot fetch, cannot widen, and cannot see a record
 * the user could not. That is the containment, and it is structural rather than
 * a rule somebody has to remember.
 */
export function answerBounded(
  intent: ManagementIntent,
  params: { minValue?: number },
  opportunities: AttentionOpp[],
  today: string,
): BoundedAnswer {
  const items = buildAttention({ opportunities, today });

  let matched: AttentionItem[];
  switch (intent) {
    case "at_risk":
      matched = items.filter((i) => i.atRisk);
      break;
    case "stalled":
      matched = items.filter((i) => i.stalled);
      break;
    case "closing_soon":
      matched = items.filter((i) => i.closingSoon);
      break;
    case "above_value":
      matched = items;
      break;
    case "summarize_entity":
      matched = [];
      break;
    default: {
      const reason = INTENT_REASON[intent];
      matched = reason ? items.filter((i) => i.reasons.some((r) => r.kind === reason)) : [];
    }
  }

  if (params.minValue !== undefined) {
    const min = params.minValue;
    matched = matched.filter((i) => (i.value ?? 0) >= min);
  }

  // `above_value` with no minimum names no filter at all, so it returns nothing
  // rather than the entire book dressed as an answer.
  if (intent === "above_value" && params.minValue === undefined) matched = [];

  return {
    intent,
    rows: matched.map((i) => ({
      opportunityId: i.opportunityId,
      label: i.label,
      // Was `i.value ?? opportunityValue(opportunities.find(...))` — a linear
      // scan inside a map, so O(n²) on the search path: 2,400 operations at
      // today's 49 rows, 400 million at 20,000. The fallback was also dead:
      // AttentionItem.value IS opportunityValue(o) for the same row, so when it
      // is null the recomputation returns null too.
      value: i.value,
      reasons: i.reasons.map((r) => r.kind),
    })),
    matched: matched.length,
    filterDescription: {
      key: `ask_filter_${intent}`,
      ...(params.minValue !== undefined ? { params: { minValue: params.minValue } } : {}),
    },
  };
}
