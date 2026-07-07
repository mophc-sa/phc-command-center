-- =========================================================
-- PHC Sales OS — AI layer: RAG / semantic search (section 9, Knowledge Search)
--
-- Stores embeddings of PHC knowledge (reference projects, BOQ scopes, notes) so
-- the Knowledge Search Agent and the UI can retrieve semantically-similar past
-- work — e.g. suggest case studies for a new project, or compare a new BOQ to
-- old ones. Embeddings are produced by Supabase's built-in `gte-small` model
-- (384 dims) inside the Edge Function — no external embeddings API.
-- =========================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,          -- e.g. reference_project, boq, note
  source_id UUID,                     -- id of the source row, when applicable
  title TEXT,
  content TEXT NOT NULL,
  embedding extensions.vector(384),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Knowledge readable" ON public.knowledge_chunks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Knowledge writable by managers" ON public.knowledge_chunks FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

-- Approximate-nearest-neighbour index for cosine distance.
CREATE INDEX idx_knowledge_embedding ON public.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX idx_knowledge_source ON public.knowledge_chunks(source_type, source_id);

-- Similarity search RPC. Security-definer so the Edge Function (and agents) can
-- retrieve matches; results are already readable to any authenticated user.
CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_embedding extensions.vector(384),
  match_count INT DEFAULT 5,
  filter_source_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  source_type TEXT,
  source_id UUID,
  title TEXT,
  content TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT
    kc.id, kc.source_type, kc.source_id, kc.title, kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_source_type IS NULL OR kc.source_type = filter_source_type)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.match_knowledge TO authenticated, service_role;
