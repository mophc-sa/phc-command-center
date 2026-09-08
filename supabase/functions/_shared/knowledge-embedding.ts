export const KNOWLEDGE_EMBEDDING_MODEL = "text-embedding-3-small";
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 384;
/** One versioned multilingual vector space. Never mix a fallback model into the index. */
export async function embedKnowledge(
  text: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ embedding: number[]; tokens: number | null }> {
  if (!apiKey) throw new Error("Company knowledge embeddings are not configured");
  if (!text.trim() || text.length > 8000) throw new Error("Embedding text is empty or oversized");
  const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
      input: text,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Company knowledge embedding request failed");
  const data = (await response.json()) as {
    data?: { embedding?: unknown }[];
    usage?: { total_tokens?: number };
  };
  const vector = data.data?.[0]?.embedding;
  if (
    !Array.isArray(vector) ||
    vector.length !== 384 ||
    !vector.every((v) => typeof v === "number" && Number.isFinite(v)) ||
    vector.every((v) => v === 0)
  )
    throw new Error("Invalid company knowledge embedding");
  return { embedding: vector as number[], tokens: data.usage?.total_tokens ?? null };
}
