-- =============================================================================
-- BD Manager may READ sales targets. Nothing else changes.
--
-- WHY
-- The wall board (/board) shows the annual target and each person's achievement
-- against theirs. It has to run on an account that is not in
-- MFA_REQUIRED_ROLES, because a wall display is idle by definition and would
-- otherwise sign itself out every thirty minutes and demand a TOTP code from
-- whoever walked over.
--
-- Measured against the board's reads, exactly four roles could see everything
-- it needs -- ceo, general_manager, managing_director, sales_manager -- and
-- three of those are the MFA-required ones. The fourth, ceo, is the most
-- privileged role in the system; putting it on a tablet in an open office is
-- worse than the problem being solved.
--
-- bd_manager already reads every other table the board touches: opportunities,
-- follow_ups, tenders, quotations and leads all admit it through
-- can_view_all_sales_data or is_sales_contributor. Targets were the single gap,
-- and it is the reason the board would otherwise render "no target set" and a
-- column of dashes.
--
-- WHY NOT JUST ADD THE ROLE TO is_commercial_manager
-- Because that function is not about targets. It also gates writing approval
-- decisions, updating source_registry, and updating documents:
--
--   approvals        · writable by commercial managers (update, delete)
--   source_registry  · writable by commercial manager  (update, delete)
--   documents        · updatable by uploader or commercial manager
--   sales_targets    · managed by commercial manager   (insert, update, delete)
--
-- Widening it to let a board read a number would hand bd_manager the authority
-- to decide approvals -- the four-step BAFO chain exists precisely so that no
-- single role can do that. The read gate is widened here and nowhere else.
--
-- WHAT THIS DOES AND DOES NOT GRANT
-- Read only, and only on sales_targets. INSERT, UPDATE and DELETE stay behind
-- is_commercial_manager, untouched: bd_manager can see a target and cannot set,
-- change or remove one.
--
-- It does mean an individual's target becomes visible to the BD Manager, who
-- could not see it before. That is a deliberate, reviewed widening -- the
-- alternative was a board account holding ceo.
-- =============================================================================

DROP POLICY IF EXISTS "Targets readable by self or commercial manager" ON public.sales_targets;

CREATE POLICY "Targets readable by self, commercial manager or BD manager"
  ON public.sales_targets
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_commercial_manager((SELECT auth.uid()))
    OR public.has_any_role((SELECT auth.uid()), ARRAY['bd_manager']::public.app_role[])
  );

COMMENT ON TABLE public.sales_targets IS
  'Per-user sales targets. Readable by the owner, commercial managers, and bd_manager (added so the wall board can run on a non-MFA account). Writable only by commercial managers.';
