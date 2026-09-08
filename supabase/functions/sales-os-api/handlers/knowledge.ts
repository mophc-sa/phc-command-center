import { embedKnowledge, KNOWLEDGE_EMBEDDING_MODEL } from "../../_shared/knowledge-embedding.ts";
import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err, referenceContent, canManageSalesPipeline } from "../shared.ts";
import { readAll } from "../../_shared/ai-facts.ts";
import { extractKnowledgeDocument } from "../../_shared/knowledge-document.ts";

async function embed(text: string, ctx: SalesOsContext) {
  const { data: reserved } = await ctx.svc
    .rpc("reserve_ai_usage", { _user: ctx.caller.userId, _kind: "knowledge" })
    .throwOnError();
  if (!reserved) throw new Error("Daily knowledge usage limit reached");
  const result = await embedKnowledge(text, Deno.env.get("OPENAI_API_KEY"));
  await ctx.svc
    .from("ai_agent_trace_events")
    .insert({
      trace_id: crypto.randomUUID(),
      requested_by: ctx.caller.userId,
      agent_key: "knowledge_embedding",
      provider: "openai",
      model: KNOWLEDGE_EMBEDDING_MODEL,
      status: "succeeded",
      input_token_count: result.tokens,
      output_token_count: 0,
      metadata: { dimensions: 384, promptVersion: "phc-knowledge.v1" },
    })
    .throwOnError();
  return result.embedding;
}

export function knowledgeChunks(text: string, size = 1200, overlap = 160): string[] {
  if (size <= overlap || overlap < 0) throw new Error("Invalid chunk overlap");
  const result: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    result.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return result;
}
async function publish(id: string, hash: string, ctx: SalesOsContext) {
  const { data: source } = await ctx.asCaller
    .from("ai_knowledge_sources")
    .select("content, content_hash, status")
    .eq("id", id)
    .single()
    .throwOnError();
  if (!source || source.content_hash !== hash || !["approved", "indexed"].includes(source.status))
    throw new Error("Source must be approved first");
  const chunks = [];
  // Bounded concurrency keeps embedding memory within the Edge runtime limit.
  const texts = knowledgeChunks(source.content);
  for (let i = 0; i < texts.length; i += 3) {
    chunks.push(
      ...(await Promise.all(
        texts
          .slice(i, i + 3)
          .map(async (content) => ({ content, embedding: await embed(content, ctx) })),
      )),
    );
  }
  const { data } = await ctx.svc
    .rpc("publish_ai_knowledge", { _id: id, _hash: hash, _chunks: chunks })
    .throwOnError();
  return data as number;
}
async function prepare(type: "document" | "reference_project", id: string, ctx: SalesOsContext) {
  const table = type === "document" ? "documents" : "reference_projects";
  const { data: source } = await ctx.asCaller
    .from(table)
    .select("*")
    .eq("id", id)
    .single()
    .throwOnError();
  if (!source) throw new Error("Source unavailable");
  let content: string;
  let title: string;
  if (type === "reference_project") {
    content =
      referenceContent(source) +
      `\nInternal reference. Shareable with client: ${source.shareable_with_client}. Approval required before external sharing: ${source.requires_approval_to_share}.`;
    title = source.name;
  } else {
    if (source.deleted_at || source.superseded_at) throw new Error("Document is no longer current");
    if (Number(source.size_bytes) > 10 * 1024 * 1024)
      throw new Error("Split documents larger than 10 MB before indexing");
    const { data: blob, error } = await ctx.asCaller.storage
      .from(source.storage_bucket)
      .download(source.storage_path);
    if (error || !blob) throw new Error("Document download failed");
    if (blob.size > 10 * 1024 * 1024) throw new Error("Document exceeds extraction limit");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    title = source.title || source.original_filename;
    content = await extractKnowledgeDocument(bytes, source.mime_type);
  }
  content = content.trim();
  if (!content || content.length > 250000)
    throw new Error(
      "Extraction is empty or exceeds 250,000 characters; split and review the source",
    );
  const { data } = await ctx.svc
    .rpc("prepare_ai_knowledge", {
      _actor: ctx.caller.userId,
      _type: type,
      _source: id,
      _title: title,
      _content: content,
      _updated: source.updated_at,
    })
    .throwOnError();
  return data;
}
async function prepare_knowledge_source(payload: Record<string, unknown>, ctx: SalesOsContext) {
  if (!canManageSalesPipeline(ctx.caller.roles))
    return err("Knowledge review authority required", 403);
  if (!["document", "reference_project"].includes(String(payload.sourceType)))
    return err("Unsupported source type");
  const source = await prepare(
    payload.sourceType as "document" | "reference_project",
    String(payload.sourceId ?? ""),
    ctx,
  );
  return json({ ok: true, source });
}
async function review_knowledge_source(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const id = String(payload.id ?? ""),
    hash = String(payload.hash ?? "");
  const { data, error } = await ctx.asCaller.rpc("review_ai_knowledge", {
    _id: id,
    _hash: hash,
    _decision: String(payload.decision ?? ""),
  });
  if (error) return err(error.message, error.code === "42501" ? 403 : 409);
  const indexed = payload.decision === "approve" ? await publish(id, hash, ctx) : 0;
  return json({ ...data, indexed });
}
async function publish_knowledge_source(payload: Record<string, unknown>, ctx: SalesOsContext) {
  if (!canManageSalesPipeline(ctx.caller.roles))
    return err("Knowledge indexing authority required", 403);
  return json({
    ok: true,
    indexed: await publish(String(payload.id ?? ""), String(payload.hash ?? ""), ctx),
  });
}
async function reindex_reference_library(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  if (!canManageSalesPipeline(ctx.caller.roles))
    return err("Knowledge indexing authority required", 403);
  const refs = await readAll((from, to) =>
    ctx.asCaller.from("reference_projects").select("id").order("id").range(from, to),
  );
  let indexed = 0;
  const failed: { id: string; message: string }[] = [];
  for (const ref of refs) {
    try {
      const s = await prepare("reference_project", ref.id, ctx);
      if (s.status === "indexed") {
        indexed++;
        continue;
      }
      await ctx.asCaller
        .rpc("review_ai_knowledge", { _id: s.id, _hash: s.content_hash, _decision: "approve" })
        .throwOnError();
      await publish(s.id, s.content_hash, ctx);
      indexed++;
    } catch {
      failed.push({ id: ref.id, message: "Source was not indexed; retry or review extraction." });
    }
  }
  return json(
    { ok: failed.length === 0, indexed, total: refs.length, failed },
    failed.length ? 207 : 200,
  );
}
export async function retrieveKnowledge(
  query: string,
  ctx: SalesOsContext,
  count = 6,
  sourceType: string | null = null,
) {
  if (!query.trim() || query.length > 2000)
    throw new Error("Knowledge query must be 1–2,000 characters");
  const vector = await embed(query, ctx);
  const { data } = await ctx.asCaller
    .rpc("match_knowledge", {
      query_embedding: vector,
      match_count: Number.isFinite(count) ? Math.max(1, Math.min(Math.floor(count), 12)) : 6,
      filter_source_type: sourceType,
    })
    .throwOnError();
  return (data ?? []) as {
    id: string;
    source_type: string;
    source_id: string;
    title: string;
    content: string;
    similarity: number;
  }[];
}
async function search_knowledge(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const sourceType = payload.filterSourceType == null ? null : String(payload.filterSourceType);
  if (sourceType !== null && !["document", "reference_project"].includes(sourceType))
    return err("Unsupported source type");
  return json({
    ok: true,
    matches: await retrieveKnowledge(
      String(payload.query ?? ""),
      ctx,
      Number(payload.matchCount ?? 6),
      sourceType,
    ),
  });
}
export const knowledgeModule: HandlerModule = {
  name: "knowledge",
  handlers: {
    prepare_knowledge_source,
    review_knowledge_source,
    publish_knowledge_source,
    reindex_reference_library,
    search_knowledge,
  },
};
