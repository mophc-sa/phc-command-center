-- =========================================================
-- HOTFIX — the opportunity score's guards were in TypeScript only.
--
-- A CORRECTION FIRST
-- ------------------
-- Phases 11, 12 and 13 each reported that opportunities.score,
-- agent_recommendation and agent_reasoning were "AI writing directly to a
-- canonical record, unguarded". That was wrong, and it was repeated three
-- times without being checked.
--
-- scoreOpportunity() in src/lib/opportunity-scoring.ts is a deterministic
-- rules engine, not a model call, and scored_by is the HUMAN who pressed
-- recompute. agent_recommendation and agent_reasoning are read-only in the
-- application — only seed.sql writes them.
--
-- WHAT IS ACTUALLY WRONG
-- ----------------------
-- The same defect Phase 8 found in margin, in a different place: a derived
-- value the database accepts as an input.
--
-- The score is computed in the browser and stored verbatim. Two rules exist to
-- keep that honest, and BOTH live in TypeScript:
--
--   * an override requires a reason — checked in overrideOpportunityScore()
--   * scored_by is the current user — set from currentUserId()
--
-- Neither survives contact with PostgREST. A direct PATCH can set
-- score_manual_override = true with no reason, or name someone else as the
-- scorer, and the row will be accepted. The UPDATE policy only asks whether
-- you may touch the opportunity at all.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not move the rules engine into SQL. That would be the Phase 8
-- treatment — compute it, never accept it — and it is the right eventual
-- answer, but porting a scoring model into plpgsql creates two implementations
-- that will drift, and the drift would be silent. This closes the two rules
-- that were claimed to be enforced and were not, and leaves the larger change
-- as a deliberate decision rather than a side effect of a hotfix.
--
-- No existing row violates either rule: of 4 opportunities, 0 are overridden
-- and 0 are overridden without a reason. Checked before writing this.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. An override must say why ============
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_override_has_reason;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_override_has_reason
  CHECK (NOT score_manual_override OR btrim(coalesce(score_override_reason, '')) <> '');

COMMENT ON COLUMN public.opportunities.score_override_reason IS
  'Required whenever score_manual_override is true. Enforced here as well as in the UI: a tier someone set by hand with no stated reason is indistinguishable from a bug in the scorer.';

-- ============ 2. The scorer is the session, not the payload ============
CREATE OR REPLACE FUNCTION public.opportunity_score_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  -- Only engage when something about the score actually moved. Every other
  -- UPDATE on this table — and there are many — passes straight through.
  IF TG_OP = 'UPDATE'
     AND NEW.score                  IS NOT DISTINCT FROM OLD.score
     AND NEW.score_tier             IS NOT DISTINCT FROM OLD.score_tier
     AND NEW.score_manual_override  IS NOT DISTINCT FROM OLD.score_manual_override
     AND NEW.score_override_reason  IS NOT DISTINCT FROM OLD.score_override_reason THEN
    RETURN NEW;
  END IF;

  -- Naming someone else as the scorer would put another person's name against
  -- a judgement they did not make. Unauthenticated paths (the seed, a
  -- migration, cron) keep whatever they set, because there is no session to
  -- attribute it to.
  IF _uid IS NOT NULL THEN
    IF NEW.scored_by IS DISTINCT FROM _uid THEN
      NEW.scored_by := _uid;
    END IF;
    NEW.scored_at := coalesce(
      CASE WHEN NEW.scored_at IS DISTINCT FROM OLD.scored_at THEN NEW.scored_at END,
      now());
  END IF;

  -- Clearing an override must clear its reason too, or the row keeps a
  -- justification for a decision that is no longer in force — and the next
  -- reader has no way to tell it is stale.
  IF NOT NEW.score_manual_override THEN
    NEW.score_override_reason := NULL;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS opportunities_score_guard ON public.opportunities;
CREATE TRIGGER opportunities_score_guard
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.opportunity_score_guard();

COMMENT ON FUNCTION public.opportunity_score_guard IS
  'Stamps the scorer from the session and keeps the override flag and its reason consistent. Engages only when a score field changes, so ordinary opportunity edits are untouched.';
