
CREATE OR REPLACE FUNCTION public.audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$;
