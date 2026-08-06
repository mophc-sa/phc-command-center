-- =========================================================
-- PHC Sales OS — RFQ number format: <CODE>-<YY>-<NNNN>
--
-- Faisal, 2026-08-06, specifying the format he actually uses:
--
--   "fa = faisal - 26 = years - & the quotation number"
--
-- So: FA-26-0001. The rep's code, the two-digit year, the sequence.
--
-- 20260806140000 produced FA-RFQ-2026-0001, which carried the code but kept the
-- old RFQ-YYYY skeleton around it. This drops the redundant middle: the number
-- is already on an RFQ record, so spelling "RFQ" inside it says nothing, and
-- the four-digit year is two characters nobody reads.
--
-- Existing numbers are untouched. Only new records take the new shape, and the
-- sequence continues rather than restarting, so numbers stay unique across the
-- format change.
-- =========================================================

CREATE OR REPLACE FUNCTION public.generate_rfq_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_number text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rfq_number ELSE NULL END;
  _code       text;
BEGIN
  -- Unauthorized manual value from an authenticated end user: discard it
  -- quietly and fall through to auto-generation (the write still succeeds).
  -- auth.uid() IS NULL means a trusted service-role caller — e.g. data import
  -- committing a source file's own number — which is not subject to this.
  IF NEW.rfq_number IS NOT NULL
     AND NEW.rfq_number IS DISTINCT FROM _old_number
     AND auth.uid() IS NOT NULL
     AND NOT public.can_edit_rfq_number(auth.uid()) THEN
    NEW.rfq_number := _old_number;
  END IF;

  IF NEW.rfq_number IS NULL THEN
    -- Prefer the owner's code, else the creator's, else the caller's.
    SELECT p.sales_code INTO _code
      FROM public.profiles p
     WHERE p.id = COALESCE(NEW.sales_owner_id, NEW.created_by, auth.uid())
     LIMIT 1;

    -- No code set yet: derive the initials rather than leaving the number
    -- anonymous. An admin can set a proper code later; the number is immutable.
    IF _code IS NULL THEN
      SELECT upper(substring(regexp_replace(coalesce(p.full_name, ''), '[^A-Za-z ]', '', 'g') from 1 for 2))
        INTO _code
        FROM public.profiles p
       WHERE p.id = COALESCE(NEW.sales_owner_id, NEW.created_by, auth.uid())
       LIMIT 1;
      IF _code !~ '^[A-Z]{2}$' THEN _code := NULL; END IF;
    END IF;

    -- FA-26-0001. Without a code: 26-0001 — a number with no owner is still
    -- better than no number, and it is visibly missing its prefix.
    NEW.rfq_number :=
      COALESCE(_code || '-', '') ||
      to_char(now(), 'YY') || '-' ||
      lpad(nextval('public.rfq_number_seq')::text, 4, '0');

  ELSIF NEW.rfq_number IS DISTINCT FROM _old_number AND auth.uid() IS NOT NULL THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (auth.uid(), 'user', 'rfq.number_overridden', 'rfq', NEW.id,
            to_jsonb(_old_number), to_jsonb(NEW.rfq_number));
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.generate_rfq_number() IS
  'Generates rfq_number as <SALES_CODE>-<YY>-<NNNN>, e.g. FA-26-0001. The code comes from profiles.sales_code of the owner (falling back to creator, then caller), defaulting to their initials. Format specified by Faisal 2026-08-06.';
