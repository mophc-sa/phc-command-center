import { callBackend } from "@/lib/backend";

// Semantic search over the PHC knowledge base. Embedding + similarity search run
// server-side in the sales-os-api Edge Function (Supabase gte-small + pgvector).
export type KnowledgeMatch = {
  id: string;
  source_type: string;
  source_id: string | null;
  title: string | null;
  content: string;
  similarity: number;
};

export async function searchKnowledge(
  query: string,
  opts?: { matchCount?: number; filterSourceType?: string | null },
): Promise<KnowledgeMatch[]> {
  const res = await callBackend<{ matches: KnowledgeMatch[] }>("search_knowledge", {
    query,
    matchCount: opts?.matchCount ?? 5,
    filterSourceType: opts?.filterSourceType ?? null,
  });
  return res.matches ?? [];
}

export async function reindexReferenceLibrary(): Promise<{ indexed: number }> {
  return await callBackend<{ indexed: number }>("reindex_reference_library", {});
}
