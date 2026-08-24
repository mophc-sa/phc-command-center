-- =========================================================
-- Historical promotion — enum additions, alone in their own migration.
--
-- Postgres refuses to USE a new enum value in the same transaction that added
-- it, and every later object in this batch (the transition guard, the void
-- function, the partial unique index) needs 'voided' as a literal. Splitting
-- the ADD VALUE out is the only thing that makes the rest applicable in one
-- pass. Same reason 20260828100000 exists for document_entity_type.
--
-- 'voided' is the reversal state for a promotion that should not have
-- happened: the opportunity is archived, the request keeps its provenance and
-- its audit trail, and the archive row becomes promotable again. It is NOT
-- 'cancelled' — cancelling is abandoning a request before it created anything,
-- voiding is undoing one that did.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

ALTER TYPE public.historical_promotion_status ADD VALUE IF NOT EXISTS 'voided' AFTER 'promoted';
