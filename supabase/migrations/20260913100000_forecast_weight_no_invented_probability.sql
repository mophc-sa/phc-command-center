-- =========================================================
-- Phase 5.1 §3 — one forecast definition, and it never invents a probability.
--
-- THE DEFECT
-- ----------
-- public.opportunity_win_weight() ended with `ELSE 0.20`, so an opportunity
-- with neither a human probability nor a win_confidence label was forecast at
-- 20% of its value. On the book as it stood on 2026-08-25 — 49 open
-- opportunities, none of them scored — that is SAR 63.4M x 0.20 = SAR 12.7M of
-- forecast conjured out of nothing.
--
-- The TypeScript engine already rejected exactly this. weightedPipeline() in
-- src/lib/sales-kpis.ts excludes unscored deals and returns null, and its own
-- comment names the flat 0.2 as a defect it removed:
--
--     "The previous implementation applied a flat 0.2 weight to unscored
--      deals. That is worse than reporting nothing: it manufactures forecast
--      out of ignorance and is indistinguishable, downstream, from a real 20%
--      estimate."
--
-- That fix landed in the frontend. This function was written afterwards
-- (20260902100000) and reintroduced the behaviour in the database, so the two
-- layers disagreed about the single most consequential number in the system.
-- public.sales_forecast is not yet read by the frontend, which is the only
-- reason nobody has seen the 12.7M — Phase 5.1 §5 builds Forecast vs Target,
-- and would have been built straight onto it.
--
-- THE RULE NOW
-- ------------
-- NULL in, NULL out. A deal nobody has assessed contributes nothing to the
-- forecast and is counted separately as unforecastable. Callers must decide
-- what to do with an unknown rather than being handed a fabricated 0.20 that
-- looks identical to a considered estimate.
--
-- win_confidence labels are still honoured — somebody chose those, so they are
-- judgement, not a default.
--
-- NOT DESTRUCTIVE: CREATE OR REPLACE on one IMMUTABLE function plus one view
-- that gains a column. No table, column or row is touched.
-- =========================================================

CREATE OR REPLACE FUNCTION public.opportunity_win_weight(
  _human_probability INTEGER, _confidence public.win_confidence)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _human_probability IS NOT NULL THEN _human_probability / 100.0
    WHEN _confidence = 'sure_win' THEN 0.90
    WHEN _confidence = 'strong'   THEN 0.65
    WHEN _confidence = 'possible' THEN 0.35
    WHEN _confidence = 'low'      THEN 0.10
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.opportunity_win_weight IS
  'Forecast weight as a fraction, or NULL when nobody has assessed the deal. A human-set probability beats the categorical label; an unlabelled deal returns NULL rather than a default, because a manufactured weight is indistinguishable downstream from a real estimate. Matches weightedPipeline() in src/lib/sales-kpis.ts exactly — one definition of forecast across both layers.';

-- The forecast view now reports what it could not weight instead of absorbing
-- it. weighted_value sums only the deals that carry a real weight; the count
-- beside it says how much of the pipeline that leaves out, so a small forecast
-- from a large pipeline reads as "mostly unassessed" and not as "mostly lost".
CREATE OR REPLACE VIEW public.sales_forecast AS
  SELECT date_trunc('month', coalesce(o.expected_contract_date, current_date))::date AS forecast_month,
         o.owner_id,
         count(*) AS deals,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)) AS gross_value,
         round(coalesce(sum(
           public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)
           * public.opportunity_win_weight(o.human_win_probability, o.win_confidence)
         ), 0), 2) AS weighted_value,
         count(*) FILTER (WHERE o.expected_contract_date IS NULL) AS undated_deals,
         count(*) FILTER (
           WHERE public.opportunity_win_weight(o.human_win_probability, o.win_confidence) IS NULL
         ) AS unweighted_deals
    FROM public.analytics_scope_opportunities o
   WHERE o.sales_stage NOT IN ('won','lost','on_hold')
   GROUP BY 1, 2;

COMMENT ON VIEW public.sales_forecast IS
  'Weighted pipeline by expected close month. Two honesty counters rather than one: undated_deals is how many landed in the current month only because they carry no expected date, and unweighted_deals is how many nobody has assessed and so contribute nothing to weighted_value. A caller that ignores unweighted_deals will read an unassessed pipeline as a pessimistic one.';

GRANT SELECT ON public.sales_forecast TO authenticated;
