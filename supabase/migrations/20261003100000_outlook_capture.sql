-- =============================================================================
-- Capturing client email from each connected salesperson's Outlook, and binding
-- it to its deal.
--
-- Every five minutes pg_cron calls the outlook-sync function, which reads each
-- connected mailbox's Inbox and Sent Items through Graph delta. Mail with a
-- known client (a contact's address, or a company's website domain) is stored
-- as an activity; everything else is never stored. Binding to a deal, first
-- rule that holds: the Graph conversation already bound → a project code that
-- names exactly one deal → the company's only open deal → none.
--
-- An unbound email is visible to its owner and to pipeline operators (the
-- existing can_read_activity rule). bind_email_conversation lets either of them
-- link it to a deal once; the whole conversation follows.
--
-- Design: docs/superpowers/specs/2026-09-29-outlook-graph-design.md §6
-- Plan:   docs/superpowers/plans/2026-09-29-outlook-capture.md
-- =============================================================================

-- ============ 1. Columns and sync state ============
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS email_conversation_id TEXT;
CREATE INDEX IF NOT EXISTS activities_email_conversation_idx
  ON public.activities (email_conversation_id) WHERE email_conversation_id IS NOT NULL;
COMMENT ON COLUMN public.activities.email_conversation_id IS
  'Outlook (Graph) conversation id of a captured or sent email. Binding one email of a conversation to a deal binds the rest.';

CREATE TABLE IF NOT EXISTS public.mail_sync_state (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder       TEXT NOT NULL CHECK (folder IN ('inbox','sentitems')),
  delta_link   TEXT,
  last_run_at  TIMESTAMPTZ,
  last_error   TEXT CHECK (length(last_error) <= 500),
  PRIMARY KEY (user_id, folder)
);
COMMENT ON TABLE public.mail_sync_state IS
  'Where each mailbox folder''s Graph delta sync stopped. Service role only.';

ALTER TABLE public.mail_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_sync_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mail_sync_state TO service_role;
DROP POLICY IF EXISTS audit_session_boundary ON public.mail_sync_state;
CREATE POLICY audit_session_boundary ON public.mail_sync_state AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- Disconnecting forgets where the sync stopped, too.
CREATE OR REPLACE FUNCTION public.delete_mail_connection(_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE sid uuid;
BEGIN
  DELETE FROM public.mail_connections WHERE user_id = _user RETURNING refresh_token_secret_id INTO sid;
  DELETE FROM public.mail_oauth_pending WHERE user_id = _user;
  DELETE FROM public.mail_sync_state WHERE user_id = _user;
  IF sid IS NULL THEN RETURN false; END IF;
  DELETE FROM vault.secrets WHERE id = sid;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.delete_mail_connection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_mail_connection(uuid) TO service_role;

-- ============ 2. The key the scheduler uses — in Vault only ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'outlook_sync_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'outlook_sync_key',
      'Authenticates pg_cron''s calls to the outlook-sync function');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.outlook_sync_key_matches(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT coalesce(length(_key) = 64 AND _key = (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                  WHERE name = 'outlook_sync_key'), false);
$$;
REVOKE ALL ON FUNCTION public.outlook_sync_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outlook_sync_key_matches(text) TO service_role;

-- ============ 3. Linking an unbound conversation to a deal ============
CREATE OR REPLACE FUNCTION public.bind_email_conversation(_activity_id uuid, _opportunity_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.activities; u uuid := auth.uid(); n int;
BEGIN
  SELECT * INTO a FROM public.activities WHERE id = _activity_id FOR UPDATE;
  IF NOT FOUND OR a.email_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Email unavailable' USING ERRCODE = '42501'; END IF;
  -- The person whose mailbox it came from, or someone who runs the pipeline.
  IF u IS NULL OR NOT public.is_active_user(u) OR NOT (a.owner_id = u OR public.is_pipeline_operator(u)) THEN
    RAISE EXCEPTION 'Only the mailbox owner or a pipeline operator can link this email / فقط صاحب البريد أو مشغّل خط المبيعات' USING ERRCODE = '42501'; END IF;
  IF NOT public.can_read_boq(_opportunity_id, u) THEN
    RAISE EXCEPTION 'Opportunity unavailable' USING ERRCODE = '42501'; END IF;
  IF a.related_opportunity_id IS NOT NULL AND a.related_opportunity_id <> _opportunity_id THEN
    RAISE EXCEPTION 'This email is already linked to another deal / البريد مرتبط بصفقة أخرى' USING ERRCODE = '23514'; END IF;

  UPDATE public.activities SET related_opportunity_id = _opportunity_id
   WHERE email_conversation_id = a.email_conversation_id AND owner_id = a.owner_id
     AND related_opportunity_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.email_threads (graph_conversation_id, opportunity_id, company_id, contact_id, activity_id, owner_id)
  SELECT a.email_conversation_id, _opportunity_id, a.company_id, a.contact_id, a.id, a.owner_id
   WHERE NOT EXISTS (SELECT 1 FROM public.email_threads
                      WHERE graph_conversation_id = a.email_conversation_id AND owner_id = a.owner_id);

  INSERT INTO public.audit_log(actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'email.bound_to_deal', 'activity', a.id,
          jsonb_build_object('opportunity_id', _opportunity_id, 'emails', n));
  RETURN jsonb_build_object('ok', true, 'bound', n);
END $$;
REVOKE ALL ON FUNCTION public.bind_email_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_email_conversation(uuid, uuid) TO authenticated;

-- ============ 4. Every five minutes ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_cron or pg_net not installed — outlook-sync not scheduled.';
    RETURN;
  END IF;
  PERFORM cron.unschedule('outlook-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outlook-sync');
  -- The key is read from Vault when the job runs; it is never written into the job text.
  PERFORM cron.schedule('outlook-sync', '*/5 * * * *', $job$
    SELECT net.http_post(
      url := 'https://lrfdtoexyeghrzynapyn.supabase.co/functions/v1/outlook-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-phc-sync-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'outlook_sync_key')),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000)
    WHERE EXISTS (SELECT 1 FROM public.mail_connections WHERE status = 'active');
  $job$);
END $$;
