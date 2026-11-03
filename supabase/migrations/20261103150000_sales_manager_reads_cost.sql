-- =============================================================================
-- The sales manager is management and reads supplier cost (Mo, 2026-11-03).
-- Narrower than can_read_boq still: BD, sales ops and reps run on the selling
-- price only. One predicate, so every cost view and policy follows.
-- =============================================================================
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
      'sales_manager',                            -- management (2026-11-03)
      'managing_director', 'general_manager', 'ceo'  -- owns the margin
    ]::public.app_role[]);
$$;

COMMENT ON FUNCTION public.can_read_commercial_cost IS
  'Who may see supplier cost, internal cost, rates and margin. Estimation, finance, the sales manager (management, 2026-11-03) and executives. bd_manager, sales_ops and reps run the pipeline on the selling price and are not shown the floor. Excludes viewer and system_admin.';
