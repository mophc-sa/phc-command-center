
-- 1. Enum additions (must be committed before use; safe/no-op if re-run)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'system_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'managing_director';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'general_manager';

-- 2. Audit log extension (additive only)
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS actor_role_snapshot text[],
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_request_id_idx ON public.audit_log (request_id) WHERE request_id IS NOT NULL;

-- 3. Append-only enforcement at DB level
CREATE OR REPLACE FUNCTION public.audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();

-- Belt-and-braces: revoke UPDATE/DELETE at grant level for client roles
REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.audit_log FROM anon;
