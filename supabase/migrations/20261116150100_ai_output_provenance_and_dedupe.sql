-- =============================================================================
-- AI outputs: one live suggestion per question, and where each one came from.
--
-- Found 2026-11-16 (production, read-only): 609 ai_agent_outputs in
-- pending_review, 501 of them sales_report_insights for the one "reports"
-- entity — the Command Center brief re-ran the model on every 15-minute refresh
-- and every run stayed "pending" forever. 'superseded' has been an allowed
-- status since 20260711180000 and had never been written once.
--
-- 1. ai_agent_outputs gains model, provider, prompt_version and source_refs
--    (until now the model was only in ai_agent_trace_events), so a screen can
--    say "made <date> with <model> from <these records>".
-- 2. Backfill: for each (agent_key, entity_type, entity_id, requested_by) only
--    the newest pending_review row stays pending; the older ones become
--    'superseded'. Nothing is deleted; accepted/rejected rows are untouched.
-- 3. A partial unique index keeps it that way, and store_ai_agent_output() is
--    the one write path: it supersedes the previous pending row and inserts the
--    new one under an advisory lock, so two concurrent runs cannot both stay
--    pending (the second would otherwise trip the index).
-- 4. ai_recommendations: one OPEN recommendation per (agent_key, entity_type,
--    entity_id, suggested_action). create_ai_recommendation() now refreshes the
--    open one — its evidence, missing data and updated_at; the advice text stays
--    immutable per ai_recommendation_guard — instead of adding a twin on every scan. Production has no open duplicates today (checked
--    2026-11-16), so the index needs no backfill.
-- 5. inbox_items.ai_extracted_fields: which intake fields info_mail_create_intake
--    filled from the AI's reading of the email, so the review queue can label
--    them "AI suggestion — verify". The function is 20261025100000's, with only
--    that column added.
-- =============================================================================

-- 1. Provenance columns.
ALTER TABLE public.ai_agent_outputs
  ADD COLUMN IF NOT EXISTS model          text,
  ADD COLUMN IF NOT EXISTS provider       text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS source_refs    jsonb;

-- 2. Backfill: newest pending row per key wins.
UPDATE public.ai_agent_outputs o
   SET status = 'superseded'
  FROM (
    SELECT id, row_number() OVER (
             PARTITION BY agent_key, entity_type, entity_id, requested_by
             ORDER BY created_at DESC, id DESC) AS rn
      FROM public.ai_agent_outputs
     WHERE status = 'pending_review'
  ) x
 WHERE o.id = x.id AND x.rn > 1;

-- 3. One pending row per key (NULLS NOT DISTINCT: a service caller and the
--    aggregate entities still count as one key).
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_outputs_one_pending
  ON public.ai_agent_outputs (agent_key, entity_type, entity_id, requested_by) NULLS NOT DISTINCT
  WHERE status = 'pending_review';

CREATE OR REPLACE FUNCTION public.store_ai_agent_output(_row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _agent   text := _row->>'agent_key';
  _etype   text := _row->>'entity_type';
  _eid     uuid := (_row->>'entity_id')::uuid;
  _by      uuid := (_row->>'requested_by')::uuid;
  _id      uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws('|', 'ai_output', _agent, _etype, _eid, _by), 0));
  UPDATE public.ai_agent_outputs SET status = 'superseded'
   WHERE status = 'pending_review' AND agent_key = _agent
     AND entity_type IS NOT DISTINCT FROM _etype
     AND entity_id IS NOT DISTINCT FROM _eid
     AND requested_by IS NOT DISTINCT FROM _by;
  INSERT INTO public.ai_agent_outputs (trace_id, agent_key, output_type, entity_type, entity_id, requested_by,
                                       status, structured_output, summary, client_request_id,
                                       model, provider, prompt_version, source_refs)
  VALUES ((_row->>'trace_id')::uuid, _agent, _row->>'output_type', _etype, _eid, _by,
          'pending_review', _row->'structured_output', _row->>'summary', _row->>'client_request_id',
          _row->>'model', _row->>'provider', _row->>'prompt_version', _row->'source_refs')
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.store_ai_agent_output(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_ai_agent_output(jsonb) TO service_role;

-- 4. Recommendations: refresh the open one rather than adding a twin.
CREATE UNIQUE INDEX IF NOT EXISTS ai_recommendations_one_open
  ON public.ai_recommendations (agent_key, entity_type, entity_id, suggested_action) NULLS NOT DISTINCT
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.create_ai_recommendation(_rec jsonb, _evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.ai_recommendations; BEGIN
  IF jsonb_typeof(_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(_evidence) < 1 OR jsonb_array_length(_evidence) > 50 THEN
    RAISE EXCEPTION 'A recommendation requires bounded evidence'; END IF;
  INSERT INTO public.ai_recommendations(agent_key,run_id,title,recommendation,rationale,confidence,severity,
    entity_type,entity_id,suggested_action,required_approval_type,missing_data,status)
  VALUES(_rec->>'agent_key',(_rec->>'run_id')::uuid,_rec->>'title',_rec->>'recommendation',_rec->>'rationale',
    (_rec->>'confidence')::numeric,_rec->>'severity',_rec->>'entity_type',(_rec->>'entity_id')::uuid,
    _rec->>'suggested_action',_rec->>'required_approval_type',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(_rec->'missing_data','[]'))),'open')
  -- 20261116150100: the same open suggestion is refreshed, not repeated. Its
  -- wording stays as first generated (ai_recommendation_guard keeps the advice
  -- immutable); what is refreshed is the evidence, the missing data and the time.
  ON CONFLICT (agent_key, entity_type, entity_id, suggested_action) WHERE status = 'open'
  DO UPDATE SET missing_data = EXCLUDED.missing_data, updated_at = now()
  RETURNING * INTO r;
  DELETE FROM public.ai_evidence_items WHERE recommendation_id = r.id;
  INSERT INTO public.ai_evidence_items(recommendation_id,label,field,value,source_type,source_ref,source_url,weight)
    SELECT r.id,e->>'label',e->>'field',e->>'value',e->>'source_type',e->>'source_ref',e->>'source_url',(e->>'weight')::numeric
      FROM jsonb_array_elements(_evidence) e;
  RETURN to_jsonb(r);
END $function$;

-- 5. Intake fields the AI filled in.
ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS ai_extracted_fields text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.inbox_items.ai_extracted_fields IS
  'inbox_items columns whose value came from the AI reading of the source email (info_mail_create_intake). The review queue labels them "AI suggestion — verify".';

CREATE OR REPLACE FUNCTION public.info_mail_create_intake(_mail_id uuid, _fields jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.info_mail;
  f jsonb := CASE WHEN jsonb_typeof(_fields) = 'object' THEN _fields ELSE '{}'::jsonb END;
  owner uuid;
  item uuid;
  value_text text := btrim(coalesce(f->>'estimated_value', ''));
  deadline_text text := btrim(coalesce(f->>'deadline', ''));
  deadline_val date;
  notes text;
  ai_fields text[];
BEGIN
  SELECT * INTO m FROM public.info_mail WHERE id = _mail_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'info mail not found' USING ERRCODE = 'P0002'; END IF;
  IF m.inbox_item_id IS NOT NULL THEN RETURN m.inbox_item_id; END IF;

  owner := public.info_mail_owner_for(m.from_email);
  IF deadline_text ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN deadline_val := deadline_text::date; EXCEPTION WHEN others THEN deadline_val := NULL; END;
  END IF;
  notes := concat_ws(E'\n',
    'From info@: ' || coalesce(m.summary, m.subject, ''),
    CASE WHEN cardinality(m.attachment_names) > 0
         THEN 'Attachments: ' || array_to_string(m.attachment_names, ', ') END);

  -- 20261116150100: the columns whose value is the AI's reading, not the mail headers.
  ai_fields := array_remove(ARRAY[
    CASE WHEN nullif(btrim(f->>'company'), '') IS NOT NULL THEN 'company_name' END,
    CASE WHEN nullif(btrim(f->>'contact_name'), '') IS NOT NULL THEN 'contact_name' END,
    CASE WHEN nullif(btrim(f->>'phone'), '') IS NOT NULL THEN 'phone' END,
    CASE WHEN nullif(btrim(f->>'email'), '') IS NOT NULL THEN 'email' END,
    CASE WHEN nullif(btrim(f->>'project_name'), '') IS NOT NULL THEN 'project_name' END,
    CASE WHEN nullif(btrim(f->>'location'), '') IS NOT NULL THEN 'location' END,
    CASE WHEN nullif(btrim(f->>'scope'), '') IS NOT NULL THEN 'scope' END,
    CASE WHEN value_text ~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN 'estimated_value' END,
    CASE WHEN deadline_val IS NOT NULL THEN 'deadline' END,
    CASE WHEN nullif(btrim(f->>'client_rfq_ref'), '') IS NOT NULL THEN 'client_rfq_reference' END
  ], NULL);

  INSERT INTO public.inbox_items (
    source_type, source_name, company_name, contact_name, phone, email, project_name,
    location, scope, estimated_value, deadline, client_rfq_reference, notes, evidence_url,
    classification, request_type, created_by, ai_extracted_fields)
  VALUES (
    'info_mailbox', left(coalesce(nullif(btrim(m.from_name), ''), m.from_email), 200),
    nullif(btrim(f->>'company'), ''),
    coalesce(nullif(btrim(f->>'contact_name'), ''), nullif(btrim(m.from_name), '')),
    nullif(btrim(f->>'phone'), ''),
    coalesce(nullif(btrim(f->>'email'), ''), m.from_email),
    left(coalesce(nullif(btrim(f->>'project_name'), ''), m.subject, 'info@ request'), 300),
    nullif(btrim(f->>'location'), ''),
    nullif(btrim(f->>'scope'), ''),
    CASE WHEN value_text ~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN value_text::numeric END,
    deadline_val,
    nullif(btrim(f->>'client_rfq_ref'), ''),
    notes,
    m.web_link,
    'rfq', 'unknown', owner, ai_fields)
  RETURNING id INTO item;

  UPDATE public.info_mail SET inbox_item_id = item, status = 'intake_created' WHERE id = _mail_id;
  IF owner IS NOT NULL THEN
    UPDATE public.inbox_items SET assigned_owner_id = owner WHERE id = item;
  END IF;
  RETURN item;
END $function$;
