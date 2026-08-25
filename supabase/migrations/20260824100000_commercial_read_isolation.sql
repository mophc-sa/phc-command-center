-- =========================================================
-- SECURITY HOTFIX A — commercial cost and margin are no longer world-readable.
--
-- THE EXPOSURE
-- ------------
-- Three predicates, in full:
--
--   boqs       SELECT  USING (is_active_user(auth.uid()))
--   boq_items  SELECT  USING (is_active_user(auth.uid()))
--   quotations SELECT  USING (is_active_user(...) AND (owner_id = ... OR can_view_all_sales_data(...)))
--
-- `boq_items` carries `unit_rate`, `cost_estimate` and `selling_price`, and
-- `boqs.estimated_value` is written by the AI extractor as the sum of
-- quantity x unit_rate — a cost roll-up. So every active account reads what
-- every job costs us and what we intend to charge: `viewer`, `system_admin`,
-- and any salesperson on any deal, including ones they do not own.
-- `can_view_all_sales_data()` includes viewer and system_admin, so quotations
-- leak the same way.
--
-- This is the third exposure of the same shape, after attachments (2026-08-21)
-- and contracts (2026-08-22). It is the most sensitive of the three: a contract
-- tells you what one client paid, a BOQ tells you the margin on every job.
--
-- WHY RLS ALONE CANNOT FIX IT
-- ---------------------------
-- Row-level security decides which ROWS you see, never which COLUMNS. A
-- salesperson legitimately needs their own BOQ and its selling price, so the
-- row must be visible — and with the row visible, `unit_rate` comes with it.
-- Hiding the column in the UI is not a control: PostgREST will happily answer
-- `?select=unit_rate` for anyone the row policy admits.
--
-- So this migration does three things that only work together:
--
--   1. row policies decide who sees a BOQ at all, derived from the opportunity
--   2. COLUMN privileges remove the cost columns from `authenticated`
--      outright, so no PostgREST query can name them
--   3. a security-definer view re-exposes cost to the roles entitled to it
--
-- Step 2 is the load-bearing one. Because PostgREST runs every signed-in
-- request as the single `authenticated` role, a column revoked there is
-- revoked for everybody — which is why step 3 has to hand it back through a
-- view that checks the caller's role itself.
--
-- WHO SEES COST, AND WHY NOT THE PIPELINE
-- ---------------------------------------
-- Cost and margin: estimation (they build it), finance (they bill against it),
-- and MD/GM/CEO (they own the margin). Deliberately NOT sales_manager,
-- bd_manager or sales_ops: they run the pipeline and need the selling price to
-- do it, and a manager who negotiates knowing the floor negotiates differently
-- from one who does not. That is a commercial decision the business has already
-- made elsewhere — `can_edit_total_value` draws the same line.
--
-- `can_view_all_sales_data()` is not reused anywhere here: it admits viewer and
-- system_admin, the two roles this exists to exclude (D24).
--
-- WHAT BREAKS, AND WHAT REPLACES IT
-- ---------------------------------
-- `BoqPanel` is the only reader of either protected column in the whole
-- codebase (`boqs.estimated_value` at two call sites, `boq_items.unit_rate` at
-- one; `cost_estimate` and `selling_price` are written and never read). It
-- moves onto the two views below. Every other `estimated_value` in the app is
-- `opportunities.estimated_value_max` or `rfqs.estimated_value` — different
-- tables, untouched.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Who may see a BOQ at all ============
-- Explicit per-entity, not derived from the opportunities policy: that policy
-- admits `can_view_all_sales_data()`, which includes viewer and system_admin.
-- Same reasoning as D26.
CREATE OR REPLACE FUNCTION public.can_read_boq(_opportunity_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND public.is_active_user(_user_id)
    AND (
      -- The salesperson whose deal it is.
      EXISTS (SELECT 1 FROM public.opportunities o
               WHERE o.id = _opportunity_id AND o.owner_id = _user_id)
      -- The people who run the pipeline.
      OR public.is_pipeline_operator(_user_id)
      -- The people who price it and bill for it.
      OR public.has_any_role(_user_id,
           ARRAY['estimation_manager','finance_manager']::public.app_role[])
    );
$$;

COMMENT ON FUNCTION public.can_read_boq IS
  'Row visibility for a BOQ: the deal owner, the pipeline, estimation or finance. Returns TRUE or FALSE, never NULL. Excludes viewer and system_admin — can_view_all_sales_data() admits both and is deliberately not reused (D24).';

-- ============ 2. Who may see cost and margin ============
-- A strictly narrower set. Note it does NOT include the pipeline roles: they
-- get the selling price, not the floor beneath it.
CREATE OR REPLACE FUNCTION public.can_read_commercial_cost(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND public.is_active_user(_user_id)
    AND public.has_any_role(_user_id, ARRAY[
      'estimation_manager',                       -- builds the cost
      'finance_manager',                          -- bills against it
      'managing_director', 'general_manager', 'ceo'  -- owns the margin
    ]::public.app_role[]);
$$;

COMMENT ON FUNCTION public.can_read_commercial_cost IS
  'Who may see unit_rate, cost_estimate and the BOQ cost roll-up. Narrower than can_read_boq on purpose: sales_manager, bd_manager and sales_ops run the pipeline on the selling price and are not shown the floor. Excludes viewer and system_admin.';

-- ============ 3. Row policies ============
DROP POLICY IF EXISTS "BOQs readable" ON public.boqs;
CREATE POLICY "BOQs readable by the deal's people, pipeline, estimation and finance"
  ON public.boqs FOR SELECT
  TO authenticated
  USING (public.can_read_boq(related_opportunity_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "BOQ items readable" ON public.boq_items;
CREATE POLICY "BOQ items readable when the BOQ is"
  ON public.boq_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.boqs b
     WHERE b.id = boq_items.boq_id
       AND public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid()))
  ));

-- Quotations carry no cost, only the selling value — so this is a row fix
-- only: drop the can_view_all_sales_data clause that admits viewer and
-- system_admin, and derive from the deal instead.
DROP POLICY IF EXISTS "Quotations readable by owner or manager" ON public.quotations;
CREATE POLICY "Quotations readable by the deal's people, pipeline and finance"
  ON public.quotations FOR SELECT
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR public.can_read_boq(related_opportunity_id, (SELECT auth.uid()))
  );

-- ============ 4. Column privileges — the part RLS cannot do ============
-- Postgres ignores column grants while a table-wide SELECT grant exists, so the
-- table grant has to go first and the permitted columns are then re-granted by
-- name. Anything added to these tables later is NOT granted by default, which
-- is the right failure direction: a new cost column stays invisible until
-- somebody decides otherwise.
REVOKE SELECT ON public.boq_items FROM authenticated, anon;
GRANT  SELECT (
  id, boq_id, sign_type, size, material, quantity, location, mounting,
  illumination, finish, selling_price, item_source, confidence, sort_order,
  created_at
) ON public.boq_items TO authenticated;
-- unit_rate and cost_estimate are deliberately absent.

REVOKE SELECT ON public.boqs FROM authenticated, anon;
GRANT  SELECT (
  id, related_opportunity_id, title, status, source, source_confidence,
  assumptions, missing_items, currency, file_url, notes, created_by,
  created_at, updated_at, extra_data
) ON public.boqs TO authenticated;
-- estimated_value is deliberately absent: the AI extractor populates it as
-- SUM(quantity * unit_rate), which makes it a cost roll-up wearing a neutral
-- name. Sales get boq_sales_totals below instead.

-- anon keeps nothing on either table.
REVOKE ALL ON public.boq_items FROM anon;
REVOKE ALL ON public.boqs      FROM anon;

-- ============ 5. Cost, handed back to the roles entitled to it ============
-- security_invoker is left at its default (off), so the view runs as its owner
-- and can read the columns `authenticated` no longer holds. That makes the
-- view responsible for its own access control, which is what the two predicates
-- in the WHERE clause are for — one for the row, one for the column set.
CREATE OR REPLACE VIEW public.boq_item_costs AS
  SELECT
    i.id, i.boq_id, i.sign_type, i.quantity,
    i.unit_rate, i.cost_estimate, i.selling_price,
    -- Margin is derived here rather than stored, so it cannot drift from the
    -- numbers it is computed from.
    (i.selling_price - i.cost_estimate)                            AS margin_value,
    CASE WHEN i.selling_price IS NULL OR i.selling_price = 0 THEN NULL
         ELSE round(((i.selling_price - i.cost_estimate) / i.selling_price) * 100, 2)
    END                                                            AS margin_pct,
    i.sort_order
  FROM public.boq_items i
  JOIN public.boqs b ON b.id = i.boq_id
 WHERE public.can_read_commercial_cost((SELECT auth.uid()))
   AND public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid()));

COMMENT ON VIEW public.boq_item_costs IS
  'Cost and margin per BOQ line, for estimation, finance and MD/GM/CEO only. Runs as owner because the base columns are revoked from authenticated, so it enforces both the row rule and the role rule itself. Empty for everyone else — not an error, just nothing.';

GRANT SELECT ON public.boq_item_costs TO authenticated;

CREATE OR REPLACE VIEW public.boq_cost_totals AS
  SELECT b.id AS boq_id, b.related_opportunity_id,
         b.estimated_value AS cost_total,
         sum(i.cost_estimate) AS lines_cost_total,
         sum(i.selling_price) AS lines_selling_total
    FROM public.boqs b
    LEFT JOIN public.boq_items i ON i.boq_id = b.id
   WHERE public.can_read_commercial_cost((SELECT auth.uid()))
     AND public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid()))
   GROUP BY b.id, b.related_opportunity_id, b.estimated_value;

COMMENT ON VIEW public.boq_cost_totals IS
  'BOQ-level cost roll-up including boqs.estimated_value, which the AI extractor writes as SUM(quantity * unit_rate) and is therefore cost. Same two gates as boq_item_costs.';

GRANT SELECT ON public.boq_cost_totals TO authenticated;

-- ============ 6. The selling total everyone who can see the BOQ may have ============
-- What BoqPanel puts in its header, replacing boqs.estimated_value. Selling
-- only: no cost reaches this view, so it is safe for the deal owner and the
-- pipeline.
CREATE OR REPLACE VIEW public.boq_sales_totals AS
  SELECT b.id AS boq_id, b.related_opportunity_id, b.currency,
         sum(i.selling_price) AS selling_total,
         count(i.id)          AS line_count
    FROM public.boqs b
    LEFT JOIN public.boq_items i ON i.boq_id = b.id
   WHERE public.can_read_boq(b.related_opportunity_id, (SELECT auth.uid()))
   GROUP BY b.id, b.related_opportunity_id, b.currency;

COMMENT ON VIEW public.boq_sales_totals IS
  'Selling-side roll-up for anyone who may see the BOQ. Contains no cost, so the deal owner and the pipeline can use it as a headline where boqs.estimated_value used to be.';

GRANT SELECT ON public.boq_sales_totals TO authenticated;
