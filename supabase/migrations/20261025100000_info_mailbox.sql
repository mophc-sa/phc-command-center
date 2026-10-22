-- =============================================================================
-- The info@phc-sa.com mailbox (manager feedback 2026-10-19, group 3 part B).
-- Spec: docs/superpowers/specs/2026-10-19-manager-actions-info-mail-design.md §B2–B3
-- Plan: docs/superpowers/plans/2026-10-20-info-mailbox.md
--
-- outlook-sync reads info@ every five minutes with an app-only token that
-- Exchange limits to that one mailbox, stores each message here, and asks the
-- orchestrator to classify it. Everything that decides something — the owner,
-- the intake item, a reply on a deal, a forward — is a function in this file.
--
-- WHAT THIS FILE REFUSES TO DO
-- - Keep the text of mail that is not a request or a reply (CVs, invoices).
-- - Let the browser write here. Routers act through the RPCs below.
-- - Guess an owner. A sender maps to one account owner or to nobody.
-- =============================================================================

-- 1. Messages ---------------------------------------------------------------
CREATE TABLE public.info_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_message_id text NOT NULL UNIQUE,
  internet_message_id text,
  conversation_id text,
  from_email text,
  from_name text,
  subject text,
  received_at timestamptz NOT NULL,
  category text NOT NULL DEFAULT 'unclassified'
    CHECK (category IN ('unclassified','rfq','quotation_request','client_reply','supplier','finance','hr','general','spam')),
  confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  summary text CHECK (summary IS NULL OR length(summary) <= 400),
  body_text text CHECK (body_text IS NULL OR length(body_text) <= 20000),
  attachment_names text[] NOT NULL DEFAULT '{}',
  web_link text CHECK (web_link IS NULL OR web_link ~ '^https://outlook\.office(365)?\.com/'),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','intake_created','forwarded','dismissed','attached')),
  triage_attempts smallint NOT NULL DEFAULT 0,
  inbox_item_id uuid REFERENCES public.inbox_items(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  forwarded_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Privacy: only a request or a reply keeps its text; unclassified keeps it
  -- only until triage (or three failed attempts) decides.
  CONSTRAINT info_mail_body_only_for_requests
    CHECK (body_text IS NULL OR category IN ('unclassified','rfq','quotation_request','client_reply'))
);
CREATE INDEX info_mail_conversation_idx ON public.info_mail (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX info_mail_inbox_item_idx ON public.info_mail (inbox_item_id) WHERE inbox_item_id IS NOT NULL;
CREATE INDEX info_mail_opportunity_idx ON public.info_mail (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX info_mail_open_idx ON public.info_mail (received_at DESC) WHERE status = 'new';

ALTER TABLE public.info_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.info_mail FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.info_mail TO authenticated;
GRANT ALL ON public.info_mail TO service_role;

-- Routers read everything; a deal's readers read its source mail; an intake
-- item's owner and creator read the mail it came from.
CREATE POLICY info_mail_readers ON public.info_mail FOR SELECT TO authenticated USING (
  public.is_pipeline_operator(auth.uid())
  OR (opportunity_id IS NOT NULL AND public.can_read_boq(opportunity_id, auth.uid()))
  OR (inbox_item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.inbox_items i
         WHERE i.id = info_mail.inbox_item_id
           AND auth.uid() IN (i.assigned_owner_id, i.created_by)))
);
DROP POLICY IF EXISTS audit_session_boundary ON public.info_mail;
CREATE POLICY audit_session_boundary ON public.info_mail AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- 2. Where the last read stopped ---------------------------------------------
CREATE TABLE public.info_mailbox_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  delta_link text,
  last_run_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500)
);
INSERT INTO public.info_mailbox_state (id) VALUES (true);
ALTER TABLE public.info_mailbox_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.info_mailbox_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.info_mailbox_state TO service_role;
DROP POLICY IF EXISTS audit_session_boundary ON public.info_mailbox_state;
CREATE POLICY audit_session_boundary ON public.info_mailbox_state AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- 3. A daily AI budget for the mailbox, apart from people's own -----------------
INSERT INTO public.ai_usage_limits VALUES ('mailbox', 300, 300) ON CONFLICT (kind) DO NOTHING;

-- 4. Who owns a sender: a known contact's company, else the one company that
--    holds the domain. Two answers is no answer. ------------------------------
CREATE OR REPLACE FUNCTION public.info_mail_owner_for(_from_email text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  addr text := lower(btrim(coalesce(_from_email, '')));
  dom text;
  owners uuid[];
BEGIN
  IF addr = '' OR position('@' in addr) = 0 THEN RETURN NULL; END IF;
  dom := split_part(addr, '@', 2);

  SELECT array_agg(DISTINCT c.account_owner_id) INTO owners
    FROM public.contacts k JOIN public.companies c ON c.id = k.company_id
   WHERE lower(k.email) = addr AND k.archived_at IS NULL AND c.archived_at IS NULL;
  IF owners IS NOT NULL THEN
    IF array_length(owners, 1) = 1 AND owners[1] IS NOT NULL AND public.is_active_user(owners[1]) THEN
      RETURN owners[1];
    END IF;
    RETURN NULL;
  END IF;

  IF public.is_free_mail_domain(dom) OR dom = 'phc-sa.com' OR dom LIKE '%.phc-sa.com' THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT c.account_owner_id) INTO owners
    FROM public.companies c
   WHERE lower(c.website_domain) = dom AND c.archived_at IS NULL;
  IF array_length(owners, 1) = 1 AND owners[1] IS NOT NULL AND public.is_active_user(owners[1]) THEN
    RETURN owners[1];
  END IF;
  RETURN NULL;
END $$;

-- 5. A message → an intake item (once). Every item starts in pending_review, so
--    trg_notify_inbox_intake_events tells the reviewers (intake_review_requested)
--    whether or not it has an owner; an owner is also told, through the
--    assigned_owner_id update below (intake_assigned). ------------------------
CREATE OR REPLACE FUNCTION public.info_mail_create_intake(_mail_id uuid, _fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.info_mail;
  f jsonb := CASE WHEN jsonb_typeof(_fields) = 'object' THEN _fields ELSE '{}'::jsonb END;
  owner uuid;
  item uuid;
  value_text text := btrim(coalesce(f->>'estimated_value', ''));
  deadline_text text := btrim(coalesce(f->>'deadline', ''));
  deadline_val date;
  notes text;
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

  INSERT INTO public.inbox_items (
    source_type, source_name, company_name, contact_name, phone, email, project_name,
    location, scope, estimated_value, deadline, client_rfq_reference, notes, evidence_url,
    classification, request_type, created_by)
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
    'rfq', 'unknown', owner)
  RETURNING id INTO item;

  UPDATE public.info_mail SET inbox_item_id = item, status = 'intake_created' WHERE id = _mail_id;
  IF owner IS NOT NULL THEN
    UPDATE public.inbox_items SET assigned_owner_id = owner WHERE id = item;
  END IF;
  RETURN item;
END $$;

-- 6. The orchestrator's verdict. 0.7 is the one place the threshold lives.
--    A router may dismiss or forward a message before the AI answers; the
--    verdict is still recorded (and a non-request still loses its text), but it
--    never creates an item over a person's decision. ------------------------
CREATE OR REPLACE FUNCTION public.info_mail_apply_triage(
  _mail_id uuid, _category text, _confidence numeric, _summary text, _fields jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_request boolean := _category IN ('rfq', 'quotation_request');
  st text;
BEGIN
  IF _category IS NULL OR _category NOT IN ('rfq','quotation_request','supplier','finance','hr','general','spam') THEN
    RAISE EXCEPTION 'unknown category' USING ERRCODE = '22023';
  END IF;
  UPDATE public.info_mail
     SET category = _category,
         confidence = greatest(0, least(1, coalesce(_confidence, 0))),
         summary = left(_summary, 400),
         body_text = CASE WHEN is_request THEN body_text END,
         triage_attempts = triage_attempts + 1
   WHERE id = _mail_id AND category = 'unclassified'
  RETURNING status INTO st;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;
  IF st = 'new' AND is_request AND coalesce(_confidence, 0) >= 0.7 THEN
    PERFORM public.info_mail_create_intake(_mail_id, _fields);
    RETURN 'intake_created';
  END IF;
  RETURN 'listed';
END $$;

CREATE OR REPLACE FUNCTION public.info_mail_triage_failed(_mail_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.info_mail
     SET triage_attempts = triage_attempts + 1,
         body_text = CASE WHEN triage_attempts + 1 >= 3 THEN NULL ELSE body_text END
   WHERE id = _mail_id AND category = 'unclassified';
$$;

-- 7. A later message in a known conversation: on the deal, and its people told.
CREATE OR REPLACE FUNCTION public.info_mail_record_reply(_mail_id uuid, _parent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.info_mail;
  p public.info_mail;
  opp public.opportunities;
  item public.inbox_items;
  r uuid;
  told int := 0;
BEGIN
  SELECT * INTO m FROM public.info_mail WHERE id = _mail_id FOR UPDATE;
  SELECT * INTO p FROM public.info_mail WHERE id = _parent_id;
  IF m.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'info mail not found' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.info_mail
     SET category = 'client_reply', status = 'attached',
         inbox_item_id = p.inbox_item_id, opportunity_id = p.opportunity_id
   WHERE id = _mail_id;

  IF p.inbox_item_id IS NOT NULL THEN SELECT * INTO item FROM public.inbox_items WHERE id = p.inbox_item_id; END IF;
  IF p.opportunity_id IS NOT NULL THEN
    SELECT * INTO opp FROM public.opportunities WHERE id = p.opportunity_id;
    BEGIN
      INSERT INTO public.activities (
        activity_type, status, summary, draft_content, occurred_at, owner_id, created_by,
        related_opportunity_id, company_id, provider_message_id, email_conversation_id, email_from)
      VALUES (
        'email_received', 'logged', left(coalesce(m.subject, ''), 300), m.body_text, m.received_at,
        coalesce(opp.owner_id, item.assigned_owner_id), coalesce(opp.owner_id, item.assigned_owner_id),
        opp.id, opp.company_id,
        CASE WHEN m.internet_message_id IS NOT NULL THEN 'imid:' || m.internet_message_id END,
        m.conversation_id, m.from_email);
    EXCEPTION WHEN unique_violation THEN NULL;  -- a rep's own capture got there first
    END;
  END IF;

  -- Only active people count as told: emit_notification skips the others, and
  -- a reply nobody hears about falls through to the sales managers.
  FOR r IN SELECT DISTINCT x FROM unnest(ARRAY[opp.owner_id, item.assigned_owner_id, item.created_by]) AS x
            WHERE x IS NOT NULL AND public.is_active_user(x) LOOP
    PERFORM public.emit_notification(
      r, 'client_reply',
      CASE WHEN opp.id IS NOT NULL THEN 'opportunity' ELSE 'inbox_item' END,
      coalesce(opp.id, item.id),
      left(coalesce(m.subject, 'Client reply'), 200),
      'The client wrote again to info@.',
      'attention', 'info_mail.client_reply', m.id::text,
      CASE WHEN opp.id IS NOT NULL THEN jsonb_build_object('opportunity_id', opp.id) END);
    told := told + 1;
  END LOOP;
  IF told = 0 THEN
    PERFORM public.emit_notification_to_roles(
      ARRAY['sales_manager']::public.app_role[], 'client_reply',
      CASE WHEN opp.id IS NOT NULL THEN 'opportunity' ELSE 'inbox_item' END,
      coalesce(opp.id, item.id), left(coalesce(m.subject, 'Client reply'), 200),
      'The client wrote again to info@.', 'attention', 'info_mail.client_reply', m.id::text, NULL);
  END IF;
END $$;

-- 8. Router actions ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.info_mail_dismiss(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR NOT public.is_pipeline_operator(u) THEN
    RAISE EXCEPTION 'Only sales managers, BD and sales ops route info@ mail' USING ERRCODE = '42501';
  END IF;
  UPDATE public.info_mail SET status = 'dismissed', handled_by = u, handled_at = now()
   WHERE id = _id AND status = 'new' AND inbox_item_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This message was already handled' USING ERRCODE = 'P0002'; END IF;
END $$;

-- Called by sales-os-api after Graph accepted the forward (the caller's role was
-- checked there, as the caller).
CREATE OR REPLACE FUNCTION public.info_mail_record_forward(_id uuid, _to uuid, _by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.info_mail;
BEGIN
  UPDATE public.info_mail SET status = 'forwarded', forwarded_to = _to, handled_by = _by, handled_at = now()
   WHERE id = _id AND status = 'new' RETURNING * INTO m;
  IF m.id IS NULL THEN RAISE EXCEPTION 'This message was already handled' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.emit_notification(
    _to, 'info_mail_forwarded', 'system', NULL, left(coalesce(m.subject, 'Email from info@'), 200),
    'Forwarded to your Outlook from info@.', 'info', 'info_mail.forwarded', m.id::text, NULL);
END $$;

-- "This is an RFQ": the full text, fetched again from Graph by sales-os-api.
CREATE OR REPLACE FUNCTION public.info_mail_promote(_id uuid, _by uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.info_mail
     SET category = 'rfq', confidence = 1, body_text = left(_body, 20000), handled_by = _by, handled_at = now()
   WHERE id = _id AND status = 'new' AND inbox_item_id IS NULL AND category <> 'client_reply';
  IF NOT FOUND THEN RAISE EXCEPTION 'This message was already handled' USING ERRCODE = 'P0002'; END IF;
  RETURN public.info_mail_create_intake(_id, '{}'::jsonb);
END $$;

-- 9. Conversion happens in the browser (inbox-actions.ts markConverted); this
--    binds the item's mail to the deal it became. ----------------------------
CREATE OR REPLACE FUNCTION public.info_mail_link_conversion(_inbox_item_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); item public.inbox_items; n integer;
BEGIN
  IF u IS NULL OR NOT public.is_active_user(u) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO item FROM public.inbox_items WHERE id = _inbox_item_id;
  IF NOT FOUND OR item.converted_record_type IS DISTINCT FROM 'opportunity' OR item.converted_record_id IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT (public.can_review_intake(u) OR public.is_pipeline_operator(u)
          OR coalesce(u IN (item.assigned_owner_id, item.created_by), false)
          OR public.can_read_boq(item.converted_record_id, u)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.info_mail SET opportunity_id = item.converted_record_id
   WHERE inbox_item_id = item.id AND opportunity_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 10. @mentions on an email the caller just sent: a notification, never a copy.
CREATE OR REPLACE FUNCTION public.notify_mentions(_activity_id uuid, _users uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u uuid := auth.uid();
  a public.activities;
  who text;
  r uuid;
  n integer := 0;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF cardinality(coalesce(_users, '{}')) > 10 THEN RAISE EXCEPTION 'At most 10 mentions' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.activities WHERE id = _activity_id;
  IF NOT FOUND OR a.sent_by IS DISTINCT FROM u OR a.related_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(nullif(btrim(full_name), ''), email) INTO who FROM public.profiles WHERE id = u;
  FOR r IN SELECT DISTINCT x FROM unnest(_users) AS x LOOP
    -- Only people who can open the deal: a mention never widens who reads it.
    IF r <> u AND public.is_active_user(r) AND public.can_read_boq(a.related_opportunity_id, r) THEN
      PERFORM public.emit_notification(
        r, 'mention', 'opportunity', a.related_opportunity_id,
        left(coalesce(who, 'A colleague') || ' mentioned you on an email', 200),
        left(coalesce(a.summary, ''), 300), 'info', 'email.mention', a.id::text,
        jsonb_build_object('opportunity_id', a.related_opportunity_id, 'activity_id', a.id));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- 11. Grants -----------------------------------------------------------------
REVOKE ALL ON FUNCTION public.info_mail_owner_for(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_create_intake(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_apply_triage(uuid, text, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_triage_failed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_record_reply(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_record_forward(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.info_mail_promote(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.info_mail_owner_for(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_create_intake(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_apply_triage(uuid, text, numeric, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_triage_failed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_record_reply(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_record_forward(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.info_mail_promote(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.info_mail_dismiss(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.info_mail_link_conversion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notify_mentions(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.info_mail_dismiss(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.info_mail_link_conversion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_mentions(uuid, uuid[]) TO authenticated;

-- 12. Every five minutes, the same function and key as the reps' mail sync.
--     The function answers "off" until INFO_MAILBOX is set.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_cron or pg_net not installed — info-mailbox-sync not scheduled.';
    RETURN;
  END IF;
  PERFORM cron.unschedule('info-mailbox-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'info-mailbox-sync');
  -- The key is read from Vault when the job runs; it is never written into the job text.
  PERFORM cron.schedule('info-mailbox-sync', '*/5 * * * *', $job$
    SELECT net.http_post(
      url := 'https://lrfdtoexyeghrzynapyn.supabase.co/functions/v1/outlook-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-phc-sync-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'outlook_sync_key')),
      body := '{"mailbox":"info"}'::jsonb,
      timeout_milliseconds := 55000);
  $job$);
END $$;
