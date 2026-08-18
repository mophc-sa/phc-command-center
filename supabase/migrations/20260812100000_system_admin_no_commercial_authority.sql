-- =========================================================
-- Phase 1 governance — system_admin is technical administration only.
-- PRD 2026-08-12, §111–114: "system_admin gets no automatic BAFO, selling
-- price, contract, Won, or vendor selection rights — a second role is
-- granted instead."
--
-- WHAT WAS WRONG
--
-- `system_admin` was written into every commercial gate as a
-- "platform-admin override":
--
--   * protect_bafo_step_transitions() accepted it at ALL FOUR steps of the
--     discount chain (20260727220000). A single account holding only
--     system_admin could raise a BAFO request and then approve commercial
--     review, cost, finance and final approval on it — by itself. The
--     four-step control enforced an ORDER, not four independent judgements.
--   * can_edit_total_value() accepted it (20260727180000), so the same
--     account could also set the commercial value the pipeline is measured
--     on.
--
-- This is not theoretical: the read-only role review on 2026-08-06 found a
-- live account holding eight roles that already collapsed the whole chain.
-- Removing the override is the half of that problem the system owns.
--
-- WHAT THIS MIGRATION DOES
--
-- Replaces two functions in place. Roles in this system are ADDITIVE, so an
-- administrator who legitimately decides one of these steps simply also
-- holds the matching business role, and the check passes on the strength of
-- that role. `system_admin` + `finance_manager` still approves the finance
-- step — and it does so *as* finance_manager, which is what the audit trail
-- should say.
--
-- SAFETY
--
-- Additive and reversible: no schema change, no data change, no row is
-- touched. Two CREATE OR REPLACE FUNCTION statements, both narrowing a
-- permission check. Nothing is dropped. Reverting means restoring the two
-- previous function bodies.
--
-- NOT APPLIED REMOTELY. Local/CI only until explicitly approved — see
-- docs/deployment-governance.md.
-- =========================================================

-- ---- 1. BAFO chain: drop the system_admin override at every step ----------

CREATE OR REPLACE FUNCTION public.protect_bafo_step_transitions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Step 1: commercial_review — bd_manager or sales_manager.
  IF NEW.commercial_review_status IS DISTINCT FROM OLD.commercial_review_status THEN
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['bd_manager','sales_manager']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only BD Manager or Sales Manager may decide the commercial review step';
    END IF;
    NEW.commercial_review_by := _uid;
    NEW.commercial_review_at := now();
  END IF;

  -- Step 2: cost_approval — estimation_manager. Cannot be decided until
  -- step 1 is approved.
  IF NEW.cost_approval_status IS DISTINCT FROM OLD.cost_approval_status THEN
    IF OLD.commercial_review_status != 'approved' THEN
      RAISE EXCEPTION 'Commercial review must be approved before cost approval';
    END IF;
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['estimation_manager']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only the Estimation Manager may decide the cost approval step';
    END IF;
    NEW.cost_approval_by := _uid;
    NEW.cost_approval_at := now();
  END IF;

  -- Step 3: finance_review — finance_manager. Cannot be decided until
  -- step 2 is approved.
  IF NEW.finance_review_status IS DISTINCT FROM OLD.finance_review_status THEN
    IF OLD.cost_approval_status != 'approved' THEN
      RAISE EXCEPTION 'Cost approval must be approved before finance review';
    END IF;
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['finance_manager']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only the Finance Manager may decide the finance review step';
    END IF;
    NEW.finance_review_by := _uid;
    NEW.finance_review_at := now();
  END IF;

  -- Step 4: final_approval — executive (managing_director/general_manager/
  -- ceo). Cannot be decided until step 3 is approved.
  IF NEW.final_approval_status IS DISTINCT FROM OLD.final_approval_status THEN
    IF OLD.finance_review_status != 'approved' THEN
      RAISE EXCEPTION 'Finance review must be approved before final approval';
    END IF;
    IF _uid IS NOT NULL AND NOT public.has_any_role(_uid, ARRAY['managing_director','general_manager','ceo']::public.app_role[]) THEN
      RAISE EXCEPTION 'Only an executive may decide the final approval step';
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

COMMENT ON FUNCTION public.protect_bafo_step_transitions() IS
  'BAFO 4-step chain. Each step requires its own business role; system_admin '
  'carries no override (PRD 2026-08-12 §111-114). Roles are additive, so an '
  'admin who also holds the business role still passes, as that role.';

-- ---- 2. Total Value: drop the system_admin grant --------------------------

CREATE OR REPLACE FUNCTION public.can_edit_total_value(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['finance_manager', 'bd_manager']::public.app_role[]
  );
$$;

COMMENT ON FUNCTION public.can_edit_total_value(uuid) IS
  'Total Value edit authority: finance_manager or bd_manager. system_admin '
  'removed 2026-08-12 (PRD §111-114) — platform administration is not a '
  'reason to set the commercial value.';

-- Grants are unchanged from 20260727180000; restated so the function keeps
-- its intended exposure after CREATE OR REPLACE.
REVOKE EXECUTE ON FUNCTION public.can_edit_total_value(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_total_value(uuid) TO authenticated;
