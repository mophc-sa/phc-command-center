import { z } from "zod";
import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import { canCreateSalesRecords } from "../../_shared/roles.ts";
import { readAll } from "../../_shared/ai-facts.ts";
import { buildDailyAssistant } from "../../_shared/ai-daily.ts";
import {
  GroundedAnswerSchema,
  GROUNDED_PROMPT,
  verifyCitations,
  draftHasUnsupportedCompletion,
  type AiCitation,
} from "../../_shared/ai-grounding.ts";
import { generateStructured, resolveProviderConfig } from "../../_shared/ai-providers.ts";
import {
  delimitUntrustedContext,
  scanForGuardrailViolations,
} from "../../_shared/ai-guardrails.ts";
import { retrieveKnowledge } from "./knowledge.ts";

export async function loadDaily(ctx: SalesOsContext, language: "ar" | "en") {
  const db = ctx.asCaller,
    u = ctx.caller.userId;
  const [opportunities, followups, rfqs] = await Promise.all([
    readAll((from, to) =>
      db
        .from("opportunities")
        .select("id,updated_at,project_name,stage,sales_stage,next_action,next_action_due")
        .eq("owner_id", u)
        .neq("stage", "archived")
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      db
        .from("follow_ups")
        .select("id,updated_at,opportunity_id,due_date,notes,channel")
        .eq("owner_id", u)
        .not("status", "in", "(completed,cancelled)")
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      db
        .from("rfqs")
        .select(
          "id,updated_at,rfq_number,opportunity_id,response_due_date,company_id,contact_id,document_url,document_storage_path,estimated_signage_value",
        )
        .or(`sales_owner_id.eq.${u},assigned_to.eq.${u}`)
        .in("status", ["open", "on_hold"])
        .is("archived_at", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  // Assigned follow-ups remain the employee's work even when the deal owner
  // is a colleague. Load their parent through caller RLS, never service access.
  const opportunityIds = new Set(opportunities.map((o) => o.id));
  const assignedIds = [
    ...new Set(
      followups.map((f) => f.opportunity_id).filter((id) => id && !opportunityIds.has(id)),
    ),
  ];
  for (let i = 0; i < assignedIds.length; i += 100) {
    const linked = await readAll((from, to) =>
      db
        .from("opportunities")
        .select("id,updated_at,project_name,stage,sales_stage,next_action,next_action_due")
        .in("id", assignedIds.slice(i, i + 100))
        .neq("stage", "archived")
        .order("id")
        .range(from, to),
    );
    opportunities.push(...linked);
  }
  const ownBoqs = await readAll((from, to) =>
    db
      .from("boqs")
      .select("id,updated_at,title,related_opportunity_id,missing_items,assumptions")
      .eq("created_by", u)
      .order("id")
      .range(from, to),
  );
  const boqMap = new Map(ownBoqs.map((b) => [b.id, b]));
  for (let i = 0; i < opportunities.length; i += 100) {
    const linked = await readAll((from, to) =>
      db
        .from("boqs")
        .select("id,updated_at,title,related_opportunity_id,missing_items,assumptions")
        .in(
          "related_opportunity_id",
          opportunities.slice(i, i + 100).map((o) => o.id),
        )
        .order("id")
        .range(from, to),
    );
    for (const b of linked) boqMap.set(b.id, b);
  }
  const boqs = [...boqMap.values()];
  const boqItems = [];
  for (let i = 0; i < boqs.length; i += 100) {
    const ids = boqs.slice(i, i + 100).map((b) => b.id);
    const [items, costs] = await Promise.all([
      readAll((from, to) =>
        db
          .from("boq_items")
          .select("id,boq_id,sign_type,quantity,material")
          .in("boq_id", ids)
          .order("id")
          .range(from, to),
      ),
      readAll((from, to) =>
        db
          .from("boq_item_costs")
          .select("id,unit_rate")
          .in("boq_id", ids)
          .order("id")
          .range(from, to),
      ),
    ]);
    const rates = new Map(costs.map((c) => [c.id, c.unit_rate]));
    boqItems.push(
      ...items.map((item) => ({
        ...item,
        ...(rates.has(item.id) ? { unit_rate: rates.get(item.id) } : {}),
      })),
    );
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return buildDailyAssistant({ opportunities, followups, rfqs, boqs, boqItems }, language, today);
}
async function daily_assistant(payload: Record<string, unknown>, ctx: SalesOsContext) {
  if (!canCreateSalesRecords(ctx.caller.roles)) return err("Employee sales access required", 403);
  return json({ ok: true, ...(await loadDaily(ctx, payload.language === "ar" ? "ar" : "en")) });
}
async function approve_daily_task(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data, error } = await ctx.asCaller.rpc("approve_ai_daily_task", {
    _source_type: payload.sourceType,
    _source_id: payload.sourceId,
    _source_updated_at: payload.sourceUpdatedAt,
    _title: payload.title,
    _due: payload.due ?? null,
  });
  if (error) return err(error.message, error.code === "42501" ? 403 : 409);
  return json(data);
}
async function groundedAnswer(
  query: string,
  language: "ar" | "en",
  sources: AiCitation[],
  kind: string,
  ctx: SalesOsContext,
) {
  if (query.length < 1 || query.length > 2000) return err("Request must be 1–2,000 characters");
  if (!sources.length)
    return json({
      ok: true,
      result: {
        claims: [],
        questions: [],
        suggested_tasks: [],
        draft: null,
        insufficient_evidence: true,
      },
      sources: [],
      as_of: new Date().toISOString(),
    });
  const configured = resolveProviderConfig((k) => Deno.env.get(k), null, false);
  if (!configured.ok) return err("AI service is not configured", 503);
  const { data: reserved } = await ctx.svc
    .rpc("reserve_ai_usage", { _user: ctx.caller.userId, _kind: "interactive" })
    .throwOnError();
  if (!reserved) return err("AI daily usage limit reached", 429);
  const trace = crypto.randomUUID(),
    start = Date.now();
  const traceBase = {
    trace_id: trace,
    requested_by: ctx.caller.userId,
    agent_key: kind,
    provider: configured.config.provider,
    model: configured.config.model,
  };
  await ctx.svc
    .from("ai_agent_trace_events")
    .insert({ ...traceBase, status: "started", metadata: { promptVersion: "phc-grounded.v3" } })
    .throwOnError();
  const response = await generateStructured(configured.config, {
    systemPrompt: GROUNDED_PROMPT,
    userPrompt: delimitUntrustedContext(
      "sources",
      JSON.stringify({ current_date: new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Riyadh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()), language, request: query, sources }),
    ),
    schemaName: "phc_grounded_answer",
    jsonSchema: z.toJSONSchema(GroundedAnswerSchema),
    traceId: trace,
    maxOutputTokens: 2400,
  });
  const parsed = response.ok ? GroundedAnswerSchema.safeParse(response.data) : null;
  if (
    !response.ok ||
    !parsed?.success ||
    !verifyCitations(parsed.data, sources) ||
    draftHasUnsupportedCompletion(parsed.data) ||
    scanForGuardrailViolations(parsed.data).length
  ) {
    await ctx.svc
      .from("ai_agent_trace_events")
      .insert({
        ...traceBase,
        status: "failed",
        duration_ms: Date.now() - start,
        error_code: response.ok ? "AI_GROUNDING_FAILED" : response.code,
      })
      .throwOnError();
    return err("A grounded answer could not be verified. No task or message was created.", 502);
  }
  await ctx.svc
    .from("ai_agent_trace_events")
    .insert({
      ...traceBase,
      status: "succeeded",
      duration_ms: Date.now() - start,
      input_token_count: response.usage?.inputTokens,
      output_token_count: response.usage?.outputTokens,
      context_manifest: { source_count: sources.length },
      metadata: { promptVersion: "phc-grounded.v3" },
    })
    .throwOnError();
  return json({
    ok: true,
    traceId: trace,
    result: parsed.data,
    sources,
    model: response.model,
    as_of: new Date().toISOString(),
  });
}
async function ask_company_knowledge(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const query = String(payload.query ?? "");
  return await groundedAnswer(
    query,
    /\p{Script=Arabic}/u.test(query) || payload.language === "ar" ? "ar" : "en",
    await retrieveKnowledge(query, ctx, 12),
    "company_knowledge",
    ctx,
  );
}
async function prepare_ai_meeting(payload: Record<string, unknown>, ctx: SalesOsContext) {
  if (!canCreateSalesRecords(ctx.caller.roles)) return err("Employee sales access required", 403);
  const id = String(payload.opportunityId ?? "");
  const { data: opp } = await ctx.asCaller
    .from("opportunities")
    .select(
      "id,project_name,sales_stage,stage,contract_value,quotation_value,estimated_value_max,currency,next_action,next_action_due,main_contractor,updated_at",
    )
    .eq("id", id)
    .single()
    .throwOnError();
  if (!opp || opp.stage === "archived") return err("Opportunity unavailable", 404);
  const [followups, rfqs, boqs] = await Promise.all([
    readAll((from, to) =>
      ctx.asCaller
        .from("follow_ups")
        .select("id,due_date,status,channel,notes,last_contact_at")
        .eq("opportunity_id", id)
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      ctx.asCaller
        .from("rfqs")
        .select("id,rfq_number,status,response_due_date,notes")
        .eq("opportunity_id", id)
        .is("archived_at", null)
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      ctx.asCaller
        .from("boqs")
        .select("id,title,status,assumptions,missing_items")
        .eq("related_opportunity_id", id)
        .order("id")
        .range(from, to),
    ),
  ]);
  const sources: AiCitation[] = [
    {
      id: `opportunity:${id}`,
      source_type: "opportunity",
      source_id: id,
      title: opp.project_name,
      content: JSON.stringify(opp),
    },
    ...followups
      .sort((a, b) => String(b.due_date ?? "").localeCompare(String(a.due_date ?? "")))
      .slice(0, 8)
      .map((f) => ({
        id: `follow_up:${f.id}`,
        source_type: "follow_up",
        source_id: f.id,
        title: "Follow-up",
        content: JSON.stringify(f),
      })),
    ...rfqs.slice(0, 4).map((r) => ({
      id: `rfq:${r.id}`,
      source_type: "rfq",
      source_id: r.id,
      title: r.rfq_number,
      content: JSON.stringify(r),
    })),
    ...boqs.slice(0, 4).map((b) => ({
      id: `boq:${b.id}`,
      source_type: "boq",
      source_id: b.id,
      title: b.title,
      content: JSON.stringify(b),
    })),
  ];
  const instruction =
    payload.language === "ar"
      ? "جهّز ملخص اجتماع لهذه الفرصة: الوقائع، الأسئلة، النواقص، المهام المقترحة، ومسودة متابعة عربية للمراجعة فقط."
      : "Prepare this opportunity meeting: facts, questions, gaps, suggested tasks and an English follow-up draft for review only.";
  return await groundedAnswer(
    instruction +
      ` Context is a bounded sample: ${followups.length} follow-ups, ${rfqs.length} RFQs, ${boqs.length} BOQs exist; only listed sources were supplied.`,
    payload.language === "ar" ? "ar" : "en",
    sources,
    "daily_meeting_brief",
    ctx,
  );
}
export const dailyAssistantModule: HandlerModule = {
  name: "daily-assistant",
  handlers: { daily_assistant, approve_daily_task, ask_company_knowledge, prepare_ai_meeting },
};
