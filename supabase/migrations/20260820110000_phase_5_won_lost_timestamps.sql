-- =========================================================
-- Phase 5 — record WHEN a deal was won, instead of guessing.
--
-- THE PROBLEM
-- -----------
-- There is no won date on an opportunity. Period-scoped KPIs therefore fell
-- back to `updated_at`, which moves on any edit — a deal won in March and
-- re-saved in August reads as an August win, and the month's numbers are wrong
-- in a way nobody can see. `stage_transition_history` is the honest source but
-- holds a single row in production, so it cannot answer for older records.
--
-- THE FIX
-- -------
-- A dedicated timestamp, written once at the moment of transition and never
-- moved by an ordinary edit. `lost_at` is added alongside it: the KPI engine
-- treats won and lost symmetrically, and leaving one accurate while the other
-- silently guessed would be incoherent.
--
-- WHAT IS DELIBERATELY NOT DONE
-- -----------------------------
-- No backfill from `updated_at`. Inventing a plausible date is worse than
-- admitting there isn't one: a guessed date is indistinguishable from a real
-- one downstream, and it would quietly corrupt every period comparison from
-- here on. Rows with no trustworthy evidence keep NULL, and the analytics layer
-- reports them as an explicit "no recorded date" count rather than dropping
-- them or folding them into an arbitrary month.
--
-- The only backfill is from stage_transition_history, which records the actual
-- transition with its actor. In production that table currently holds zero won
-- or lost rows, so this backfill is a no-op today and exists for correctness on
-- any environment that does have history.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. The columns ============
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS won_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;

COMMENT ON COLUMN public.opportunities.won_at IS
  'When the opportunity actually reached sales_stage = won. Set once by trg_stamp_outcome_dates and never moved by a later edit. NULL means no trustworthy date exists — analytics reports those as undated rather than guessing from updated_at.';
COMMENT ON COLUMN public.opportunities.lost_at IS
  'When the opportunity actually reached sales_stage = lost. Same write-once rule as won_at.';

-- ============ 2. Stamp on transition ============
CREATE OR REPLACE FUNCTION public.stamp_outcome_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Write-once. A deal that is won, reopened and won again keeps the FIRST
  -- award date: that is the date the commercial outcome happened, and letting a
  -- later edit move it is exactly the updated_at failure this replaces.
  IF NEW.sales_stage = 'won' AND OLD.sales_stage IS DISTINCT FROM 'won' AND NEW.won_at IS NULL THEN
    NEW.won_at := now();
  END IF;

  IF NEW.sales_stage = 'lost' AND OLD.sales_stage IS DISTINCT FROM 'lost' AND NEW.lost_at IS NULL THEN
    NEW.lost_at := now();
  END IF;

  -- Never let an ordinary update clear or rewrite a stamped date. A correction
  -- is possible, but only by deliberately setting it to NULL first, which is a
  -- visible act rather than a side effect of editing something else.
  IF OLD.won_at IS NOT NULL AND NEW.won_at IS DISTINCT FROM OLD.won_at THEN
    NEW.won_at := OLD.won_at;
  END IF;
  IF OLD.lost_at IS NOT NULL AND NEW.lost_at IS DISTINCT FROM OLD.lost_at THEN
    NEW.lost_at := OLD.lost_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_outcome_dates ON public.opportunities;
CREATE TRIGGER trg_stamp_outcome_dates
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.stamp_outcome_dates();

-- ============ 3. Backfill — from real history only ============
-- The earliest recorded transition into the outcome is the award date. Only
-- rows that actually have such a transition are touched; everything else is
-- left NULL on purpose.
WITH first_won AS (
  SELECT record_id, MIN(created_at) AS at
    FROM public.stage_transition_history
   WHERE record_type = 'opportunity' AND to_stage = 'won'
   GROUP BY record_id
)
UPDATE public.opportunities o
   SET won_at = f.at
  FROM first_won f
 WHERE o.id = f.record_id
   AND o.won_at IS NULL;

WITH first_lost AS (
  SELECT record_id, MIN(created_at) AS at
    FROM public.stage_transition_history
   WHERE record_type = 'opportunity' AND to_stage = 'lost'
   GROUP BY record_id
)
UPDATE public.opportunities o
   SET lost_at = f.at
  FROM first_lost f
 WHERE o.id = f.record_id
   AND o.lost_at IS NULL;

-- ============ 4. Read-path index ============
-- Period-scoped Won is the most common analytics filter; partial because only
-- closed deals carry a date.
CREATE INDEX IF NOT EXISTS idx_opportunities_won_at
    ON public.opportunities (won_at DESC) WHERE won_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_lost_at
    ON public.opportunities (lost_at DESC) WHERE lost_at IS NOT NULL;
