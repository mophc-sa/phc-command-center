-- =========================================================
-- Phase 3 — JIH / Tender / Opportunity execution.
-- PRD 2026-08-12 §17-19, §39-40.
--
-- Additive only: new columns and one CHECK-constrained text column each.
-- No enum is altered (same reason as Phase 2: a new enum value cannot be used
-- in the transaction that adds it, and Supabase runs one transaction per
-- migration). Nothing is dropped and no existing value is rewritten except
-- two guarded backfills that describe rows where they already are.
--
-- NOT APPLIED REMOTELY. Local/CI only until explicitly approved.
-- =========================================================

-- ---- 1. Tender subtype -----------------------------------------------------
-- PRD §12 splits tenders into contractor-bidding and government/owner
-- pre-award. Phase 2 captured that at intake (inbox_items.request_type); it
-- was lost the moment the tender record was created, because `tenders` had
-- nowhere to put it. The distinction is what separates "chase the contractor
-- who is bidding" from "watch a project with no contractor yet".
ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS tender_subtype text
    CHECK (tender_subtype IN ('contractor','government'));

-- ---- 2. Winning contractor at award ---------------------------------------
-- `main_contractor_id` already exists and is reused as the winner. What was
-- missing is WHEN it was decided and on what evidence — without that, an
-- awarded tender cannot be told from a guess.
ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS winning_contractor_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS winning_contractor_name text,
  ADD COLUMN IF NOT EXISTS contractor_award_date date,
  ADD COLUMN IF NOT EXISTS contractor_award_evidence text;

-- ---- 3. Tender -> JIH back-link -------------------------------------------
-- The tender already points at the opportunity it produced
-- (tenders.converted_opportunity_id). The opportunity pointed nowhere, so from
-- a converted JIH there was no way back to the tender history that produced
-- it. PRD §3 requires the history to survive the conversion.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS source_tender_id uuid REFERENCES public.tenders(id);

CREATE INDEX IF NOT EXISTS idx_opportunities_source_tender ON public.opportunities (source_tender_id);

-- One tender converts to at most one opportunity. This is the duplicate
-- protection PRD §3 asks for, and it is a constraint rather than a check in
-- application code because the conversion runs from two callers (the approval
-- engine and the legacy handler).
CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunities_source_tender
  ON public.opportunities (source_tender_id) WHERE source_tender_id IS NOT NULL;

-- Backfill the back-link from the existing forward link, so already-converted
-- tenders are not left half-linked.
UPDATE public.opportunities o
   SET source_tender_id = t.id
  FROM public.tenders t
 WHERE t.converted_opportunity_id = o.id
   AND o.source_tender_id IS NULL;

-- ---- 4. Commercial handoff status -----------------------------------------
-- PRD §19: independent of the sales stage. A deal can sit at "JIH" while the
-- file is with Commercial, or at "Verbally Awarded" while it is back with
-- Sales. Collapsing the two is what made "where is this file right now?"
-- unanswerable.
--
-- All nine states are defined now so the vocabulary is fixed and downstream
-- phases inherit it rather than inventing their own. Sales only drives the
-- first two today; the rest are set by Commercial & Finance when that exists.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS commercial_handoff_status text NOT NULL DEFAULT 'with_sales'
    CHECK (commercial_handoff_status IN (
      'with_sales','waiting_management','with_commercial','waiting_vendor',
      'waiting_gm','final_review','ready_for_sales','submitted','waiting_client')),
  ADD COLUMN IF NOT EXISTS commercial_handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS commercial_handoff_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS commercial_handoff_note text;

CREATE INDEX IF NOT EXISTS idx_opportunities_handoff ON public.opportunities (commercial_handoff_status);

-- ---- 5. Win probability: AI and human are separate facts -------------------
-- `score` (0-100) is the AI's, with score_reasons / scored_at / scored_by
-- already present. A manager's own number was previously written over it via
-- score_manual_override, which destroyed the comparison — you could no longer
-- ask "where does the model disagree with the desk?".
--
-- The human number now lives in its own columns. Neither ever overwrites the
-- other; a UI shows both.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS human_win_probability integer
    CHECK (human_win_probability IS NULL OR (human_win_probability BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS human_probability_reason text,
  ADD COLUMN IF NOT EXISTS human_probability_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_probability_by uuid REFERENCES auth.users(id);

-- ---- 5b. Contract Signed ---------------------------------------------------
-- The stage existed in the enum and in the client's transition map but was
-- unreachable (the server map omitted it), so nothing ever needed a date for
-- it. Now that the stage is reachable, it needs one.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS contract_signed_date date;

-- ---- 6. Lost: competitor is optional context, not a required field ---------
-- loss_reason and loss_notes already exist and loss_reason is already
-- mandatory server-side (validateSalesStage). Only the competitor was missing.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS lost_to_competitor text,
  ADD COLUMN IF NOT EXISTS lost_at_stage text;

-- ---- 7. Keep the tender subtype that intake already captured ---------------
-- Existing tenders predate the subtype. Anything converted from an intake item
-- that said "government" is government; everything else is left NULL rather
-- than guessed, because a wrong subtype is worse than an absent one.
UPDATE public.tenders t
   SET tender_subtype = 'government'
  FROM public.inbox_items i
 WHERE i.converted_record_id = t.id
   AND i.converted_record_type = 'tender'
   AND i.request_type = 'tender_government'
   AND t.tender_subtype IS NULL;

UPDATE public.tenders t
   SET tender_subtype = 'contractor'
  FROM public.inbox_items i
 WHERE i.converted_record_id = t.id
   AND i.converted_record_type = 'tender'
   AND i.request_type = 'tender_contractor'
   AND t.tender_subtype IS NULL;
