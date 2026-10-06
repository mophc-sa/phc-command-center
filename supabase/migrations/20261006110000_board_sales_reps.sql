-- =============================================================================
-- The board's "Team performance" shows the sales team only (user, 2026-10-06):
-- people whose role is salesperson and who hold no management or admin role.
-- The wall account cannot read user_roles, so the board asks this function.
-- Same readers as daily_completion: pipeline operators, system admins and the
-- display account. Ids and names only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.board_sales_reps()
RETURNS TABLE (user_id uuid, full_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE u uuid := (SELECT auth.uid());
BEGIN
  IF NOT (public.is_pipeline_operator(u)
          OR public.has_any_role(u, ARRAY['system_admin']::public.app_role[])
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u AND p.is_display_account)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.full_name
    FROM public.profiles p
   WHERE p.status = 'active' AND NOT p.is_display_account
     AND public.has_any_role(p.id, ARRAY['salesperson']::public.app_role[])
     AND NOT public.has_any_role(p.id, ARRAY['managing_director','general_manager','ceo','sales_manager',
                                            'bd_manager','sales_ops','system_admin']::public.app_role[])
   ORDER BY p.full_name;
END $$;
REVOKE ALL ON FUNCTION public.board_sales_reps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_sales_reps() TO authenticated;
