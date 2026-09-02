-- =============================================================================
-- What the entry form asks, from the 2026-09-02 report.
--
-- Five requests, all of them about the same thing: the form's lists did not
-- match the business, and a list that has no row for your answer teaches people
-- to pick the nearest wrong one. Every count below is a wrong answer that will
-- be read later as a right one.
--
--   1. CLIENT TYPE
--      Asked for: main contractor, subcontractor, owner, consultant, other.
--      Present:   main_client, contractor_jih, contractor_tender, consultant.
--
--      `contractor_jih` and `contractor_tender` do not describe a client at
--      all -- they describe which TRACK the work is on, which the request type
--      already carries. And there was no row for a subcontractor or an owner,
--      the two counterparties a signage quote most often goes to.
--
--      The old labels are NOT removed. Postgres cannot drop an enum value, and
--      more to the point ten live rows use them; re-pointing those is a
--      business decision about records somebody entered on purpose, not a
--      migration's call. They stay readable and stop being offered.
--
--   2. SOURCE = phone call. Eight of the twelve items came in as
--      `email_placeholder` because there was nothing else to pick. A call is
--      how most of this work actually arrives.
--
--   3. "OTHER" ON EVERY LIST, with somewhere to write what it was. A closed
--      list with no escape is answered wrongly, silently. Each list gets its
--      own free-text column: one shared column could not say WHICH question
--      the text answers when two lists are both set to other.
--
--   4. SAAB ARABIA PORTAL. Whether the client runs their RFQs through it
--      changes how the quote has to be submitted, and there was nowhere to
--      record it.
--
--   5. PROJECT COMPLETION. Signage is late-stage work: a project at 30% and one
--      at 85% are different opportunities on the same day, and the difference
--      decides who to call first.
--
-- Measured before writing: `inbox_items` holds 12 rows.
-- =============================================================================

-- ---- 1. Enum values -------------------------------------------------------
-- ADD VALUE only. They are not used anywhere in this file, which is what lets
-- them be added inside the migration's transaction.

ALTER TYPE public.inbox_client_type ADD VALUE IF NOT EXISTS 'main_contractor';
ALTER TYPE public.inbox_client_type ADD VALUE IF NOT EXISTS 'subcontractor';
ALTER TYPE public.inbox_client_type ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.inbox_client_type ADD VALUE IF NOT EXISTS 'other';

ALTER TYPE public.inbox_source_type ADD VALUE IF NOT EXISTS 'phone_call';

ALTER TYPE public.inbox_rfq_from   ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE public.inbox_scope      ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE public.inbox_location   ADD VALUE IF NOT EXISTS 'other';

-- ---- 2. Columns -----------------------------------------------------------

ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS client_type_other TEXT,
  ADD COLUMN IF NOT EXISTS rfq_from_other    TEXT,
  ADD COLUMN IF NOT EXISTS scope_type_other  TEXT,
  ADD COLUMN IF NOT EXISTS location_other    TEXT,
  ADD COLUMN IF NOT EXISTS saab_portal       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS completion_pct    SMALLINT;

-- A percentage, or nothing. NULL is "nobody said", which is a different fact
-- from 0 -- a project at zero has not broken ground, and reading one as the
-- other would put a signage enquiry at the wrong end of the queue.
ALTER TABLE public.inbox_items
  DROP CONSTRAINT IF EXISTS inbox_items_completion_pct_range;
ALTER TABLE public.inbox_items
  ADD CONSTRAINT inbox_items_completion_pct_range
  CHECK (completion_pct IS NULL OR (completion_pct >= 0 AND completion_pct <= 100));

COMMENT ON COLUMN public.inbox_items.client_type_other IS
  'Free text for client_type = other. One column per list on purpose: a single shared column cannot say which question the text answers.';
COMMENT ON COLUMN public.inbox_items.saab_portal IS
  'Client runs RFQs through the SAAB ARABIA portal, which changes how the quotation must be submitted.';
COMMENT ON COLUMN public.inbox_items.completion_pct IS
  'Construction progress, 0-100, or NULL for unknown. Signage is late-stage work, so this decides urgency. NULL is not 0.';

-- ---- 3. Grants ------------------------------------------------------------
-- Column-level rights follow the table's, so nothing new is needed here. Said
-- out loud because on 2026-09-02 a whole feature shipped broken on the
-- assumption that grants live somewhere a migration had written them down --
-- see 20260921100000. They do not; for inbox_items they were already granted
-- with the table, and adding a column does not change that.
