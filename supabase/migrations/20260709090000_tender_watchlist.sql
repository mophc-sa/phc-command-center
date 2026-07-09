-- =========================================================
-- Sales OS pilot — Sprint 2 (Tender Board): watchlist flag.
--
-- "Watchlist" is a cross-cutting attention marker, not a tender_stage value
-- and not a priority classification (A/B/C stays a classification on a
-- tender record, never confused with an opportunity tier or a stage).
-- Additive + idempotent, no data touched.
-- =========================================================

ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS is_watchlisted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tenders_watchlisted ON public.tenders (is_watchlisted) WHERE is_watchlisted;
