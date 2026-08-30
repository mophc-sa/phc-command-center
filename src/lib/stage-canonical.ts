// PHC Sales OS — Canonical stage resolution.
//
// ADOPTED. As of Phase 1 (2026-08-12) every surface that makes a business
// decision from an opportunity's progress resolves it here:
//
//   command-center.tsx · reports.tsx · opportunities.index.tsx · my-workspace.tsx
//
// (This header previously read "PREPARATION ONLY. Nothing in the UI imports
// this yet." That stopped being true when the first three pages adopted it,
// and it stayed wrong long enough to be quoted back as evidence that the
// refactor had not started. It had.)
//
// `sales_stage` is the canonical commercial stage. `stage` and `pipeline_step`
// are retained as deprecated compatibility columns — still written by legacy
// paths, still read *only* through this module's fallback — until a migration
// retires them. Do not add a new read of either column directly.
//
// ── The problem ──────────────────────────────────────────────────────────────
//
// `opportunities` carries three overlapping progress columns:
//
//   stage          opportunity_stage  discovery · qualification · preparation ·
//                                     quotation · follow_up · won · lost · archived
//   sales_stage    sales_stage        rfq_received · jih · jih_bafo ·
//                                     under_negotiation · verbally_awarded ·
//                                     contract_received · contract_signed ·
//                                     won · lost · on_hold
//   pipeline_step  pipeline_step      18 values, driven by the lead/AI flow
//
// `sales_stage` is the real PHC commercial pipeline. `stage` is the generic CRM
// vocabulary the system started with. They are only kept in sync at the
// terminal states — applySalesStage writes `stage` when moving to won or lost,
// and never otherwise.
//
// Mid-pipeline they therefore drift, and the drift is not theoretical. Live
// production cross-tab, 2026-08-05:
//
//   legacy stage   sales_stage        count
//   qualification  NULL               1
//   quotation      NULL               1
//   quotation      rfq_received       1
//   quotation      verbally_awarded   1   ← a verbal award filed under "Quotation"
//
// command-center.tsx, reports.tsx and opportunities.index.tsx all read `stage`.
// So the management dashboard groups a verbally-awarded deal under "Quotation",
// and the pipeline-by-stage chart shows generic CRM buckets rather than the PHC
// flow the business actually runs.
//
// ── The rule this module encodes ─────────────────────────────────────────────
//
// `sales_stage` is canonical. `stage` is consulted only when `sales_stage` is
// absent, and only for the two states where it is authoritative (won/lost).
// Anything else is an inference, and is reported as one.

import { opportunityValue } from "@/lib/opportunity-value";

export const CANONICAL_STAGES = [
  "rfq_received",
  "jih",
  "jih_bafo",
  "under_negotiation",
  "verbally_awarded",
  "contract_received",
  "contract_signed",
  "won",
  "lost",
  "on_hold",
] as const;

export type CanonicalStage = (typeof CANONICAL_STAGES)[number];

/** Stages that represent live pipeline. Excludes terminal and paused states. */
export const CANONICAL_ACTIVE_STAGES: readonly CanonicalStage[] = [
  "rfq_received",
  "jih",
  "jih_bafo",
  "under_negotiation",
  "verbally_awarded",
  "contract_received",
  "contract_signed",
];

/** Display order for funnels and stage charts — pipeline order, not enum order. */
export const CANONICAL_FUNNEL_ORDER: readonly CanonicalStage[] = CANONICAL_ACTIVE_STAGES;

/** i18n key for a stage label. Matches the existing `sstage_*` keys in i18n.tsx.
 *  Typed as a template literal so `t()` accepts it without a cast. */
export function canonicalStageLabelKey(stage: CanonicalStage): `sstage_${CanonicalStage}` {
  return `sstage_${stage}`;
}

export type LegacyStage =
  | "discovery"
  | "qualification"
  | "preparation"
  | "quotation"
  | "follow_up"
  | "won"
  | "lost"
  | "archived";

export type StageSource = "sales_stage" | "legacy_terminal" | "inferred" | "none";

export type CanonicalStageResult = {
  /** Null means the row is not on the sales pipeline at all (archived). */
  stage: CanonicalStage | null;
  /** Where the answer came from — `inferred` means treat with suspicion. */
  source: StageSource;
};

/**
 * Resolves the canonical stage for an opportunity row.
 *
 * Deliberately returns *why* as well as *what*. A count built from inferred
 * stages is not the same quality of number as one built from real
 * `sales_stage` values, and the refactor should be able to surface that
 * difference rather than silently averaging the two together.
 */
export function resolveCanonicalStage(row: {
  sales_stage?: string | null;
  stage?: string | null;
}): CanonicalStageResult {
  const legacy = row.stage;

  // Archived is a record-lifecycle state, not a pipeline position — so it is
  // checked BEFORE sales_stage, not after.
  //
  // It used to be checked last, which made the branch unreachable for exactly
  // the rows that need it: archiving an opportunity leaves sales_stage alone
  // (deliberately — the history should still read correctly), so a row with
  // stage='archived' and sales_stage='jih' resolved to `jih` and kept counting
  // in every KPI. `stage='archived'` is the soft-delete for an opportunity —
  // 20260711160000 skipped adding archived_at columns for that reason and
  // record-lifecycle.ts refuses hard deletes in favour of it — so a
  // soft-delete that does not remove the record from the numbers is not a
  // soft-delete at all. Voiding a historical promotion relies on this.
  if (legacy === "archived") return { stage: null, source: "none" };

  const sales = row.sales_stage;
  if (sales && (CANONICAL_STAGES as readonly string[]).includes(sales)) {
    return { stage: sales as CanonicalStage, source: "sales_stage" };
  }

  // `stage` is authoritative for exactly these two — applySalesStage keeps them
  // in sync, so a won/lost here is a real outcome, not a guess.
  if (legacy === "won") return { stage: "won", source: "legacy_terminal" };
  if (legacy === "lost") return { stage: "lost", source: "legacy_terminal" };

  // Everything else is a generic CRM bucket that carries no reliable
  // information about commercial position. Placing it at the pipeline entry
  // is the only honest inference — it neither invents progress nor drops
  // the row from counts entirely.
  if (legacy) return { stage: "rfq_received", source: "inferred" };

  return { stage: null, source: "none" };
}

/**
 * The `stage` value to write alongside a canonical stage, so the legacy column
 * stays meaningful for anything still reading it during the migration.
 *
 * Returns null for stages with no sensible legacy equivalent — the caller
 * should leave `stage` untouched rather than inventing one.
 */
export function legacyStageFor(stage: CanonicalStage): LegacyStage | null {
  switch (stage) {
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "rfq_received":
      return "quotation";
    case "jih":
    case "jih_bafo":
    case "under_negotiation":
    case "verbally_awarded":
    case "contract_received":
    case "contract_signed":
      return "quotation";
    case "on_hold":
      return null;
  }
}

/**
 * Groups a set of rows by canonical stage, keeping count and value together and
 * reporting how much of the result rests on inference.
 *
 * This is the shape command-center.tsx and reports.tsx need to switch to. It is
 * exported now, unused, so the switch is a small diff at each call site rather
 * than a rewrite.
 */
export function groupByCanonicalStage(
  rows: Array<{
    sales_stage?: string | null;
    stage?: string | null;
    contract_value?: number | null;
    estimated_value_max?: number | null;
    estimated_value_min?: number | null;
    quotation_value?: number | null;
  }>,
  opts: { stages?: readonly CanonicalStage[] } = {},
): {
  buckets: Array<{ stage: CanonicalStage; count: number; value: number }>;
  inferredCount: number;
  excludedCount: number;
} {
  const stages = opts.stages ?? CANONICAL_FUNNEL_ORDER;
  const map = new Map<CanonicalStage, { count: number; value: number }>();
  for (const s of stages) map.set(s, { count: 0, value: 0 });

  let inferredCount = 0;
  let excludedCount = 0;

  for (const row of rows) {
    const { stage, source } = resolveCanonicalStage(row);
    if (stage === null || !map.has(stage)) {
      excludedCount += 1;
      continue;
    }
    if (source === "inferred") inferredCount += 1;
    const bucket = map.get(stage)!;
    bucket.count += 1;
    // The shared rule, not a copy of it. This file kept its own chain because
    // sales-kpis imports the stage resolver from here, so the rule could not be
    // imported back without a cycle — and a rule that cannot be imported gets
    // duplicated, and a duplicated rule drifts. It lives in
    // opportunity-value.ts now, below both modules.
    //
    // `?? estimated_value_min` stays as an explicit extra: a funnel bucket
    // showing a floor is more useful than one showing nothing. Written at the
    // call site, so there is still one definition of worth and one visible
    // exception rather than two definitions.
    bucket.value += opportunityValue(row) ?? (Number(row.estimated_value_min) || 0);
  }

  return {
    buckets: stages.map((s) => ({ stage: s, ...map.get(s)! })),
    inferredCount,
    excludedCount,
  };
}
