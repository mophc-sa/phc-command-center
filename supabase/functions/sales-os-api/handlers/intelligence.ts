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
  embed,
  chunkText,
  referenceContent,
} from "../shared.ts";
import type { DupRecord } from "../shared.ts";

async function accept_recommendation(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  const recommendationId = String(payload.recommendationId ?? "");
  if (!recommendationId) return err("recommendationId is required");
  const svc = ctx.svc;
  const { data: rec, error: rErr } = await svc
    .from("recommendations")
    .select("id, suggested_owner_id, required_approval_type, related_opportunity_id")
    .eq("id", recommendationId)
    .single();
  if (rErr || !rec) return err("Recommendation not found", 404);

  const isOwner = rec.suggested_owner_id === caller.userId;
  if (!isOwner && !canManageSalesPipeline(caller.roles)) {
    return err("Only the suggested owner or a sales manager can accept this", 403);
  }
  await svc.from("recommendations").update({ status: "accepted" }).eq("id", recommendationId);

  let approval = null;
  if (rec.required_approval_type && rec.related_opportunity_id) {
    const { data: appr } = await svc
      .from("approvals")
      .insert({
        related_opportunity_id: rec.related_opportunity_id,
        approval_type: rec.required_approval_type,
        requested_by: caller.userId,
        status: "pending",
        recommendation: "proceed",
      })
      .select()
      .single();
    approval = appr;
  }
  await auditLog(
    svc,
    caller.userId,
    "recommendation.accepted",
    "recommendation",
    recommendationId,
    {
      approval: rec.required_approval_type ?? null,
    },
    caller.roles,
  );
  return json({ ok: true, approval });
}

// Semantic search over the PHC knowledge base (any authenticated user).

async function search_knowledge(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller } = ctx;
  const query = String(payload.query ?? "").trim();
  if (!query) return err("query is required");
  const matchCount = Number(payload.matchCount ?? 5);
  const filterSourceType = (payload.filterSourceType as string) || null;
  const queryEmbedding = await embed(query);
  const svc = ctx.svc;
  const { data, error } = await svc.rpc("match_knowledge", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_source_type: filterSourceType,
  });
  if (error) return err(error.message, 400);
  return json({ ok: true, matches: data ?? [] });
}

// Index an arbitrary piece of knowledge (managers only).

async function index_knowledge(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const sourceType = String(payload.sourceType ?? "note");
  const content = String(payload.content ?? "").trim();
  if (!content) return err("content is required");
  const sourceId = (payload.sourceId as string) || null;
  const title = (payload.title as string) || null;
  const svc = ctx.svc;
  const rows = chunkText(content).map(async (c) => ({
    source_type: sourceType,
    source_id: sourceId,
    title,
    content: c,
    embedding: await embed(c),
  }));
  const resolved = await Promise.all(rows);
  const { error } = await svc.from("knowledge_chunks").insert(resolved);
  if (error) return err(error.message, 400);
  await auditLog(
    svc,
    caller.userId,
    "knowledge.indexed",
    "knowledge_chunk",
    sourceId ?? sourceType,
    {
      chunks: resolved.length,
    },
    caller.roles,
  );
  return json({ ok: true, indexed: resolved.length });
}

// (Re)build the index for the Project Reference Library (managers only).

async function reindex_reference_library(
  _payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canManageSalesPipeline(caller.roles)) return err("Sales pipeline role required", 403);
  const svc = ctx.svc;
  const { data: refs, error: rErr } = await svc.from("reference_projects").select("*");
  if (rErr) return err(rErr.message, 400);
  // Replace any existing reference-project chunks.
  await svc.from("knowledge_chunks").delete().eq("source_type", "reference_project");
  let indexed = 0;
  for (const r of refs ?? []) {
    const content = referenceContent(r as Record<string, unknown>);
    if (!content) continue;
    const embedding = await embed(content);
    const { error } = await svc.from("knowledge_chunks").insert({
      source_type: "reference_project",
      source_id: (r as { id: string }).id,
      title: (r as { name: string }).name,
      content,
      embedding,
    });
    if (!error) indexed++;
  }
  await auditLog(
    svc,
    caller.userId,
    "knowledge.reindexed",
    "knowledge_chunk",
    "reference_library",
    {
      indexed,
    },
    caller.roles,
  );
  return json({ ok: true, indexed });
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
  const { data: leads } = await svc
    .from("leads")
    .select(
      "id, project_name, main_contractor_guess, project_stage_estimate, signage_potential, estimated_value, location, source, lead_stage",
    )
    .not("lead_stage", "in", "(converted,rejected)");
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
    });
    await svc
      .from("leads")
      .update({ lead_score: r.score })
      .eq("id", (l as { id: string }).id);
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
  const { data: companies } = await svc
    .from("companies")
    .select("id, name, website_domain, cr_number, phone, email");
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
      .single();
    if (!grp) continue;
    await svc.from("duplicate_group_members").insert(
      g.members.map((m) => ({
        group_id: (grp as { id: string }).id,
        entity_type: g.entity_type,
        entity_id: m.entity_id,
        display_label: m.display_label,
      })),
    );
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
  const count = async (q: Promise<{ count: number | null }>) => (await q).count ?? 0;
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
        .eq("status", "pending") as never,
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
  const { caller, audit: auditLog } = ctx;
  const recommendationId = String(payload.recommendationId ?? "");
  const action = String(payload.action ?? "");
  const valid = ["accept", "dismiss", "request_review", "create_task", "create_approval"];
  if (!recommendationId || !valid.includes(action))
    return err("recommendationId and a valid action are required");
  const svc = ctx.svc;
  const { data: rec } = await svc
    .from("ai_recommendations")
    .select("*")
    .eq("id", recommendationId)
    .single();
  if (!rec) return err("Recommendation not found", 404);

  const statusMap: Record<string, string> = {
    accept: "accepted",
    dismiss: "dismissed",
    request_review: "review_requested",
    create_task: "actioned",
    create_approval: "review_requested",
  };
  await svc
    .from("ai_recommendations")
    .update({ status: statusMap[action] })
    .eq("id", recommendationId);
  await svc.from("ai_agent_feedback").insert({
    recommendation_id: recommendationId,
    user_id: caller.userId,
    action,
    note: (payload.note as string) ?? null,
  });

  // If acting is sensitive, spawn an approval rather than applying anything.
  let approval = null;
  if (action === "create_approval" || (action === "accept" && rec.required_approval_type)) {
    const { data: appr } = await svc
      .from("approvals")
      .insert({
        related_opportunity_id: rec.entity_type === "opportunity" ? rec.entity_id : null,
        approval_type: rec.required_approval_type ?? "ai_recommendation",
        requested_by: caller.userId,
        status: "pending",
        recommendation: "management_review",
        decision_notes: rec.title,
        linked_record_type: rec.entity_type,
        linked_record_id: rec.entity_id,
      })
      .select()
      .single();
    approval = appr;
  }
  await auditLog(
    svc,
    caller.userId,
    `ai_recommendation.${action}`,
    "ai_recommendation",
    recommendationId,
    {
      approval: approval?.id ?? null,
    },
    caller.roles,
  );
  return json({ ok: true, status: statusMap[action], approval });
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
    search_knowledge,
    index_knowledge,
    reindex_reference_library,
    run_lead_scoring,
    run_duplicate_detection,
    generate_ai_weekly_report,
    ai_recommendation_feedback,
    run_data_cleanup,
    run_project_radar,
  },
};
