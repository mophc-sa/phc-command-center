import { opportunityValue, type OppValueFields } from "./opportunity-value.ts";
import { resolveCanonicalStage } from "./stage-canonical.ts";

/** Never turn a failed/oversized read into a plausible partial total. Stable ID order is required. */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = 100000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += 500) {
    const result = await page(from, from + 499);
    if (result.error || !Array.isArray(result.data))
      throw new Error("Required AI source read failed");
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
  throw new Error("AI source exceeds complete-read limit; use a database aggregate");
}

type Opportunity = OppValueFields & {
  stage?: string | null;
  sales_stage?: string | null;
  currency?: string | null;
};
type Quote = { status?: string | null; value?: number | string | null; currency?: string | null };
type Bucket = {
  count: number;
  valued: number;
  unvalued: number;
  value_by_currency: Record<string, number>;
};
function bucket(): Bucket {
  return { count: 0, valued: 0, unvalued: 0, value_by_currency: {} };
}
function add(b: Bucket, value: number | null, currency?: string | null) {
  b.count++;
  if (value === null) {
    b.unvalued++;
    return;
  }
  b.valued++;
  const unit = currency?.trim() || "UNKNOWN";
  b.value_by_currency[unit] = Math.round(((b.value_by_currency[unit] ?? 0) + value) * 100) / 100;
}
export function salesFacts(opps: readonly Opportunity[], quotes: readonly Quote[]) {
  const stages: Record<string, Bucket> = {};
  const open = bucket();
  let archived = 0;
  let inferred = 0;
  let won = 0;
  let lost = 0;
  for (const row of opps) {
    const resolved = resolveCanonicalStage(row);
    if (row.stage === "archived") {
      archived++;
      continue;
    }
    const stage = resolved.stage ?? "unknown";
    if (resolved.source === "inferred") inferred++;
    add((stages[stage] ??= bucket()), opportunityValue(row), row.currency);
    if (stage === "won") won++;
    else if (stage === "lost") lost++;
    else if (resolved.stage) add(open, opportunityValue(row), row.currency);
  }
  const funnel: Record<string, Bucket> = {};
  for (const q of quotes) {
    const value = q.value == null || q.value === "" ? null : Number(q.value);
    add(
      (funnel[q.status ?? "unknown"] ??= bucket()),
      value !== null && Number.isFinite(value) ? value : null,
      q.currency,
    );
  }
  return {
    scope:
      "All records at read time; archived opportunities excluded from pipeline. Open includes on_hold. Currency totals are separate; missing currency is UNKNOWN.",
    complete: true,
    opportunity_count: opps.length - archived,
    archived_count: archived,
    inferred_stage_count: inferred,
    open,
    won_count: won,
    lost_count: lost,
    opportunity_win_rate_pct: won + lost ? Math.round((100 * won) / (won + lost)) : null,
    pipeline_by_stage: stages,
    quotation_funnel: funnel,
    quotation_win_rate_pct:
      (funnel.won?.count ?? 0) + (funnel.lost?.count ?? 0)
        ? Math.round(
            (100 * (funnel.won?.count ?? 0)) /
              ((funnel.won?.count ?? 0) + (funnel.lost?.count ?? 0)),
          )
        : null,
    generated_at: new Date().toISOString(),
  };
}
