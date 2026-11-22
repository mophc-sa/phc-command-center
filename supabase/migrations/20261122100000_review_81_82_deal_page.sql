-- =============================================================================
-- Review meeting 81/82 (Omar, 2026-11-22) — deal page.
--
-- 1. Technical and commercial notes: two threads on the deal, each entry with
--    its author and time, shaped like Discussion. They live in
--    opportunity_discussions with a `kind`, and RLS keeps them apart:
--      technical  → the technical team (estimation) and leadership, not sales;
--      commercial → sales and leadership, not the technical team.
--    "we will make it as authorized" [82 · 11:56] — a permission, not a view.
-- 2. Target price from the client, shown in the deal's alert box.
-- 3. File location: the server path of the design files and BOQ.
-- 4. Review requests carry CC recipients (requested_payload.cc), and each one
--    is notified as the assigned approver already is.
-- =============================================================================

-- 1. Notes ---------------------------------------------------------------------
ALTER TABLE public.opportunity_discussions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'discussion'
  CHECK (kind IN ('discussion', 'technical', 'commercial'));

CREATE OR REPLACE FUNCTION public.can_read_note_kind(_user_id uuid, _kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _kind
    WHEN 'discussion' THEN public.can_use_discussion(_user_id)
    WHEN 'technical' THEN public.has_any_role(_user_id, ARRAY[
      'estimation_manager','sales_manager','general_manager','managing_director','ceo','system_admin']::public.app_role[])
    WHEN 'commercial' THEN public.has_any_role(_user_id, ARRAY[
      'salesperson','sales_ops','bd_manager','sales_manager','finance_manager',
      'general_manager','managing_director','ceo','system_admin']::public.app_role[])
    ELSE false END;
$$;
REVOKE EXECUTE ON FUNCTION public.can_read_note_kind(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_note_kind(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Discussion readable by authorised roles" ON public.opportunity_discussions;
CREATE POLICY "Discussion readable by authorised roles" ON public.opportunity_discussions
  FOR SELECT TO authenticated USING (public.can_read_note_kind(auth.uid(), kind));

DROP POLICY IF EXISTS "Discussion postable by authorised roles" ON public.opportunity_discussions;
CREATE POLICY "Discussion postable by authorised roles" ON public.opportunity_discussions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_read_note_kind(auth.uid(), kind) AND created_by = auth.uid());

-- The kind of an entry never changes after it is written.
CREATE OR REPLACE FUNCTION public.keep_discussion_kind()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'A note''s kind cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_keep_discussion_kind ON public.opportunity_discussions;
CREATE TRIGGER trg_keep_discussion_kind BEFORE UPDATE ON public.opportunity_discussions
  FOR EACH ROW EXECUTE FUNCTION public.keep_discussion_kind();

-- The old single technical_notes field (3 deals) becomes the first technical
-- entry, written by the deal's owner. The column stays for history.
INSERT INTO public.opportunity_discussions (opportunity_id, body, created_by, kind, created_at)
SELECT o.id, o.technical_notes, o.owner_id, 'technical', coalesce(o.updated_at, now())
  FROM public.opportunities o
 WHERE nullif(trim(o.technical_notes), '') IS NOT NULL AND o.owner_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.opportunity_discussions d WHERE d.opportunity_id = o.id AND d.kind = 'technical');

-- 2 + 3. Target price and file location ----------------------------------------
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS client_target_price numeric(14,2) CHECK (client_target_price IS NULL OR client_target_price >= 0),
  ADD COLUMN IF NOT EXISTS file_location text CHECK (file_location IS NULL OR length(file_location) <= 500);
COMMENT ON COLUMN public.opportunities.client_target_price IS 'The price the client says it is aiming for (review 81/82). Not our quotation.';
COMMENT ON COLUMN public.opportunities.file_location IS 'Server path of the design files and BOQ, copied from the deal page.';

-- 4. CC on review requests -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_approval_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _label TEXT := COALESCE(NEW.approval_type, 'Approval');
  _cc uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    PERFORM public.emit_notification(
      NEW.assigned_approver,
      'approval_requested', 'approval', NEW.id,
      _label, 'A decision is waiting for you.',
      'attention', 'approval_requested',
      'requested:' || NEW.id::TEXT,
      jsonb_build_object('opportunity_id', NEW.related_opportunity_id)
    );
    FOR _cc IN
      SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(NEW.requested_payload->'cc', '[]'::jsonb)) x
       WHERE x ~ '^[0-9a-f-]{36}$'
    LOOP
      IF _cc IS DISTINCT FROM NEW.assigned_approver THEN
        PERFORM public.emit_notification(
          _cc, 'approval_requested', 'approval', NEW.id,
          _label, 'You are copied on a review request.',
          'info', 'approval_requested',
          'cc:' || NEW.id::TEXT || ':' || _cc::TEXT,
          jsonb_build_object('opportunity_id', NEW.related_opportunity_id, 'cc', true)
        );
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('approved','returned','escalated')
  THEN
    PERFORM public.emit_notification(
      NEW.requested_by,
      CASE WHEN NEW.status = 'approved' THEN 'approval_approved' ELSE 'approval_rejected' END,
      'approval', NEW.id,
      _label,
      COALESCE(NEW.decision_notes, 'Your request was ' || NEW.status || '.'),
      CASE WHEN NEW.status = 'approved' THEN 'info' ELSE 'attention' END,
      'approval_decided',
      'decided:' || NEW.status::TEXT || ':' || COALESCE(NEW.decided_at, now())::TEXT,
      jsonb_build_object('opportunity_id', NEW.related_opportunity_id)
    );
  END IF;
  RETURN NULL;
END;
$$;
