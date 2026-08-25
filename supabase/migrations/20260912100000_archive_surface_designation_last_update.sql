-- =========================================================
-- Historical Sales Archive — surface the last two columns that carry data.
--
-- The masterlist has 23 columns and every one is already stored verbatim in
-- historical_sales_rows.raw. Fifteen are read. Checked against the source file
-- and production on 2026-08-25 (679 rows, 653 sales codes, 560 unique — an
-- exact match), the eight that are not split cleanly in two:
--
--   DESIGNATION   589 / 679 rows  (86%)   the contact's job title
--   LAST UPDATE   483 / 679 rows  (71%)   when the row was last touched
--
--   (unnamed) 4 · NOTES 0 · STATUS 2 · DATE REQUESTED 11 · ONEDRIVE 8 · dup 1
--
-- The first two are real data nobody can see. The other six are empty
-- spreadsheet residue; surfacing them would put six permanently blank fields
-- on every record.
--
-- WHY THE VIEW AND NOT THE MAPPED TABLE
-- -------------------------------------
-- The view already reads EMAIL SUBJECT and UPDATE LOG straight from raw at
-- query time. That is the right home for a column nobody filters or indexes
-- on, and it means no table change, no backfill, no remap.
--
-- BUILT FROM THE CURRENT DEFINITION, WHICH IS THE ONE IN 20260911120000
-- --------------------------------------------------------------------
-- Not the original in 20260825100000. The promotion-hardening migration
-- rebuilt this view and added follow_up, promotion_status,
-- promoted_opportunity_id, promoted_quotation_id and collision_class. Copying
-- the older definition dropped those five, and Postgres refused the whole
-- statement with "cannot drop columns from view" (42P16). Twice.
--
-- LAST UPDATE STAYS TEXT ON PURPOSE
-- ---------------------------------
-- 398 of its 483 values parse as M/D/YYYY. The other 85 are notes people typed
-- into a date column. Casting would discard them.
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
    m.follow_up_raw           AS follow_up,
    m.amount_excl_vat         AS amount,
    m.currency,
    m.date_received,
    m.date_submitted,
    m.contact_name,
    public.historical_raw_get(r.raw, '^EMAIL SUBJECT$') AS email_subject,
    public.historical_raw_get(r.raw, '^UPDATE LOG$')    AS update_log,
    r.row_number,
    COALESCE(req.status::TEXT, 'not_promoted')          AS promotion_status,
    req.promoted_opportunity_id,
    req.promoted_quotation_id,
    public.historical_collision_class(m.row_id)         AS collision_class,
    lower(concat_ws(' ',
      m.sales_code_raw, m.base_code, m.client_name_raw, m.project_name_raw,
      m.project_location, m.owner_label, m.status_raw, m.contact_name,
      public.historical_raw_get(r.raw, '^DESIGNATION$')
    ))                        AS search_text,
    -- APPENDED, and that is not a style choice. CREATE OR REPLACE VIEW may only
    -- add columns at the END. The migration that introduced follow_up hit the
    -- same rule and dropped the view to place it mid-row; these two are
    -- metadata nobody scans a row for, so appending is both correct and avoids
    -- a window where the view does not exist.
    public.historical_raw_get(r.raw, '^DESIGNATION$')   AS contact_designation,
    public.historical_raw_get(r.raw, '^LAST UPDATE$')   AS last_update_note
  FROM public.historical_sales_mapped m
  JOIN public.historical_sales_rows   r ON r.id = m.row_id
  LEFT JOIN LATERAL (
    SELECT p.* FROM public.historical_promotion_requests p
     WHERE p.row_id = m.row_id
     ORDER BY (p.status = 'promoted') DESC, p.created_at DESC
     LIMIT 1
  ) req ON TRUE
 WHERE public.can_read_historical_sales((SELECT auth.uid()));

COMMENT ON VIEW public.historical_sales_search IS
  'Read model for the Historical Sales Archive. Pulls EMAIL SUBJECT, UPDATE LOG, DESIGNATION and LAST UPDATE straight from the raw record — columns that are displayed but never filtered or indexed on. LAST UPDATE is text, not a date: 85 of its 483 values are notes rather than dates, and casting would discard them.';

GRANT SELECT ON public.historical_sales_search TO authenticated;
