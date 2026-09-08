import { readAll } from "../../_shared/ai-facts.ts";
import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import {
  json,
  err,
  canManageSalesPipeline,
  scoreLead,
  findDuplicateGroups,
  writeRecommendation,
  startAgentRun,
  finishAgentRun,
  notConfiguredRun,
} from "../shared.ts";
import type { DupRecord } from "../shared.ts";

async function accept_recommendation(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { data, error } = await ctx.asCaller.rpc("accept_legacy_ai_recommendation", {
    _id: String(payload.recommendationId ?? ""),
  });
  if (error) return err(error.message, error.code === "42501" ? 403 : 409);
  return json(data);
}

// Convert an RFQ into a live JIH opportunity (RFQ_RECEIVED -> JIH).

async function run_lead_scoring(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const svc = ctx.svc;
  const runId = await startAgentRun(svc, "lead_scoring", caller.userId);
  const leads = await readAll((from, to) => svc.from("leads")
    .select("id, project_name, main_contractor_guess, project_stage_estimate, signage_potential, estimated_value, location, source, lead_stage")
    .not("lead_stage", "in", "(converted,rejected)").order("id").range(from,to));
  let created = 0;
  for (const l of leads ?? []) {
    const r = scoreLead(l as Record<string, unknown>);
    await svc.from("lead_scores").insert({
      lead_id: (l as { id: string }).id,
      run_id: runId,
      score: r.score,
      band: r.band,
      reason_codes: r.reason_codes,
      evidence: r.evidence,
      missing_information: r.missing_information,
      next_best_action: r.next_best_action,
    }).throwOnError();
    await svc
      .from("leads")
      .update({ lead_score: r.score })
      .eq("id", (l as { id: string }).id).throwOnError();
    // Only surface a recommendation when there is something to act on.
    if (r.band === "hot" || r.band === "warm" || r.missing_information.length >= 3) {
      const rec = await writeRecommendation(
        svc,
        {
          agent_key: "lead_scoring",
          run_id: runId,
          title: `Lead score ${r.score} (${r.band}) — ${(l as { project_name?: string }).project_name ?? "lead"}`,
          recommendation: r.next_best_action,
          rationale: `Reason codes: ${r.reason_codes.join(", ")}`,
          confidence: r.score,
          severity: r.band === "hot" ? "high" : r.band === "warm" ? "medium" : "low",
          entity_type: "lead",
          entity_id: (l as { id: string }).id,
          suggested_action: "qualify_lead",
          missing_data: r.missing_information,
        },
        r.evidence.map((e) => ({
          label: e.label,
          field: e.field,
          value: e.value,
          source_type: "record",
          source_ref: `leads:${(l as { id: string }).id}`,
          weight: e.weight,
        })),
      );
      if (rec) created++;
    }
  }
  await finishAgentRun(svc, runId, {
    status: "completed",
    records_scanned: (leads ?? []).length,
    recommendations_created: created,
    summary: `Scored ${(leads ?? []).length} leads, ${created} recommendations.`,
  });
  await auditLog(
    svc,
    caller.userId,
    "ai.lead_scoring_run",
    "ai_agent_run",
    runId ?? "lead_scoring",
    { created },
    caller.roles,
  );
  return json({ ok: true, run_id: runId, scored: (leads ?? []).length, recommendations: created });
}

// Duplicate Detection — groups likely-duplicate companies with explanations.
// Never auto-merges.

async function run_duplicate_detection(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const svc = ctx.svc;
  const runId = await startAgentRun(svc, "duplicate_detection", caller.userId);
  const companies = await readAll((from,to) => svc.from("companies")
    .select("id, name, website_domain, cr_number, phone, email").order("id").range(from,to));
  const groups = findDuplicateGroups((companies ?? []) as DupRecord[], "company");
  let created = 0;
  for (const g of groups) {
    const { data: grp } = await svc
      .from("duplicate_groups")
      .insert({
        entity_type: g.entity_type,
        match_reason: g.match_reason,
        matched_fields: g.matched_fields,
        confidence: g.confidence * 100,
        run_id: runId,
      })
      .select("id")
      .single().throwOnError();
    if (!grp) continue;
    await svc.from("duplicate_group_members").insert(
      g.members.map((m) => ({
        group_id: (grp as { id: string }).id,
        entity_type: g.entity_type,
        entity_id: m.entity_id,
        display_label: m.display_label,
      })),
    ).throwOnError();
    await writeRecommendation(
      svc,
      {
        agent_key: "duplicate_detection",
        run_id: runId,
        title: `Possible duplicate: ${g.members.map((m) => m.display_label).join(" / ")}`,
        recommendation: "Review these records and merge if they are the same entity.",
        rationale: g.match_reason,
        confidence: g.confidence * 100,
        severity: g.confidence >= 0.9 ? "high" : "medium",
        entity_type: "company",
        entity_id: g.members[0].entity_id,
        suggested_action: "review_merge",
      },
      g.members.map((m) => ({
        label: "Duplicate member",
        field: g.matched_fields.join(","),
        value: m.display_label,
        source_type: "record",
        source_ref: `companies:${m.entity_id}`,
        weight: g.confidence * 100,
      })),
    );
    created++;
  }
  await finishAgentRun(svc, runId, {
    status: "completed",
    records_scanned: (companies ?? []).length,
    recommendations_created: created,
    summary: `Found ${created} duplicate groups across ${(companies ?? []).length} companies.`,
  });
  await auditLog(
    svc,
    caller.userId,
    "ai.duplicate_detection_run",
    "ai_agent_run",
    runId ?? "dupe",
    { created },
    caller.roles,
  );
  return json({ ok: true, run_id: runId, groups: created });
}

// AI Weekly Report — aggregated from real database data only.

async function generate_ai_weekly_report(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const svc = ctx.svc;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const count = async (q: Promise<{ count: number | null; error: unknown }>) => {
    const result = await q; if (result.error || result.count === null) throw new Error("Required report read failed");
    return result.count;
  };
  const report = {
    new_leads: await count(
      svc
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo) as never,
    ),
    pending_approvals: await count(
      svc
        .from("approvals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending") as never,
    ),
    open_duplicate_groups: await count(
      svc
        .from("duplicate_groups")
        .select("id", { count: "exact", head: true })
        .eq("status", "open") as never,
    ),
    open_risk_flags: await count(
      svc
        .from("opportunity_flags")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("flag_kind", "risk") as never,
    ),
    pending_ai_recommendations: await count(
      svc
        .from("ai_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("status", "open") as never,
    ),
  };
  await auditLog(
    svc,
    caller.userId,
    "ai.weekly_report",
    "system",
    "ai_weekly_report",
    report,
    caller.roles,
  );
  return json({ ok: true, generated_at: new Date().toISOString(), report });
}

// Human decision on an AI recommendation. AI never applies sensitive actions
// itself — accepting a sensitive one opens an approval instead.

async function ai_recommendation_feedback(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { data, error } = await ctx.asCaller.rpc("decide_ai_recommendation", {
    _id: String(payload.recommendationId ?? ""), _action: String(payload.action ?? ""),
    _note: typeof payload.note === "string" ? payload.note : null,
  });
  if (error) return err(error.message, error.code === "42501" ? 403 : 409);
  return json(data);
}

// ----- Agents whose external dependency is not configured (honest scaffolds) -

async function run_data_cleanup(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  return notConfiguredRun(
    ctx.svc,
    "data_cleanup",
    caller.userId,
    "Data Cleanup Agent scaffold — enrichment source not configured.",
  );
}

async function run_project_radar(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  return notConfiguredRun(
    ctx.svc,
    "project_radar",
    caller.userId,
    "Project Radar signal source not configured; use ProTenders manual import.",
  );
}

export const intelligenceModule: HandlerModule = {
  name: "intelligence",
  handlers: {
    accept_recommendation,
    run_lead_scoring,
    run_duplicate_detection,
    generate_ai_weekly_report,
    ai_recommendation_feedback,
    run_data_cleanup,
    run_project_radar,
  },
};
