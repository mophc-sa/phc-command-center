-- =========================================================
-- PHASE 10 — management intelligence.
--
-- NO NEW TABLES, DELIBERATELY
-- ---------------------------
-- Everything this phase needs is already recorded: opportunities carries
-- stage, sales_stage, won_at, lost_at, loss_reason, lost_at_stage,
-- lost_to_competitor, contract_value, quotation_value, estimated_value_max,
-- win_confidence, human_win_probability and expected_contract_date, and
-- sales_targets already holds per-person period targets. What was missing was
-- the reading of it, not the recording.
--
-- A reporting table would be a second copy of numbers that already exist, and
-- the copy is what goes stale. These are views: they cannot disagree with the
-- pipeline because they are the pipeline.
--
-- WHO MAY SEE AGGREGATES — NOT can_view_all_sales_data()
-- ------------------------------------------------------
-- That helper admits `viewer` AND `system_admin`, both of which are excluded
-- from commercial reads everywhere else in this schema. Reusing it here would
-- hand the whole company's pipeline value, win rates and loss reasons to two
-- roles that cannot open a single one of the underlying deals — the aggregate
-- being the more sensitive artefact, not the less.
--
-- can_read_sales_analytics() is pipeline operators plus finance. A salesperson
-- is not excluded from these views; they see their own rows and no one else's.
--
-- SELLING SIDE ONLY
-- -----------------
-- No cost, no margin, no supplier figure appears in any view here. Those stay
-- behind can_read_commercial_cost() where 7A, 7B and Phase 8 put them. A
-- forecast is built from what the client is being asked to pay.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Who may see the whole board ============
CREATE OR REPLACE FUNCTION public.can_read_sales_analytics(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL
     AND public.is_active_user(_user_id)
     AND public.has_any_role(_user_id, ARRAY[
           'managing_director','general_manager','ceo',
           'sales_manager','bd_manager','sales_ops','finance_manager'
         ]::public.app_role[]);
$$;

COMMENT ON FUNCTION public.can_read_sales_analytics IS
  'Company-wide sales aggregates: the pipeline leadership plus finance. Deliberately NOT can_view_all_sales_data(), which admits viewer and system_admin — an aggregate of deals nobody may open individually is more sensitive than one deal, not less.';

-- ============ 2. One definition of a deal's value ============
-- Three columns can hold it and they mean different things. Preferring the
-- most committed number available means a signed contract is never reported at
-- its estimate, and an unquoted deal still contributes its best estimate
-- rather than nothing.
CREATE OR REPLACE FUNCTION public.opportunity_value(
  _contract_value NUMERIC, _quotation_value NUMERIC, _estimated_value_max NUMERIC)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$ SELECT coalesce(_contract_value, _quotation_value, _estimated_value_max); $$;

COMMENT ON FUNCTION public.opportunity_value IS
  'The most committed value a deal has: contract, else quotation, else the top of the estimate. One definition so two dashboards cannot report different totals for the same pipeline.';

-- Weighting for the forecast. A number a person actually set beats a category
-- default, so human_win_probability wins whenever it is present.
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
    ELSE 0.20
  END;
$$;

COMMENT ON FUNCTION public.opportunity_win_weight IS
  'Forecast weight as a fraction. A human-set probability always wins over the categorical default — somebody who looked at the deal knows more than its confidence label. The fallback for an unlabelled deal is deliberately pessimistic.';

-- ============ 3. The scope every view below shares ============
-- Management sees the company; everyone else sees their own deals. Written
-- once here so six views cannot drift apart on who sees what.
CREATE OR REPLACE VIEW public.analytics_scope_opportunities AS
  SELECT o.*
    FROM public.opportunities o
   WHERE public.can_read_sales_analytics((SELECT auth.uid()))
      OR o.owner_id = (SELECT auth.uid());

COMMENT ON VIEW public.analytics_scope_opportunities IS
  'The opportunity set the current reader is entitled to aggregate: everything for management and finance, own deals for everyone else. The single scope definition the Phase 10 views build on.';
GRANT SELECT ON public.analytics_scope_opportunities TO authenticated;

-- ============ 4. Pipeline health ============
CREATE OR REPLACE VIEW public.pipeline_by_stage AS
  SELECT o.sales_stage,
         count(*)                                                    AS deals,
         count(*) FILTER (WHERE o.owner_id = (SELECT auth.uid()))    AS my_deals,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)) AS pipeline_value,
         round(avg(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)), 2) AS average_deal,
         -- Stalled: nothing logged for a fortnight on a live deal.
         count(*) FILTER (WHERE o.last_activity_at IS NULL
                             OR o.last_activity_at < now() - interval '14 days') AS stalled
    FROM public.analytics_scope_opportunities o
   WHERE o.sales_stage NOT IN ('won','lost')
   GROUP BY o.sales_stage;

COMMENT ON VIEW public.pipeline_by_stage IS
  'Open pipeline by sales stage with value, average deal and a stalled count. Won and lost are excluded — they are history, and mixing them into pipeline is how a dead deal keeps inflating the forecast.';
GRANT SELECT ON public.pipeline_by_stage TO authenticated;

-- ============ 5. Forecast ============
CREATE OR REPLACE VIEW public.sales_forecast AS
  SELECT date_trunc('month', coalesce(o.expected_contract_date, current_date))::date AS forecast_month,
         o.owner_id,
         count(*) AS deals,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)) AS gross_value,
         round(sum(
           public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)
           * public.opportunity_win_weight(o.human_win_probability, o.win_confidence)
         ), 2) AS weighted_value,
         count(*) FILTER (WHERE o.expected_contract_date IS NULL) AS undated_deals
    FROM public.analytics_scope_opportunities o
   WHERE o.sales_stage NOT IN ('won','lost','on_hold')
   GROUP BY 1, 2;

COMMENT ON VIEW public.sales_forecast IS
  'Weighted pipeline by expected close month. undated_deals is reported rather than hidden: a deal with no expected date lands in the current month by default, and the count says how much of the month is that default rather than a real forecast.';
GRANT SELECT ON public.sales_forecast TO authenticated;

-- ============ 6. Target vs actual ============
-- The period end comes from the next target row for the same person rather
-- than from interpreting period_type, so this stays correct whatever the
-- period vocabulary means.
CREATE OR REPLACE VIEW public.target_vs_actual AS
WITH windows AS (
  SELECT t.id, t.user_id, t.period_type, t.period_start,
         t.sales_target, t.pipeline_target, t.quotation_target, t.conversion_target,
         lead(t.period_start) OVER (PARTITION BY t.user_id, t.period_type ORDER BY t.period_start)
           AS next_start
    FROM public.sales_targets t
)
SELECT w.id AS target_id, w.user_id, w.period_type, w.period_start,
       w.next_start AS period_end,
       w.sales_target,
       w.pipeline_target,
       w.quotation_target,
       coalesce(sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max))
                FILTER (WHERE o.sales_stage = 'won'), 0) AS won_value,
       count(o.id) FILTER (WHERE o.sales_stage = 'won')  AS won_deals,
       CASE WHEN w.sales_target IS NULL OR w.sales_target = 0 THEN NULL
            ELSE round(coalesce(sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max))
                                FILTER (WHERE o.sales_stage = 'won'), 0)
                       / w.sales_target * 100, 1)
       END AS attainment_pct
  FROM windows w
  LEFT JOIN public.analytics_scope_opportunities o
    ON o.owner_id = w.user_id
   AND o.won_at IS NOT NULL
   AND o.won_at >= w.period_start
   AND (w.next_start IS NULL OR o.won_at < w.next_start)
 WHERE public.can_read_sales_analytics((SELECT auth.uid()))
    OR w.user_id = (SELECT auth.uid())
 GROUP BY w.id, w.user_id, w.period_type, w.period_start, w.next_start,
          w.sales_target, w.pipeline_target, w.quotation_target;

COMMENT ON VIEW public.target_vs_actual IS
  'Attainment against sales_targets. The period window ends where the next target for the same person and period type begins, so this does not depend on interpreting period_type. An open-ended latest period runs to now.';
GRANT SELECT ON public.target_vs_actual TO authenticated;

-- ============ 7. Conversion ============
CREATE OR REPLACE VIEW public.conversion_summary AS
  SELECT o.owner_id,
         count(*)                                              AS total_deals,
         count(*) FILTER (WHERE o.sales_stage = 'won')          AS won,
         count(*) FILTER (WHERE o.sales_stage = 'lost')         AS lost,
         count(*) FILTER (WHERE o.sales_stage NOT IN ('won','lost')) AS open_deals,
         -- Win rate over DECIDED deals only. Including open ones would make
         -- the rate fall every time somebody adds a lead, which reads as
         -- performance getting worse for doing more work.
         CASE WHEN count(*) FILTER (WHERE o.sales_stage IN ('won','lost')) = 0 THEN NULL
              ELSE round(count(*) FILTER (WHERE o.sales_stage = 'won')::numeric
                         / count(*) FILTER (WHERE o.sales_stage IN ('won','lost')) * 100, 1)
         END AS win_rate_pct,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max))
           FILTER (WHERE o.sales_stage = 'won') AS won_value,
         round(avg(extract(epoch FROM o.won_at - o.created_at) / 86400)
               FILTER (WHERE o.won_at IS NOT NULL), 1) AS avg_days_to_win
    FROM public.analytics_scope_opportunities o
   GROUP BY o.owner_id;

COMMENT ON VIEW public.conversion_summary IS
  'Win rate per owner over decided deals only. Counting open deals in the denominator would make the rate drop whenever someone adds a lead, which punishes prospecting.';
GRANT SELECT ON public.conversion_summary TO authenticated;

-- ============ 8. Why deals are lost ============
CREATE OR REPLACE VIEW public.loss_analysis AS
  SELECT coalesce(nullif(btrim(o.loss_reason), ''), 'unrecorded') AS loss_reason,
         o.lost_at_stage,
         count(*) AS deals,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max)) AS lost_value,
         count(*) FILTER (WHERE nullif(btrim(coalesce(o.lost_to_competitor,'')), '') IS NOT NULL) AS lost_to_a_named_competitor
    FROM public.analytics_scope_opportunities o
   WHERE o.sales_stage = 'lost'
   GROUP BY 1, 2;

COMMENT ON VIEW public.loss_analysis IS
  'Losses by reason and the stage they died at. Deals with no recorded reason are grouped as "unrecorded" rather than dropped — how much of the loss book is unexplained is itself the finding.';
GRANT SELECT ON public.loss_analysis TO authenticated;

-- ============ 9. Team performance ============
CREATE OR REPLACE VIEW public.team_performance AS
  SELECT o.owner_id,
         count(*) FILTER (WHERE o.sales_stage NOT IN ('won','lost'))  AS open_deals,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max))
           FILTER (WHERE o.sales_stage NOT IN ('won','lost'))          AS open_value,
         count(*) FILTER (WHERE o.sales_stage = 'won')                 AS won_deals,
         sum(public.opportunity_value(o.contract_value, o.quotation_value, o.estimated_value_max))
           FILTER (WHERE o.sales_stage = 'won')                        AS won_value,
         count(*) FILTER (WHERE o.sales_stage = 'lost')                AS lost_deals,
         -- One FILTER, not two chained: stalled means an OPEN deal with
         -- nothing logged for a fortnight. A won deal going quiet is closure.
         count(*) FILTER (WHERE o.sales_stage NOT IN ('won','lost')
                            AND (o.last_activity_at IS NULL
                                 OR o.last_activity_at < now() - interval '14 days')) AS stalled_deals,
         max(o.last_activity_at)                                       AS last_activity_at
    FROM public.analytics_scope_opportunities o
   GROUP BY o.owner_id;

COMMENT ON VIEW public.team_performance IS
  'Per-owner rollup for management. Carries no cost or margin — a manager comparing people needs volume, value and momentum, not the commercial internals of each deal.';
GRANT SELECT ON public.team_performance TO authenticated;
