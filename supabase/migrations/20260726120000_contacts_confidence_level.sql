-- =========================================================
-- PHC Sales OS — Phase 1: Contacts confidence_level.
--
-- confidence_score (INT 0-100, display-only — verified via repo-wide grep
-- that nothing sorts/filters/thresholds on it) becomes a qualitative
-- high/medium/low field going forward. Additive only: confidence_score is
-- kept, unused by the form after this, not dropped.
-- =========================================================

CREATE TYPE public.contact_confidence_level AS ENUM ('high', 'medium', 'low');

ALTER TABLE public.contacts ADD COLUMN confidence_level public.contact_confidence_level;

UPDATE public.contacts SET confidence_level = CASE
  WHEN confidence_score >= 70 THEN 'high'
  WHEN confidence_score >= 40 THEN 'medium'
  WHEN confidence_score IS NOT NULL THEN 'low'
  ELSE NULL
END::public.contact_confidence_level;

COMMENT ON COLUMN public.contacts.confidence_level IS
'Qualitative confidence (high/medium/low), replacing the numeric confidence_score in the Contacts form as of Phase 1. confidence_score is kept for historical reference but no longer written to by the form.';
