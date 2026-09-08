GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;
-- Source approval belongs to an exact extracted version. Retrieval rechecks the
-- live source and permissions, including after reassignment/deletion/revocation.
CREATE TABLE public.ai_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK(source_type IN ('reference_project','document')),
  source_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL CHECK(length(content) BETWEEN 1 AND 250000),
  content_hash text NOT NULL,
  source_updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','approved','indexed','revoked')),
  approved_by uuid REFERENCES auth.users(id), approved_at timestamptz,
  approved_hash text, indexed_at timestamptz, chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type,source_id)
);
ALTER TABLE public.ai_knowledge_sources ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_knowledge_sources TO authenticated;
GRANT ALL ON public.ai_knowledge_sources TO service_role;

CREATE FUNCTION public.can_read_ai_knowledge_source(_type text,_id uuid,_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_active_user(_user) AND CASE _type
   WHEN 'reference_project' THEN EXISTS(SELECT 1 FROM public.reference_projects WHERE id=_id)
   WHEN 'document' THEN EXISTS(SELECT 1 FROM public.documents WHERE id=_id AND deleted_at IS NULL AND superseded_at IS NULL)
     AND public.can_read_document(_id,_user)
   ELSE false END;
$$;
REVOKE ALL ON FUNCTION public.can_read_ai_knowledge_source(text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_ai_knowledge_source(text,uuid,uuid) TO authenticated,service_role;
CREATE POLICY knowledge_source_reader ON public.ai_knowledge_sources FOR SELECT TO authenticated
 USING(public.has_app_access(auth.uid()) AND public.can_read_ai_knowledge_source(source_type,source_id,auth.uid()));

CREATE FUNCTION public.ai_knowledge_source_current(_type text,_id uuid,_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE _type
   WHEN 'reference_project' THEN EXISTS(SELECT 1 FROM public.reference_projects WHERE id=_id AND updated_at=_at)
   WHEN 'document' THEN EXISTS(SELECT 1 FROM public.documents WHERE id=_id AND updated_at=_at AND deleted_at IS NULL AND superseded_at IS NULL)
   ELSE false END;
$$;
REVOKE ALL ON FUNCTION public.ai_knowledge_source_current(text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ai_knowledge_source_current(text,uuid,timestamptz) TO authenticated,service_role;

CREATE FUNCTION public.prepare_ai_knowledge(_actor uuid,_type text,_source uuid,_title text,_content text,_updated timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE s public.ai_knowledge_sources; h text; BEGIN
 IF NOT public.is_pipeline_operator(_actor) OR NOT public.can_read_ai_knowledge_source(_type,_source,_actor)
   OR NOT public.ai_knowledge_source_current(_type,_source,_updated) THEN RAISE EXCEPTION 'Knowledge source unavailable' USING ERRCODE='42501'; END IF;
 h := encode(digest(_content,'sha256'),'hex');
 INSERT INTO public.ai_knowledge_sources(source_type,source_id,title,content,content_hash,source_updated_at)
 VALUES(_type,_source,_title,_content,h,_updated)
 ON CONFLICT(source_type,source_id) DO UPDATE SET title=excluded.title,content=excluded.content,content_hash=excluded.content_hash,
   source_updated_at=excluded.source_updated_at,status='pending_review',approved_by=NULL,approved_at=NULL,approved_hash=NULL,updated_at=now()
 WHERE ai_knowledge_sources.content_hash IS DISTINCT FROM excluded.content_hash
    OR ai_knowledge_sources.source_updated_at IS DISTINCT FROM excluded.source_updated_at;
 SELECT * INTO s FROM public.ai_knowledge_sources WHERE source_type=_type AND source_id=_source;
 RETURN to_jsonb(s);
END $$;
REVOKE ALL ON FUNCTION public.prepare_ai_knowledge(uuid,text,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_ai_knowledge(uuid,text,uuid,text,text,timestamptz) TO service_role;

CREATE FUNCTION public.review_ai_knowledge(_id uuid,_hash text,_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.ai_knowledge_sources; u uuid:=auth.uid(); BEGIN
 IF NOT public.has_app_access(u) OR NOT public.is_pipeline_operator(u) THEN RAISE EXCEPTION 'Knowledge review authority required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.ai_knowledge_sources WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR NOT public.can_read_ai_knowledge_source(s.source_type,s.source_id,u) THEN RAISE EXCEPTION 'Source unavailable' USING ERRCODE='42501'; END IF;
 IF _decision IS NULL OR _decision NOT IN ('approve','revoke') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 IF _decision='approve' AND (s.content_hash IS DISTINCT FROM _hash OR NOT public.ai_knowledge_source_current(s.source_type,s.source_id,s.source_updated_at)) THEN
   RAISE EXCEPTION 'Source changed; extract and review again'; END IF;
 UPDATE public.ai_knowledge_sources SET status=CASE _decision WHEN 'approve' THEN 'approved' ELSE 'revoked' END,
   approved_hash=CASE WHEN _decision='approve' THEN s.content_hash END,approved_by=u,approved_at=now(),updated_at=now() WHERE id=s.id;
 INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
   VALUES(u,'user','knowledge.'||_decision,'ai_knowledge_source',s.id,jsonb_build_object('hash',s.content_hash));
 RETURN jsonb_build_object('ok',true,'id',s.id,'decision',_decision);
END $$;
REVOKE ALL ON FUNCTION public.review_ai_knowledge(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_ai_knowledge(uuid,text,text) TO authenticated;

ALTER TABLE public.knowledge_chunks ADD COLUMN knowledge_source_id uuid REFERENCES public.ai_knowledge_sources(id);
ALTER TABLE public.knowledge_chunks ADD COLUMN content_hash text;
ALTER TABLE public.knowledge_chunks ADD COLUMN chunk_index integer;
CREATE UNIQUE INDEX ai_knowledge_chunk_version ON public.knowledge_chunks(knowledge_source_id,content_hash,chunk_index);
-- Close both the old broad SELECT and direct write paths before populating.
DROP POLICY IF EXISTS "Knowledge readable" ON public.knowledge_chunks;
CREATE POLICY knowledge_approved_reader ON public.knowledge_chunks FOR SELECT TO authenticated USING(
 public.has_app_access(auth.uid()) AND EXISTS(SELECT 1 FROM public.ai_knowledge_sources s
 WHERE s.id=knowledge_source_id AND s.status='indexed' AND s.approved_hash=s.content_hash
   AND s.content_hash=knowledge_chunks.content_hash
   AND public.can_read_ai_knowledge_source(s.source_type,s.source_id,auth.uid())
   AND public.ai_knowledge_source_current(s.source_type,s.source_id,s.source_updated_at)));
REVOKE INSERT,UPDATE,DELETE ON public.knowledge_chunks FROM authenticated;

CREATE FUNCTION public.publish_ai_knowledge(_id uuid,_hash text,_chunks jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE s public.ai_knowledge_sources; c jsonb; n integer:=0; BEGIN
 SELECT * INTO s FROM public.ai_knowledge_sources WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR s.status NOT IN ('approved','indexed') OR s.approved_hash IS DISTINCT FROM _hash OR s.content_hash IS DISTINCT FROM _hash
   OR NOT public.ai_knowledge_source_current(s.source_type,s.source_id,s.source_updated_at) THEN RAISE EXCEPTION 'Source not approved or changed'; END IF;
 IF jsonb_typeof(_chunks) IS DISTINCT FROM 'array' OR jsonb_array_length(_chunks) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid chunk set'; END IF;
 DELETE FROM public.knowledge_chunks WHERE knowledge_source_id=s.id;
 FOR c IN SELECT * FROM jsonb_array_elements(_chunks) LOOP
   IF length(coalesce(c->>'content',''))=0 OR position(c->>'content' IN s.content)=0
     OR jsonb_typeof(c->'embedding') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'embedding') IS DISTINCT FROM 384 THEN RAISE EXCEPTION 'Invalid source chunk'; END IF;
   INSERT INTO public.knowledge_chunks(knowledge_source_id,source_type,source_id,title,content,embedding,content_hash,chunk_index,metadata)
     VALUES(s.id,s.source_type,s.source_id,s.title,c->>'content',(c->>'embedding')::extensions.vector(384),s.content_hash,n,
       jsonb_build_object('approved_at',s.approved_at,'source_updated_at',s.source_updated_at,'embedding_model','text-embedding-3-small','dimensions',384));
   n:=n+1;
 END LOOP;
 UPDATE public.ai_knowledge_sources SET status='indexed',chunk_count=n,indexed_at=now(),updated_at=now() WHERE id=s.id;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.publish_ai_knowledge(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_ai_knowledge(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.match_knowledge(query_embedding extensions.vector(384),match_count integer DEFAULT 5,filter_source_type text DEFAULT NULL)
RETURNS TABLE(id uuid,source_type text,source_id uuid,title text,content text,similarity double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,extensions AS $$
 SELECT kc.id,kc.source_type,kc.source_id,kc.title,kc.content,1-(kc.embedding <=> query_embedding)
 FROM public.knowledge_chunks kc WHERE kc.embedding IS NOT NULL AND kc.metadata->>'embedding_model'='text-embedding-3-small' AND (filter_source_type IS NULL OR kc.source_type=filter_source_type)
 ORDER BY kc.embedding <=> query_embedding LIMIT greatest(1,least(coalesce(match_count,5),20));
$$;
REVOKE ALL ON FUNCTION public.match_knowledge(extensions.vector,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.match_knowledge(extensions.vector,integer,text) TO authenticated;

CREATE VIEW public.ai_knowledge_catalog WITH (security_invoker=true) AS
 SELECT id,source_type,source_id,title,content_hash,source_updated_at,status,approved_by,approved_at,indexed_at,chunk_count,updated_at,
   public.ai_knowledge_source_current(source_type,source_id,source_updated_at) AS is_current
 FROM public.ai_knowledge_sources;
GRANT SELECT ON public.ai_knowledge_catalog TO authenticated;
