-- =========================================================
-- Historical Sales Archive — surface the last two columns that carry data.
--
-- The masterlist has 23 columns and every one is already stored verbatim in
-- historical_sales_rows.raw. Fifteen are read by the mapper. Checked against
-- the source file and production on 2026-08-25, the eight that are not split
-- cleanly in two:
--
--   DESIGNATION   589 / 679 rows  (86%)   the contact's job title
--   LAST UPDATE   483 / 679 rows  (71%)   when the row was last touched
--
--   (unnamed col) 4 / 679         NOTES 0 / 679        STATUS 2 / 679
--   DATE REQUESTED 11 / 679       ONEDRIVE LINK 8 / 679  LAST UPDATE (dup) 1 / 679
--
-- The first two are real data that nobody can see. The other six are empty
-- spreadsheet columns; surfacing them would add six always-blank fields to
-- every record, which is worse than leaving them in raw where they already are.
--
-- WHY THE VIEW AND NOT THE MAPPED TABLE
-- -------------------------------------
-- historical_sales_search already reads EMAIL SUBJECT and UPDATE LOG straight
-- out of raw at query time rather than materialising them. That is the right
-- home for a column nobody filters or indexes on, and it means this change
-- needs no ALTER TABLE, no backfill and no remap — the data is already there.
--
-- LAST UPDATE STAYS TEXT ON PURPOSE
-- ---------------------------------
-- 398 of its 483 values parse as M/D/YYYY. The other 85 do not — they are
-- notes people typed into a date column. Forcing DATE would silently discard
-- those 85. The archive is a record of what the spreadsheet says, so it says it.
-- =========================================================

CREATE OR REPLACE VIEW public.historical_sales_search AS
  SELECT
    m.row_id,
    m.batch_id,
    m.sales_code_raw          AS sales_code,
    m.base_code,
    m.revision_no,
    m.variant,
    m.owner_prefix,
    m.owner_user_id,
    m.owner_label             AS owner,
    m.client_name_raw         AS client,
    m.company_id,
    m.company_matched,
    m.project_name_raw        AS project,
    m.project_location        AS location,
    m.route,
    m.status_raw              AS status,
    m.status_canonical,
    m.amount_excl_vat         AS amount,
    m.currency,
    m.date_received,
    m.date_submitted,
    m.contact_name,
    m.contact_email,
    m.contact_mobile,
    public.historical_raw_get(r.raw, '^EMAIL SUBJECT$') AS email_subject,
    public.historical_raw_get(r.raw, '^UPDATE LOG$')    AS update_log,
    -- The two additions. Matched by pattern, like every other column here,
    -- because the spreadsheet headers carry stray whitespace and newlines.
    public.historical_raw_get(r.raw, '^DESIGNATION$')   AS contact_designation,
    public.historical_raw_get(r.raw, '^LAST UPDATE$')   AS last_update_note,
    r.row_number,
    -- One column to type into. Designation joins it: "procurement engineer"
    -- is a real way to look for the person you dealt with.
    lower(concat_ws(' ',
      m.sales_code_raw, m.base_code, m.client_name_raw, m.project_name_raw,
      m.project_location, m.owner_label, m.status_raw, m.contact_name,
      public.historical_raw_get(r.raw, '^DESIGNATION$')
    ))                        AS search_text
  FROM public.historical_sales_mapped m
  JOIN public.historical_sales_rows   r ON r.id = m.row_id
 WHERE public.can_read_historical_sales((SELECT auth.uid()));

COMMENT ON VIEW public.historical_sales_search IS
  'Read model for the Historical Sales Archive. Reads the mapped row and pulls EMAIL SUBJECT, UPDATE LOG, DESIGNATION and LAST UPDATE straight from the raw record — columns that are displayed but never filtered or indexed on. LAST UPDATE is text, not a date: 85 of its 483 values are notes rather than dates and casting would drop them.';

GRANT SELECT ON public.historical_sales_search TO authenticated;
