-- =========================================================
-- BAFO / commercial-discount approval chain — client spec (2026-07-27,
-- "دور مدير تطوير الأعمال داخل النظام", section 12).
--
-- A fixed, 4-step sequential approval chain (matching this codebase's
-- opportunity_milestones precedent — 20260726130000 — of fixed named
-- columns for a fixed, well-known workflow, rather than a generic
-- multi-step workflow engine): a salesperson/BD rep requests a BAFO
-- (Best And Final Offer) or commercial discount on an opportunity; four
-- roles must approve, IN ORDER, before it's considered approved:
--   1. commercial_review — bd_manager or sales_manager
--   2. cost_approval     — estimation_manager
--   3. finance_review    — finance_manager
--   4. final_approval    — executive (managing_director/general_manager/ceo)
-- system_admin may act at any step (platform-admin override, consistent
-- with every other approval gate in this codebase).
--
-- "لا يسمح النظام بإرسال عرض معدّل أو BAFO إلى العميل قبل اكتمال
-- الموافقات المطلوبة" (the system must not allow sending a BAFO to the
-- client before all approvals are complete) is enforced by a dedicated
-- sent_to_client_at timestamp that can only be set once status = 'approved'
-- — deliberately NOT wired into the existing quotations.status enum
-- ('revised' etc.), since that status is already used for ordinary
-- quotation edits unrelated to a formal BAFO request, and overloading it
-- here would risk breaking existing quotation-editing behavior.
-- =========================================================

CREATE TABLE public.bafo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id),

  proposed_value numeric,
  proposed_discount_pct numeric,
  proposed_payment_terms text,
  justification text NOT NULL,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),

  commercial_review_status text NOT NULL DEFAULT 'pending' CHECK (commercial_review_status IN ('pending', 'approved', 'rejected')),
  commercial_review_by uuid REFERENCES auth.users(id),
  commercial_review_notes text,
  commercial_review_at timestamptz,

  cost_approval_status text NOT NULL DEFAULT 'pending' CHECK (cost_approval_status IN ('pending', 'approved', 'rejected')),
  cost_approval_by uuid REFERENCES auth.users(id),
  cost_approval_notes text,
  cost_approval_at timestamptz,

  finance_review_status text NOT NULL DEFAULT 'pending' CHECK (finance_review_status IN ('pending', 'approved', 'rejected')),
  finance_review_by uuid REFERENCES auth.users(id),
  finance_review_notes text,
  finance_review_at timestamptz,

  final_approval_status text NOT NULL DEFAULT 'pending' CHECK (final_approval_status IN ('pending', 'approved', 'rejected')),
  final_approval_by uuid REFERENCES auth.users(id),
  final_approval_notes text,
  final_approval_at timestamptz,

  sent_to_client_at timestamptz,
  sent_to_client_by uuid REFERENCES auth.users(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bafo_requests_opportunity ON public.bafo_requests (opportunity_id);
CREATE INDEX idx_bafo_requests_status ON public.bafo_requests (status);

-- ---- Role gate + sequential ordering, enforced server-side -----------------
CREATE OR REPLACE FUNCTION public.protect_bafo_step_transitions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Step 1: commercial_review — bd_manager, sales_manager, or system_admin.
  IF NEW.commercial_review_status IS DISTINCT FROM OLD.commercial_review_status THEN
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['bd_manager','sales_manager','system_admin']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only BD Manager, Sales Manager, or System Admin may decide the commercial review step';
    END IF;
    NEW.commercial_review_by := _uid;
    NEW.commercial_review_at := now();
  END IF;

  -- Step 2: cost_approval — estimation_manager or system_admin. Cannot be
  -- decided until step 1 is approved.
  IF NEW.cost_approval_status IS DISTINCT FROM OLD.cost_approval_status THEN
    IF OLD.commercial_review_status != 'approved' THEN
      RAISE EXCEPTION 'Commercial review must be approved before cost approval';
    END IF;
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['estimation_manager','system_admin']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only Estimation Manager or System Admin may decide the cost approval step';
    END IF;
    NEW.cost_approval_by := _uid;
    NEW.cost_approval_at := now();
  END IF;

  -- Step 3: finance_review — finance_manager or system_admin. Cannot be
  -- decided until step 2 is approved.
  IF NEW.finance_review_status IS DISTINCT FROM OLD.finance_review_status THEN
    IF OLD.cost_approval_status != 'approved' THEN
      RAISE EXCEPTION 'Cost approval must be approved before finance review';
    END IF;
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['finance_manager','system_admin']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only Finance Manager or System Admin may decide the finance review step';
    END IF;
    NEW.finance_review_by := _uid;
    NEW.finance_review_at := now();
  END IF;

  -- Step 4: final_approval — executive (managing_director/general_manager/
  -- ceo) or system_admin. Cannot be decided until step 3 is approved.
  IF NEW.final_approval_status IS DISTINCT FROM OLD.final_approval_status THEN
    IF OLD.finance_review_status != 'approved' THEN
      RAISE EXCEPTION 'Finance review must be approved before final approval';
    END IF;
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['managing_director','general_manager','ceo','system_admin']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only an executive or System Admin may decide the final approval step';
    END IF;
    NEW.final_approval_by := _uid;
    NEW.final_approval_at := now();
  END IF;

  -- Overall status: any step rejected → whole request rejected (chain
  -- stops); all four approved → whole request approved.
  IF NEW.commercial_review_status = 'rejected' OR NEW.cost_approval_status = 'rejected'
     OR NEW.finance_review_status = 'rejected' OR NEW.final_approval_status = 'rejected' THEN
    NEW.status := 'rejected';
  ELSIF NEW.final_approval_status = 'approved' THEN
    NEW.status := 'approved';
  END IF;

  -- Sending to the client requires the full chain approved first.
  IF NEW.sent_to_client_at IS NOT NULL AND OLD.sent_to_client_at IS NULL THEN
    IF NEW.status != 'approved' THEN
      RAISE EXCEPTION 'Cannot mark a BAFO request as sent to client before it is fully approved';
    END IF;
    NEW.sent_to_client_by := _uid;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_bafo_step_transitions
  BEFORE UPDATE ON public.bafo_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_bafo_step_transitions();

-- ---- Audit logging for every step decision ---------------------------------
CREATE OR REPLACE FUNCTION public.audit_bafo_step_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.commercial_review_status IS DISTINCT FROM OLD.commercial_review_status
     OR NEW.cost_approval_status IS DISTINCT FROM OLD.cost_approval_status
     OR NEW.finance_review_status IS DISTINCT FROM OLD.finance_review_status
     OR NEW.final_approval_status IS DISTINCT FROM OLD.final_approval_status THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
      VALUES (auth.uid(), 'user', 'bafo.step_decided', 'bafo_request', NEW.id,
              to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  IF NEW.sent_to_client_at IS NOT NULL AND OLD.sent_to_client_at IS NULL THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (auth.uid(), 'user', 'bafo.sent_to_client', 'bafo_request', NEW.id, to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_bafo_step_decision
  AFTER UPDATE ON public.bafo_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_bafo_step_decision();

-- ---- RLS --------------------------------------------------------------------
ALTER TABLE public.bafo_requests ENABLE ROW LEVEL SECURITY;

-- Readable by: the requester, anyone who can view all sales data (same
-- visibility rule as opportunities/rfqs/etc. — 20260727170000), or any of
-- the four approver roles (they need to see requests awaiting their step
-- even for a rep outside their normal visibility).
CREATE POLICY "BAFO requests readable by requester, managers, or approvers" ON public.bafo_requests
  FOR SELECT TO authenticated
  USING (
    public.is_active_user((SELECT auth.uid()))
    AND (
      requested_by = (SELECT auth.uid())
      OR public.can_view_all_sales_data((SELECT auth.uid()))
      OR public.has_any_role((SELECT auth.uid()), ARRAY[
           'bd_manager','sales_manager','estimation_manager','finance_manager',
           'managing_director','general_manager','ceo'
         ]::public.app_role[])
    )
  );

-- Any sales contributor (salesperson and above) may request a BAFO.
CREATE POLICY "BAFO requests insertable by sales contributors" ON public.bafo_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user((SELECT auth.uid()))
    AND requested_by = (SELECT auth.uid())
    AND public.is_sales_contributor((SELECT auth.uid()))
  );

-- Updates (deciding a step, marking sent-to-client) are broadly allowed at
-- the RLS layer — the trigger above is the real per-step role gate, same
-- division of labor as protect_opportunity_owner()/protect_rfq_estimated_value().
CREATE POLICY "BAFO requests updatable by active users" ON public.bafo_requests
  FOR UPDATE TO authenticated
  USING (public.is_active_user((SELECT auth.uid())))
  WITH CHECK (public.is_active_user((SELECT auth.uid())));

GRANT SELECT, INSERT, UPDATE ON public.bafo_requests TO authenticated;
GRANT ALL ON public.bafo_requests TO service_role;
