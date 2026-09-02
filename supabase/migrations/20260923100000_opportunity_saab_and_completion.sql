-- =============================================================================
-- Two intake answers that have to survive the conversion.
--
-- 20260922100000 put `saab_portal` and `completion_pct` on `inbox_items`,
-- because that is the form they are asked on. But an intake item is a doorway:
-- once it routes, the record people actually work is the opportunity, and a
-- field that dies at the doorway is a field nobody asked for.
--
--   completion_pct  decides urgency. Signage is late-stage work: a project at
--                   30% and one at 85% are different opportunities on the same
--                   day, and the difference says who to call first. That
--                   judgement is made on the opportunity, not on the intake row
--                   somebody archived weeks ago.
--
--   saab_portal     changes HOW the quotation is submitted. That is needed at
--                   the moment of quoting, which is well past intake.
--
-- The four `*_other` free-text columns deliberately do NOT come across. They
-- explain a classification made at intake -- why "other" was picked from a list
-- that only exists on the intake form -- and carrying them onto the opportunity
-- would put an answer next to a question that is not there.
--
-- NULL is not zero, again. A project with no percentage is one nobody has
-- reported on; a project at 0 has not broken ground. Reading one as the other
-- puts an enquiry at the wrong end of the queue.
-- =============================================================================

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS saab_portal    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS completion_pct SMALLINT;

ALTER TABLE public.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_completion_pct_range;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_completion_pct_range
  CHECK (completion_pct IS NULL OR (completion_pct >= 0 AND completion_pct <= 100));

COMMENT ON COLUMN public.opportunities.completion_pct IS
  'Construction progress, 0-100, or NULL for unknown. Carried from intake and editable after. Signage is late-stage work, so this decides urgency. NULL is not 0.';
COMMENT ON COLUMN public.opportunities.saab_portal IS
  'Client runs RFQs through the SAAB ARABIA portal, which changes how the quotation must be submitted. Carried from intake.';
