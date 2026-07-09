-- =========================================================
-- Sales OS pilot — Sprint 4: Opportunity Scoring.
--
-- Additive only — no columns below already exist on public.opportunities
-- (confirmed against the live schema before writing this migration).
--
-- score_tier is a NEW, dedicated enum ('A'|'B'|'C'|'not_qualified'), kept
-- separate from the existing public.priority_tier ('A'|'B'|'C') used by
-- opportunities.tier, tenders.tender_priority_classification,
-- follow_ups.cadence_tier, and opportunities.action_priority. Adding
-- 'not_qualified' to priority_tier would leak a scoring-model concept into
-- unrelated tender/follow-up/action contexts where it has no meaning —
-- this migration does not touch priority_tier or opportunities.tier at all.
-- "Tier is for opportunities, not tenders" — score_tier only ever appears
-- on public.opportunities.
--
-- No new forecast-flag column: "Sure Win is a forecast flag, not a stage"
-- is already correctly modeled by the existing opportunities.win_confidence
-- enum (low|possible|strong|sure_win, independent of opportunity_stage).
-- The scoring engine suggests a win_confidence value as part of its output;
-- setting it still goes through the existing setWinConfidence action.
--
-- No new RLS policies: these are new columns on an existing, already-RLS-
-- protected table. The existing "Owner or Manager/CEO can update" policy on
-- opportunities already governs who may write them.
-- =========================================================

CREATE TYPE public.opportunity_score_tier AS ENUM ('A', 'B', 'C', 'not_qualified');

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS score INTEGER CHECK (score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_tier public.opportunity_score_tier,
  ADD COLUMN IF NOT EXISTS score_confidence public.confidence_level,
  ADD COLUMN IF NOT EXISTS score_missing_data TEXT[],
  ADD COLUMN IF NOT EXISTS score_reasons TEXT[],
  ADD COLUMN IF NOT EXISTS score_risk_flags TEXT[],
  ADD COLUMN IF NOT EXISTS score_recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS score_manual_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS score_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_score_tier ON public.opportunities(score_tier);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON public.opportunities(score DESC);

NOTIFY pgrst, 'reload schema';
