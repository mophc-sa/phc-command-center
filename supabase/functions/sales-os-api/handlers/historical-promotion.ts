import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../../_shared/respond.ts";
import { canApproveHistoricalPromotion } from "../../_shared/roles.ts";

// =============================================================================
// Historical promotion — the authorized path.
//
// WHY THIS HANDLER EXISTS AT ALL
// ------------------------------
// promote_historical_row() has been callable since 20260829100000 and had no
// caller. The database gates it on can_approve_historical_promotion(auth.uid())
// and grants EXECUTE only to `authenticated`, which is correct and is also why
// nothing could reach it: there was no UI, no API route, and a migration or a
// service-role backend both arrive with auth.uid() = NULL and are refused.
//
// So the missing piece was never authority — it was a way for a real person's
// session to get to the function. That is all this handler does.
//
// THE ONE RULE THAT MATTERS HERE
// ------------------------------
// Every write below goes through ctx.asCaller, which carries the caller's own
// JWT. Not ctx.svc. Using the service role would make auth.uid() NULL and the
// promotion would be refused — and if it somehow were not, the backend would
// be asserting an authority the database deliberately reserved for a person,
// and every promoted_by / reviewed_by stamp would name the wrong actor.
//
// The role check below is a courtesy, not a control: it turns a database
// exception into a clean 403. Remove it and nothing becomes possible that was
// not possible before.
//
// WHAT THIS DELIBERATELY IS NOT
// -----------------------------
// Not a bulk endpoint. One archive row per call, so the statement-level
// no-bulk trigger stays meaningful rather than being worked around by a loop
// inside a single transaction. A batch is the client calling this repeatedly
// and stopping when something fails.
//
// Not a generic SQL or RPC passthrough. The only function it can invoke is
// promote_historical_row, with one uuid argument.
// =============================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The archive fields the preflight reports. No cost, no margin, no supplier figure. */
const ELIGIBLE_COLUMNS =
  "row_id,row_number,sales_code,base_code,client,company_id,company_matched,project," +
  "route,status,status_canonical,amount,date_submitted,owner_prefix,owner_user_id,owner," +
  "promotion_status,promoted_opportunity_id,promoted_quotation_id,collision_class";

type Row = Record<string, unknown>;

const PROMOTABLE_COLLISIONS = new Set([
  "NO_COLLISION",
  "DISTINCT_BUSINESS_PURSUIT",
  "EXACT_DUPLICATE_PRIMARY",
]);

/**
 * Year from the strongest available business date, matching the precedence the
 * activation analysis used: submission date, then received date, then the year
 * embedded in a parsed sales code.
 */
function businessYear(r: Row): number | null {
  const sub = r.date_submitted as string | null;
  if (sub) return Number(sub.slice(0, 4));
  const rec = r.date_received as string | null;
  if (rec) return Number(rec.slice(0, 4));
  const base = r.base_code as string | null;
  if (base && /^[A-Z]{2}\d{5}$/.test(base)) {
    const y = 2000 + Number(base.slice(2, 4));
    if (y >= 2018 && y <= 2026) return y;
  }
  return null;
}

/**
 * Whether a row can enter the live pipeline, evaluated over the same facts the
 * database checks. This does NOT replace those checks — promote_historical_row
 * re-tests every one of them and is the thing that actually refuses. It exists
 * so the UI can say why a row is not promotable without attempting it.
 */
function ineligibleReasons(r: Row, promotableStatuses: Set<string>): string[] {
  const reasons: string[] = [];
  if (businessYear(r) !== 2026) reasons.push("not_2026");
  if (!promotableStatuses.has(String(r.status ?? "").trim().toUpperCase())) reasons.push("status_not_active");
  if (!r.owner_user_id) reasons.push("no_mapped_owner");
  if (!r.company_matched) reasons.push("company_unmatched");
  if (r.amount === null || r.amount === undefined) reasons.push("no_amount");
  if (!r.route) reasons.push("route_undetermined");
  if (!r.date_submitted) reasons.push("no_submission_date");
  if (!PROMOTABLE_COLLISIONS.has(String(r.collision_class ?? ""))) {
    reasons.push(`collision_${String(r.collision_class ?? "unknown").toLowerCase()}`);
  }
  if (r.promotion_status === "promoted") reasons.push("already_promoted");
  return reasons;
}

/** Statuses the database currently allows into the live pipeline. Read, never assumed. */
async function promotableStatuses(ctx: SalesOsContext): Promise<Set<string>> {
  const { data, error } = await ctx.asCaller
    .from("historical_sales_status_map")
    .select("source_status,promotable_active")
    .eq("promotable_active", true);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: Row) => String(r.source_status).trim().toUpperCase()));
}

/**
 * What is promotable right now, straight from the database.
 *
 * With a rowId: that one row and why it is or is not eligible.
 * Without: the whole currently-eligible set, so a caller can compare it
 * against an approved manifest before acting on any of it.
 */
async function preflight_historical_promotion(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const rowId = payload.rowId === undefined || payload.rowId === null ? null : String(payload.rowId);
  if (rowId !== null && !UUID.test(rowId)) return err("rowId must be a uuid");

  let statuses: Set<string>;
  try {
    statuses = await promotableStatuses(ctx);
  } catch (e) {
    return err(`Cannot read the promotion rules: ${(e as Error).message}`, 403);
  }

  // Read through the caller's own session: an archive they may not read
  // returns nothing rather than leaking that a row exists.
  let query = ctx.asCaller.from("historical_sales_search").select(ELIGIBLE_COLUMNS);
  if (rowId) query = query.eq("row_id", rowId);
  const { data, error } = await query;
  if (error) return err(error.message, 403);

  const rows = (data ?? []) as unknown as Row[];

  if (rowId) {
    if (rows.length === 0) return err("Archive row not found, or not readable by you", 404);
    const reasons = ineligibleReasons(rows[0], statuses);
    return json({
      rowId,
      eligible: reasons.length === 0,
      reasons,
      row: rows[0],
      canPromote: canApproveHistoricalPromotion(ctx.caller.roles),
    });
  }

  const eligible = rows.filter((r) => ineligibleReasons(r, statuses).length === 0);
  // Sorted so two callers comparing the same batch compare the same string.
  const rowIds = eligible.map((r) => String(r.row_id)).sort();
  const totalValue = eligible.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  return json({
    count: eligible.length,
    totalValue: Number(totalValue.toFixed(2)),
    rowIds,
    canPromote: canApproveHistoricalPromotion(ctx.caller.roles),
    records: eligible,
  });
}

/**
 * Promote exactly one archive row, through the whole existing lifecycle:
 * draft -> pending_review -> approved -> promote_historical_row().
 *
 * Idempotent. A row already promoted returns its existing opportunity and
 * quotation rather than making a second one — the partial unique index on
 * historical_promotion_requests.row_id would refuse a duplicate open request
 * anyway, but returning the first result is the more useful answer to a retry.
 */
async function promote_historical_record(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const rowId = String(payload.rowId ?? "");
  if (!UUID.test(rowId)) return err("rowId must be a uuid");

  // Courtesy 403. The database refuses regardless — see the header.
  if (!canApproveHistoricalPromotion(ctx.caller.roles)) {
    return err("Historical promotion is reserved to sales leadership", 403);
  }

  const db = ctx.asCaller;

  // ---- already done? ----
  const { data: existing, error: existingError } = await db
    .from("historical_promotion_requests")
    .select("id,status,promoted_opportunity_id,promoted_quotation_id")
    .eq("row_id", rowId)
    .in("status", ["draft", "pending_review", "approved", "promoted"])
    .maybeSingle();
  if (existingError) return err(existingError.message, 403);

  if (existing?.status === "promoted") {
    return json({
      rowId,
      requestId: existing.id,
      opportunityId: existing.promoted_opportunity_id,
      quotationId: existing.promoted_quotation_id,
      promotionStatus: "promoted",
      idempotent: true,
      validation: { ok: true, checks: ["already promoted — existing records returned unchanged"] },
    });
  }

  // ---- eligibility, before creating anything ----
  const pre = await preflight_historical_promotion({ rowId }, ctx);
  const preBody = await pre.clone().json();
  if (!pre.ok) return pre;
  if (!preBody.eligible) {
    return err("Archive row is not eligible for promotion", 409, { reasons: preBody.reasons });
  }
  const row = preBody.row as Row;

  // ---- the lifecycle, one step at a time, as the caller ----
  let requestId = existing?.id as string | undefined;
  if (!requestId) {
    const { data: created, error: createError } = await db
      .from("historical_promotion_requests")
      .insert({
        row_id: rowId,
        company_id: row.company_id,
        owner_user_id: row.owner_user_id,
        project_name: row.project,
        status_canonical: row.status_canonical ?? "submitted",
        amount_excl_vat: row.amount,
        mapping_notes:
          `Promoted from the Historical Sales Archive. Legacy code ${row.sales_code}, ` +
          `archive row ${row.row_number}, collision class ${row.collision_class}.`,
      })
      .select("id")
      .single();
    if (createError) return err(createError.message, 403);
    requestId = created.id as string;
  }

  for (const status of ["pending_review", "approved"] as const) {
    const { error } = await db
      .from("historical_promotion_requests")
      .update({ status })
      .eq("id", requestId);
    // The trigger raises here when the caller may not approve, when a mapping
    // is missing, or on an invalid transition. Surfaced verbatim: the database
    // messages are bilingual and say exactly what is wrong.
    if (error) return err(error.message, 403, { requestId, stage: status });
  }

  const { data: opportunityId, error: promoteError } = await db.rpc("promote_historical_row", {
    _request_id: requestId,
  });
  if (promoteError) return err(promoteError.message, 403, { requestId });

  // ---- read back what was actually written ----
  const { data: done, error: doneError } = await db
    .from("historical_promotion_requests")
    .select("status,promoted_opportunity_id,promoted_quotation_id")
    .eq("id", requestId)
    .single();
  if (doneError) return err(doneError.message, 500, { requestId, opportunityId });

  const { data: quote } = await db
    .from("quotations")
    .select("quote_number,legacy_sales_code,version,is_historical,historical_row_id")
    .eq("id", done.promoted_quotation_id)
    .maybeSingle();

  const { data: opp } = await db
    .from("opportunities")
    .select("owner_id,company_id,sales_stage,commercial_handoff_status,quotation_value")
    .eq("id", done.promoted_opportunity_id)
    .maybeSingle();

  const checks: string[] = [];
  const fail = (c: string) => checks.push(c);
  if (done.status !== "promoted") fail("request did not reach 'promoted'");
  if (!done.promoted_opportunity_id) fail("no opportunity recorded");
  if (!done.promoted_quotation_id) fail("no quotation recorded");
  if (opp && opp.sales_stage !== "jih") fail(`sales_stage is ${opp.sales_stage}, expected jih`);
  if (opp && String(opp.owner_id) !== String(row.owner_user_id)) fail("owner mismatch");
  if (opp && String(opp.company_id) !== String(row.company_id)) fail("company mismatch");
  if (opp && Number(opp.quotation_value) !== Number(row.amount)) fail("quotation_value mismatch");
  if (quote && !quote.is_historical) fail("quotation is not flagged historical");
  if (quote && String(quote.legacy_sales_code) !== String(row.sales_code)) fail("legacy_sales_code mismatch");
  if (quote && Number(quote.version) !== 1) fail(`quotation version is ${quote.version}, expected 1`);

  return json({
    rowId,
    requestId,
    opportunityId: done.promoted_opportunity_id,
    quotationId: done.promoted_quotation_id,
    promotionStatus: done.status,
    quoteNumber: quote?.quote_number ?? null,
    legacySalesCode: quote?.legacy_sales_code ?? null,
    salesStage: opp?.sales_stage ?? null,
    handoffStatus: opp?.commercial_handoff_status ?? null,
    idempotent: false,
    validation: { ok: checks.length === 0, checks },
  });
}

export const historicalPromotionModule: HandlerModule = {
  name: "historical-promotion",
  handlers: {
    preflight_historical_promotion,
    promote_historical_record,
  },
};
