import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err, canManageSalesPipeline } from "../shared.ts";
import { readAll } from "../../_shared/ai-facts.ts";
import { resolveProviderConfig } from "../../_shared/ai-providers.ts";
import { groundedModel } from "../../_shared/ai-grounding.ts";
async function ai_operations_status(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const [sources, documents, limits, usage] = await Promise.all([
    readAll((from, to) =>
      ctx.asCaller.from("ai_knowledge_catalog").select("*").order("id").range(from, to),
    ),
    readAll((from, to) =>
      ctx.asCaller
        .from("documents")
        .select("id,title,original_filename,mime_type,updated_at")
        .is("deleted_at", null)
        .is("superseded_at", null)
        .order("id")
        .range(from, to),
    ),
    ctx.asCaller.from("ai_usage_limits").select("*").throwOnError(),
    ctx.asCaller
      .from("ai_usage_daily")
      .select("kind,calls,day")
      .eq("user_id", ctx.caller.userId)
      .eq("day", new Date().toISOString().slice(0, 10))
      .throwOnError(),
  ]);
  const provider = resolveProviderConfig((k) => Deno.env.get(k), null, false);
  const { data: runs } = canManageSalesPipeline(ctx.caller.roles)
    ? await ctx.asCaller
        .from("ai_quality_runs")
        .select(
          "id,request_id,case_key,language,provider,model,status,checks,error_code,duration_ms,input_tokens,output_tokens,estimated_cost_usd,cost_basis,output,usefulness,review_note,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(60)
        .throwOnError()
    : { data: [] };
  return json({
    ok: true,
    sources,
    documents,
    limits: limits.data,
    usage: usage.data,
    runs,
    provider: provider.ok
      ? { configured: true, provider: provider.config.provider, model: provider.config.model, knowledge_model: groundedModel("company_knowledge", provider.config.provider, provider.config.model) }
      : { configured: false },
    as_of: new Date().toISOString(),
  });
}
async function ai_knowledge_source_detail(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const { data, error } = await ctx.asCaller
    .from("ai_knowledge_sources")
    .select("*")
    .eq("id", String(payload.id ?? ""))
    .single();
  if (error || !data) return err("Knowledge source unavailable", 404);
  return json({ ok: true, source: data });
}
export const aiStatusModule: HandlerModule = {
  name: "ai-status",
  handlers: { ai_operations_status, ai_knowledge_source_detail },
};
