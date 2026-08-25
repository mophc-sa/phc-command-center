-- =========================================================
-- Phase 2 — Sales Intake + Opportunity Review gate.
-- PRD 2026-08-12 §11-19: every request enters Sales, then passes an internal
-- review before it can go to pricing.
--
-- DESIGN NOTES
--
-- 1. `review_state` and `request_type` are text + CHECK, not new enums.
--    Postgres cannot use a newly added enum value in the same transaction that
--    adds it, and Supabase runs each migration in one transaction — so
--    extending `inbox_status` would have needed two migrations and a deploy
--    between them. Text + CHECK is also how `contracts.stage` already models a
--    small state set in this schema.
--
-- 2. The existing `inbox_status` enum is UNTOUCHED. `review_state` sits beside
--    it and governs the new gate; `status` keeps driving the conversion
--    bookkeeping it already drives. Same compatibility approach Phase 1 used
--    for `sales_stage` vs `stage`.
--
-- 3. Reviewer authority is enforced by a TRIGGER, not only in the client.
--    Phase 1 established that a client-side capability check is not a control
--    (see 20260812100000). `system_admin` alone can decide nothing here — the
--    same rule, applied to the new gate on the day it is built rather than
--    retrofitted later.
--
-- Additive: new columns and one trigger. No column is dropped, no row is
-- rewritten except a one-time backfill of `review_state` for existing rows,
-- which sets them to the state they are already in.
--
-- NOT APPLIED REMOTELY. Local/CI only until explicitly approved.
-- =========================================================

-- ---- 1. Request type: four types, replacing the two-value project_type ------
-- `project_type` (jih|tender) stays as a deprecated compatibility column: the
-- routing code and inferClassification() still read it, and existing rows
-- carry it. `request_type` is the new source of truth and is derived from it
-- for old rows.
ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS request_type text
    CHECK (request_type IN ('jih','tender_contractor','tender_government','unknown'));

-- ---- 2. Intake fields the PRD's minimum-data list requires -----------------
ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS owner_entity text,            -- owner / government entity
  ADD COLUMN IF NOT EXISTS client_rfq_reference text,    -- the client's own reference
  ADD COLUMN IF NOT EXISTS internal_rfq_reference text,  -- ours, when pre-assigned
  -- What actually arrived with the request. Deliberately booleans, not a
  -- document registry: the document layer is a later phase, and the review
  -- gate only needs to know whether the package is complete enough to price.
  ADD COLUMN IF NOT EXISTS has_boq boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_drawings boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_specs boolean NOT NULL DEFAULT false;

-- ---- 3. The review gate ----------------------------------------------------
ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'pending_review'
    CHECK (review_state IN ('pending_review','approved_for_pricing','need_information','monitored','rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reject_reason text,
  -- Need Information
  ADD COLUMN IF NOT EXISTS info_required_items text[],
  ADD COLUMN IF NOT EXISTS info_comment text,
  ADD COLUMN IF NOT EXISTS info_responsible_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS info_due_date date,
  ADD COLUMN IF NOT EXISTS info_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS resubmit_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inbox_items_review_state ON public.inbox_items (review_state);

-- ---- 4. Backfill: describe existing rows, do not move them -----------------
-- Rows already converted are past review by definition; anything else is
-- waiting for it. This states where each row already is; it changes no
-- workflow outcome.
UPDATE public.inbox_items
   SET review_state = CASE
         WHEN status = 'converted'            THEN 'approved_for_pricing'
         WHEN status = 'sent_to_missing_data' THEN 'need_information'
         WHEN status = 'archived'             THEN 'rejected'
         ELSE 'pending_review'
       END
 WHERE review_state = 'pending_review';

UPDATE public.inbox_items
   SET request_type = CASE
         WHEN project_type = 'jih'    THEN 'jih'
         WHEN project_type = 'tender' THEN 'tender_contractor'
         ELSE 'unknown'
       END
 WHERE request_type IS NULL;

-- ---- 5. Who may decide a review -------------------------------------------
CREATE OR REPLACE FUNCTION public.can_review_intake(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Sales Manager OR BD Manager — either alone is sufficient (PRD §15).
  -- Executives included: they outrank both and already hold every commercial
  -- approval in this system. system_admin is NOT here, by the same rule as
  -- the BAFO chain: platform administration is not commercial authority.
  SELECT public.has_any_role(
    _user_id,
    ARRAY['sales_manager','bd_manager','general_manager','managing_director','ceo']::public.app_role[]
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_review_intake(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_intake(uuid) TO authenticated;

COMMENT ON FUNCTION public.can_review_intake(uuid) IS
  'Intake review authority: sales_manager or bd_manager (either alone), plus '
  'executives. system_admin holds no review authority (PRD 2026-08-12 §111-114).';

-- ---- 6. Enforce it server-side --------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_intake_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF NEW.review_state IS NOT DISTINCT FROM OLD.review_state THEN
    RETURN NEW;
  END IF;

  -- Resubmission is the one transition the REQUESTER drives, not the reviewer:
  -- need_information -> pending_review puts the request back in the queue.
  -- This is checked BEFORE the reviewer gate on purpose. Gating it would mean
  -- the salesperson who was asked for the missing BOQ could not hand it back
  -- without a manager doing it for them — which defeats the loop.
  IF OLD.review_state = 'need_information' AND NEW.review_state = 'pending_review' THEN
    NEW.resubmitted_at := now();
    NEW.resubmit_count := COALESCE(OLD.resubmit_count, 0) + 1;
    RETURN NEW;
  END IF;

  -- Every other state change is a review decision and needs the authority.
  -- auth.uid() IS NULL means a service-role/backend caller (the import
  -- pipeline, seeds). Those already bypass RLS; this guard is about
  -- authenticated end users, matching protect_rfq_estimated_value().
  IF _uid IS NOT NULL AND NOT public.can_review_intake(_uid) THEN
    RAISE EXCEPTION 'Only a Sales Manager or BD Manager may decide an intake review';
  END IF;

  IF NEW.review_state = 'rejected' AND COALESCE(btrim(NEW.reject_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejected request must carry a reason';
  END IF;

  IF NEW.review_state = 'need_information'
     AND COALESCE(array_length(NEW.info_required_items, 1), 0) = 0
     AND COALESCE(btrim(NEW.info_comment), '') = '' THEN
    RAISE EXCEPTION 'Need Information requires the missing items or a comment';
  END IF;

  NEW.reviewed_by := _uid;
  NEW.reviewed_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_intake_review ON public.inbox_items;
CREATE TRIGGER trg_protect_intake_review
  BEFORE UPDATE ON public.inbox_items
  FOR EACH ROW EXECUTE FUNCTION public.protect_intake_review();
