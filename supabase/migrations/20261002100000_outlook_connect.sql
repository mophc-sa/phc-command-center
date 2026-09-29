-- =============================================================================
-- Each salesperson connects their own Outlook mailbox (delegated Microsoft
-- Graph), so email sent from the system leaves from — and lands in the Sent
-- folder of — their real mailbox.
--
-- What this stores, and who can reach it:
--   mail_connections    one row per connected person. Service role only.
--   mail_oauth_pending  the PKCE verifier for a sign-in in progress, keyed by
--                       the hash of the one-time state. Lives ten minutes.
--   Vault               the refresh token itself, never in a table column. The
--                       functions below are the only way in or out, and only
--                       the service role may call them.
--
-- The browser never holds a token: sales-os-api starts the sign-in, the
-- outlook-connector function receives Microsoft's redirect, and send_email
-- reads the token server-side.
--
-- Design: docs/superpowers/specs/2026-09-29-outlook-graph-design.md
-- =============================================================================

-- ============ 1. Tables ============
CREATE TABLE IF NOT EXISTS public.mail_connections (
  user_id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ms_user_id               TEXT NOT NULL,
  email                    TEXT NOT NULL,
  scopes                   TEXT[] NOT NULL DEFAULT '{}',
  refresh_token_secret_id  UUID NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reconnect')),
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at             TIMESTAMPTZ,
  last_error               TEXT CHECK (length(last_error) <= 500)
);

CREATE TABLE IF NOT EXISTS public.mail_oauth_pending (
  state_hash     TEXT PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier  TEXT NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE public.mail_connections IS
  'A person''s connected Outlook mailbox. The refresh token is in Vault (refresh_token_secret_id); service role only.';
COMMENT ON TABLE public.mail_oauth_pending IS
  'Outlook sign-ins in progress: the PKCE verifier keyed by the SHA-256 of the one-time state. Consumed by outlook-connector; service role only.';

-- Replies to an email sent through Outlook bind by Graph conversation id, the
-- analogue of the Reply-To token used for Postmark sends.
ALTER TABLE public.email_threads ADD COLUMN IF NOT EXISTS graph_conversation_id TEXT;
ALTER TABLE public.email_threads ALTER COLUMN token_hash DROP NOT NULL;
ALTER TABLE public.email_threads DROP CONSTRAINT IF EXISTS email_threads_has_key;
ALTER TABLE public.email_threads ADD CONSTRAINT email_threads_has_key
  CHECK (token_hash IS NOT NULL OR graph_conversation_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS email_threads_graph_conversation_idx
  ON public.email_threads (graph_conversation_id) WHERE graph_conversation_id IS NOT NULL;

-- ============ 2. Access: nobody but the service role ============
ALTER TABLE public.mail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_oauth_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_connections, public.mail_oauth_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mail_connections, public.mail_oauth_pending TO service_role;

DROP POLICY IF EXISTS audit_session_boundary ON public.mail_connections;
CREATE POLICY audit_session_boundary ON public.mail_connections AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
DROP POLICY IF EXISTS audit_session_boundary ON public.mail_oauth_pending;
CREATE POLICY audit_session_boundary ON public.mail_oauth_pending AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- ============ 3. The refresh token, through Vault only ============
CREATE OR REPLACE FUNCTION public.save_mail_connection(
  _user uuid, _ms_user_id text, _email text, _scopes text[], _refresh_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE sid uuid;
BEGIN
  IF _user IS NULL OR btrim(coalesce(_refresh_token,'')) = '' OR btrim(coalesce(_email,'')) = '' THEN
    RAISE EXCEPTION 'Connection incomplete'; END IF;
  SELECT refresh_token_secret_id INTO sid FROM public.mail_connections WHERE user_id = _user;
  IF sid IS NULL THEN
    sid := vault.create_secret(_refresh_token, 'mail_refresh_' || _user, 'Outlook refresh token');
  ELSE
    PERFORM vault.update_secret(sid, _refresh_token);
  END IF;
  INSERT INTO public.mail_connections(user_id, ms_user_id, email, scopes, refresh_token_secret_id, status, connected_at, last_error)
  VALUES (_user, _ms_user_id, lower(_email), coalesce(_scopes,'{}'), sid, 'active', now(), NULL)
  ON CONFLICT (user_id) DO UPDATE SET ms_user_id = EXCLUDED.ms_user_id, email = EXCLUDED.email,
    scopes = EXCLUDED.scopes, refresh_token_secret_id = sid, status = 'active',
    connected_at = now(), last_error = NULL;
END $$;

CREATE OR REPLACE FUNCTION public.mail_refresh_token(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT d.decrypted_secret FROM public.mail_connections c
    JOIN vault.decrypted_secrets d ON d.id = c.refresh_token_secret_id
   WHERE c.user_id = _user;
$$;

CREATE OR REPLACE FUNCTION public.rotate_mail_refresh_token(_user uuid, _refresh_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE sid uuid;
BEGIN
  SELECT refresh_token_secret_id INTO sid FROM public.mail_connections WHERE user_id = _user;
  IF sid IS NULL OR btrim(coalesce(_refresh_token,'')) = '' THEN RETURN; END IF;
  PERFORM vault.update_secret(sid, _refresh_token);
  UPDATE public.mail_connections SET last_used_at = now(), status = 'active', last_error = NULL WHERE user_id = _user;
END $$;

CREATE OR REPLACE FUNCTION public.mark_mail_connection(_user uuid, _status text, _error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.mail_connections
     SET status = _status, last_error = left(_error, 500),
         last_used_at = CASE WHEN _status = 'active' THEN now() ELSE last_used_at END
   WHERE user_id = _user;
$$;

-- Disconnecting removes the token, not a flag: nothing is left to misuse.
CREATE OR REPLACE FUNCTION public.delete_mail_connection(_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE sid uuid;
BEGIN
  DELETE FROM public.mail_connections WHERE user_id = _user RETURNING refresh_token_secret_id INTO sid;
  DELETE FROM public.mail_oauth_pending WHERE user_id = _user;
  IF sid IS NULL THEN RETURN false; END IF;
  DELETE FROM vault.secrets WHERE id = sid;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.save_mail_connection(uuid,text,text,text[],text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_refresh_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_mail_refresh_token(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_mail_connection(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_mail_connection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_mail_connection(uuid,text,text,text[],text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_refresh_token(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_mail_refresh_token(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_mail_connection(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_mail_connection(uuid) TO service_role;
