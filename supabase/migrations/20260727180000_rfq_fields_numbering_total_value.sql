-- =========================================================
-- RFQ form fields, auto-numbering, and Total Value protection —
-- client spec (2026-07-27, "متطلبات الصلاحيات وعزل بيانات المبيعات").
--
-- 1. New RFQ fields: city, classification (JIH / Tender / Other, with a
--    free-text field for "Other"). received_date and sales_owner_id
--    already existed on rfqs but were never exposed as form fields —
--    that's a frontend-only gap, fixed in the accompanying app code, not
--    here.
--
-- 2. rfq_number auto-generation: a sequence + BEFORE INSERT trigger fills
--    it in as "RFQ-{year}-{4-digit sequence}" whenever it isn't already
--    set. Manual entry/edit is restricted to "Account Manager" (mapped to
--    the existing sales_manager role — this codebase already calls
--    company-owner authority "account owner" throughout, e.g.
--    account_owner_id/changeAccountOwner, so "Account Manager" in the
--    spec is sales_manager, not a new role), bd_manager, and system_admin:
--    an unauthorized caller's manually-typed value is silently discarded
--    in favor of auto-generation (the row still gets created — this is a
--    quiet downgrade, not a hard failure) rather than blocking the whole
--    insert over one field, matching the tone of this codebase's other
--    best-effort field-level guards. An authorized manual override is
--    logged to audit_log, and a UNIQUE constraint prevents duplicates in
--    all cases.
--
-- 3. Total Value (estimated_value) protection: only finance_manager,
--    bd_manager, and system_admin may set or change it — enforced by a
--    trigger (server-level, not just hiding the field in the UI), mirroring
--    the existing protect_opportunity_owner()/protect_company_owner()
--    pattern. A salesperson can still create an RFQ leaving this field
--    null; nothing blocks the row, only a non-null/changed value from an
--    unauthorized caller is rejected.
-- =========================================================

-- ---- 1. New fields --------------------------------------------------------
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS classification_other text;

ALTER TABLE public.rfqs
  DROP CONSTRAINT IF EXISTS rfqs_classification_check;
ALTER TABLE public.rfqs
  ADD CONSTRAINT rfqs_classification_check
  CHECK (classification IS NULL OR classification IN ('jih', 'tender', 'other'));

COMMENT ON COLUMN public.rfqs.city IS 'City the RFQ/project is located in (client spec, 2026-07-27).';
COMMENT ON COLUMN public.rfqs.classification IS '''jih'' | ''tender'' | ''other''. When ''other'', classification_other holds the free-text label.';
COMMENT ON COLUMN public.rfqs.classification_other IS 'Free-text classification label, only used when classification = ''other''.';

-- ---- 2. rfq_number auto-generation -----------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.rfq_number_seq;

ALTER TABLE public.rfqs
  DROP CONSTRAINT IF EXISTS rfqs_rfq_number_key;
ALTER TABLE public.rfqs
  ADD CONSTRAINT rfqs_rfq_number_key UNIQUE (rfq_number);

CREATE OR REPLACE FUNCTION public.can_edit_rfq_number(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['sales_manager', 'bd_manager', 'system_admin']::public.app_role[]
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_edit_rfq_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_rfq_number(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_rfq_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_number text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rfq_number ELSE NULL END;
BEGIN
  -- Unauthorized manual value from an authenticated end user: discard it
  -- quietly, fall through to auto-generation below (the insert/update
  -- still succeeds). auth.uid() IS NULL means a trusted service-role
  -- caller (e.g. data import committing a source file's own RFQ number) —
  -- not subject to this guard, same escape hatch as protect_rfq_
  -- estimated_value below.
  IF NEW.rfq_number IS NOT NULL
     AND NEW.rfq_number IS DISTINCT FROM _old_number
     AND auth.uid() IS NOT NULL
     AND NOT public.can_edit_rfq_number(auth.uid()) THEN
    NEW.rfq_number := _old_number;
  END IF;

  IF NEW.rfq_number IS NULL THEN
    NEW.rfq_number := 'RFQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rfq_number_seq')::text, 4, '0');
  ELSIF NEW.rfq_number IS DISTINCT FROM _old_number AND auth.uid() IS NOT NULL THEN
    -- Authorized manual entry/edit by an end user — log it (creation
    -- already gets its own "rfq.created" audit entry elsewhere; this is
    -- specifically about a manual number override). Service-role writes
    -- (auth.uid() IS NULL) aren't logged here — they get their own audit
    -- trail at the call site (e.g. import's audit_log entries).
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
      VALUES (auth.uid(), 'user', 'rfq.number_manually_set', 'rfq', NEW.id,
              jsonb_build_object('rfq_number', _old_number),
              jsonb_build_object('rfq_number', NEW.rfq_number));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_rfq_number ON public.rfqs;
CREATE TRIGGER trg_generate_rfq_number
  BEFORE INSERT OR UPDATE OF rfq_number ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.generate_rfq_number();

-- ---- 3. Total Value (estimated_value) protection ---------------------------
CREATE OR REPLACE FUNCTION public.can_edit_total_value(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['finance_manager', 'bd_manager', 'system_admin']::public.app_role[]
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_edit_total_value(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_total_value(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_rfq_estimated_value()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_value numeric := CASE WHEN TG_OP = 'UPDATE' THEN OLD.estimated_value ELSE NULL END;
BEGIN
  -- auth.uid() IS NULL means a service-role/backend caller (e.g. the import
  -- pipeline's commit_candidates) — those already bypass RLS and are
  -- trusted to write whatever was mapped; this guard is specifically about
  -- authenticated end users.
  IF NEW.estimated_value IS DISTINCT FROM _old_value
     AND auth.uid() IS NOT NULL
     AND NOT public.can_edit_total_value(auth.uid()) THEN
    RAISE EXCEPTION 'Only Finance Manager, BD Manager, or System Admin may set the Total Value';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_rfq_estimated_value ON public.rfqs;
CREATE TRIGGER trg_protect_rfq_estimated_value
  BEFORE INSERT OR UPDATE OF estimated_value ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.protect_rfq_estimated_value();
