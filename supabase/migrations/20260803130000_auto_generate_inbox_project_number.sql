-- =========================================================
-- Auto-generate inbox_items.project_number (2026-08-03 client request:
-- "Project Number in new intake يجب ان يولد تلقائياً"). Was a free-text
-- field on the New Intake form — removed there (see lead-tender-inbox.tsx)
-- in favour of a BEFORE INSERT trigger, mirroring the same pattern already
-- used for rfq_number and projects.project_number. Uses its own "INT-"
-- prefix and sequence, distinct from projects.project_number's "PRJ-" —
-- an intake capture isn't a confirmed project yet, so it shouldn't borrow
-- that numbering space.
-- =========================================================

CREATE SEQUENCE IF NOT EXISTS public.inbox_project_number_seq;

CREATE OR REPLACE FUNCTION public.generate_inbox_project_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.project_number IS NULL THEN
    NEW.project_number := 'INT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.inbox_project_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_inbox_project_number ON public.inbox_items;
CREATE TRIGGER trg_generate_inbox_project_number
  BEFORE INSERT ON public.inbox_items
  FOR EACH ROW EXECUTE FUNCTION public.generate_inbox_project_number();
