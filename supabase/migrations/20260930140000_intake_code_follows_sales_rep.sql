-- =============================================================================
-- An intake's Project Code carries the code of the rep who entered it, and the
-- RFQ it becomes keeps that same code.
--
-- The agreed format (Faisal, 2026-08-06, 20260806160000) is <CODE>-<YY>-<NNNN>:
-- FA-26-0001, where FA is the rep. RFQ numbers have followed it since then, but
-- the intake form kept stamping INT-2026-0014 — a number that says nothing about
-- whose request it is. Worse, the same project then got a second number when the
-- intake became an RFQ, so the code a rep quoted from intake was not the code on
-- the deal.
--
-- 1. New intakes are numbered <CODE>-<YY>-<NNNN> from the SAME sequence as RFQs,
--    using the sales code of the person who entered the request (created_by).
--    One sequence means an intake code can never collide with an RFQ number.
-- 2. An RFQ created from an intake (rfqs.source_inbox_id) inherits the intake's
--    code instead of drawing a new one — only if the caller could convert that
--    intake, the intake is still open, and no RFQ already holds the code.
--    Otherwise numbering is exactly as before.
-- 3. The intakes still awaiting review are renumbered. Converted, archived and
--    duplicate intakes keep their numbers: records downstream already exist for
--    them. Every change is written to audit_log with the old number.
--
-- Supersedes the 2026-08-20 note that INT- numbers stay as they are.
-- =============================================================================

-- ---- 1. Intake numbering ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_code_for(_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _code text;
BEGIN
  SELECT p.sales_code INTO _code FROM public.profiles p WHERE p.id = _user_id;
  -- Same fallback as RFQ numbers: the person's initials, else no prefix.
  IF _code IS NULL THEN
    SELECT upper(substring(regexp_replace(coalesce(p.full_name, ''), '[^A-Za-z ]', '', 'g') from 1 for 2))
      INTO _code FROM public.profiles p WHERE p.id = _user_id;
    IF _code !~ '^[A-Z]{2}$' THEN _code := NULL; END IF;
  END IF;
  RETURN upper(_code);
END $$;

REVOKE ALL ON FUNCTION public.sales_code_for(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sales_code_for(uuid) IS
  'The rep code stamped into intake and RFQ numbers: profiles.sales_code, else the first two letters of the name, else NULL. Internal to the numbering triggers.';

CREATE OR REPLACE FUNCTION public.generate_inbox_project_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _code text;
BEGIN
  IF NEW.project_number IS NULL THEN
    _code := public.sales_code_for(COALESCE(NEW.created_by, auth.uid()));
    NEW.project_number :=
      COALESCE(_code || '-', '') ||
      to_char(now(), 'YY') || '-' ||
      lpad(nextval('public.rfq_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.generate_inbox_project_number() IS
  'Numbers an intake as <SALES_CODE>-<YY>-<NNNN> from the RFQ sequence, using the code of the person who entered it. The RFQ created from the intake keeps the same code (generate_rfq_number).';

-- ---- 2. The RFQ keeps the intake's code ------------------------------------
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS source_inbox_id uuid REFERENCES public.inbox_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.rfqs.source_inbox_id IS
  'The intake this RFQ was converted from. Lets the RFQ inherit the intake''s Project Code so a project keeps one code from intake onward.';

CREATE OR REPLACE FUNCTION public.generate_rfq_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_number text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.rfq_number ELSE NULL END;
  _code       text;
  _uid        uuid := auth.uid();
  _inherited  text;
BEGIN
  -- Unauthorized manual value from an authenticated end user: discard it
  -- quietly and fall through to auto-generation (the write still succeeds).
  -- auth.uid() IS NULL means a trusted service-role caller — e.g. data import
  -- committing a source file's own number — which is not subject to this.
  IF NEW.rfq_number IS NOT NULL
     AND NEW.rfq_number IS DISTINCT FROM _old_number
     AND _uid IS NOT NULL
     AND NOT public.can_edit_rfq_number(_uid) THEN
    NEW.rfq_number := _old_number;
  END IF;

  -- Converted from an intake: keep the intake's code. The intake must still be
  -- open, the caller must be someone who may convert it (the same test as the
  -- intake UPDATE policy), and the code must be unused — otherwise number as usual.
  IF NEW.rfq_number IS NULL AND TG_OP = 'INSERT' AND NEW.source_inbox_id IS NOT NULL THEN
    SELECT i.project_number INTO _inherited
      FROM public.inbox_items i
     WHERE i.id = NEW.source_inbox_id
       AND i.project_number ~ '^[A-Z]{2,3}-[0-9]{2}-[0-9]{4,}$'
       AND i.status NOT IN ('converted', 'archived', 'marked_duplicate')
       AND (_uid IS NULL
            OR i.created_by = _uid
            OR i.assigned_owner_id = _uid
            OR public.is_pipeline_operator(_uid))
       AND NOT EXISTS (SELECT 1 FROM public.rfqs r WHERE r.rfq_number = i.project_number);
    NEW.rfq_number := _inherited;
  END IF;

  IF NEW.rfq_number IS NULL THEN
    -- Prefer the owner's code, else the creator's, else the caller's.
    _code := public.sales_code_for(COALESCE(NEW.sales_owner_id, NEW.created_by, _uid));
    -- FA-26-0001. Without a code: 26-0001 — a number with no owner is still
    -- better than no number, and it is visibly missing its prefix.
    NEW.rfq_number :=
      COALESCE(_code || '-', '') ||
      to_char(now(), 'YY') || '-' ||
      lpad(nextval('public.rfq_number_seq')::text, 4, '0');

  ELSIF NEW.rfq_number IS DISTINCT FROM _old_number AND _uid IS NOT NULL
        AND NEW.rfq_number IS DISTINCT FROM _inherited THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (_uid, 'user', 'rfq.number_overridden', 'rfq', NEW.id,
            to_jsonb(_old_number), to_jsonb(NEW.rfq_number));
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.generate_rfq_number() IS
  'Generates rfq_number as <SALES_CODE>-<YY>-<NNNN>, e.g. FA-26-0001, from the owner''s code (then creator, then caller). An RFQ converted from an open intake (source_inbox_id) keeps the intake''s code instead. Format specified by Faisal 2026-08-06.';

-- ---- 3. Renumber the intakes still awaiting review --------------------------
DO $$
DECLARE
  r record;
  _new text;
  _code text;
BEGIN
  FOR r IN
    SELECT id, project_number, created_by, created_at
      FROM public.inbox_items
     WHERE project_number LIKE 'INT-%'
       AND status NOT IN ('converted', 'archived', 'marked_duplicate')
     ORDER BY created_at, id
  LOOP
    _code := public.sales_code_for(r.created_by);
    _new := COALESCE(_code || '-', '') ||
            to_char(r.created_at, 'YY') || '-' ||
            lpad(nextval('public.rfq_number_seq')::text, 4, '0');

    UPDATE public.inbox_items SET project_number = _new WHERE id = r.id;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    VALUES (NULL, 'system', 'inbox.project_number_renumbered', 'inbox_item', r.id,
            to_jsonb(r.project_number), to_jsonb(_new));
  END LOOP;
END $$;
