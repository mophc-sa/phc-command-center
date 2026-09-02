-- =============================================================================
-- What the wall screen may read, once it stopped being a BD manager.
--
-- On 2026-09-02 `info@phc-sa.com` was narrowed from bd_manager + viewer down to
-- viewer alone -- the right move, because bd_manager can WRITE and nobody
-- should be able to edit records by walking up to a screen.
--
-- Measured immediately after, as that account:
--
--     opportunities   741 of 741
--     follow_ups        9 of 9
--     inbox            12 of 12       profiles  17 of 17
--     sales_targets     0 of 7    <-- blank
--     quotations        0 of 45   <-- blank
--
-- So the annual target, the achievement percentage, the coverage ratio and the
-- "quotations due soon" pulse all went dark. The board says "no target set",
-- honestly, and loses its headline while doing it.
--
-- THIS CHANGES WHAT THE FLAG MEANS, AND THAT IS WORTH SAYING
--
-- 20260924100000 introduced `is_display_account` and said, in as many words,
-- that it grants nothing. It grants two reads now. The alternative was widening
-- `viewer` -- a role held by real people who are deliberately excluded from
-- commercial figures -- to fix one screen, which is worse in every direction.
--
-- The grant is kept as narrow as RLS allows, and then narrower:
--
--   * Only these two tables.
--   * The board reads quotations through a view exposing `valid_until, status`
--     only, so a quotation's VALUE never leaves the server for this screen.
--     Read the caveat below before treating that as protection.
--   * The flag is still settable only by system_admin or sales_manager, guarded
--     by the trigger from the previous migration.
--
-- THE VIEW IS HYGIENE, NOT A BOUNDARY -- SAY IT PLAINLY
--
-- A first draft of this comment claimed the view stops a display account
-- reading `quotations.value`. It does not, and the claim was worth catching:
-- the row policy above admits the account to the TABLE, and `authenticated`
-- holds a table-wide SELECT, so anyone at that keyboard can ask PostgREST for
-- the value column directly. The view only decides what the BOARD asks for.
--
-- That is still worth having -- the value never crosses the network for this
-- screen, so it is not in the tab's memory or its network log -- but it is
-- hygiene, not enforcement. Real column enforcement would mean revoking the
-- table-wide grant and re-granting per column, which lands on every role in
-- the system to protect one screen.
--
-- The shape that actually fixes it is the one already recorded in
-- docs/AI_HANDOFF.md and still not built: a revocable per-device token and an
-- endpoint that returns the aggregate payload and no rows at all. Until then
-- the screen belongs in a trusted room, which has been the standing caveat
-- since the board shipped.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_display_account(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = _user_id
       AND p.is_display_account
       AND p.status = 'active'
  );
$$;

COMMENT ON FUNCTION public.is_display_account IS
  'Whether this account drives a wall display. Admits it to sales_targets and quotations for the board''s figures; every other permission still comes from its roles.';

-- ---- Targets ---------------------------------------------------------------
DROP POLICY IF EXISTS "Targets readable by self, commercial manager or BD manager" ON public.sales_targets;
CREATE POLICY "Targets readable by self, commercial manager or BD manager"
  ON public.sales_targets FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_commercial_manager((SELECT auth.uid()))
    OR public.has_any_role((SELECT auth.uid()), ARRAY['bd_manager']::public.app_role[])
    -- The board's annual target and achievement gauge.
    OR public.is_display_account((SELECT auth.uid()))
  );

-- ---- Quotations ------------------------------------------------------------
DROP POLICY IF EXISTS "Quotations readable by the deal's people, pipeline and finance" ON public.quotations;
CREATE POLICY "Quotations readable by the deal's people, pipeline and finance"
  ON public.quotations FOR SELECT
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR public.can_read_boq(related_opportunity_id, (SELECT auth.uid()))
    -- The "quotations due soon" pulse.
    OR public.is_display_account((SELECT auth.uid()))
  );

-- ---- Narrowing the columns -------------------------------------------------
-- RLS decides which ROWS. It has nothing to say about columns, and the column
-- that mattered here is `quotations.value`.
--
-- Per-column GRANTs were the first idea and they are the wrong tool: revoking
-- the table-wide SELECT to re-grant per column would land on every other role
-- at once, to protect one screen.
--
-- A view does it without touching anyone else. The board reads
-- `board_quotation_pulse` -- wired in the same change, so this is the columns
-- it can actually reach and not a decoration. security_invoker keeps the
-- caller's RLS in force, so this narrows columns and changes no row rule.

CREATE OR REPLACE VIEW public.board_quotation_pulse
WITH (security_invoker = true) AS
  SELECT id, valid_until, status
    FROM public.quotations;

COMMENT ON VIEW public.board_quotation_pulse IS
  'The two columns the wall board needs from quotations. security_invoker, so the caller''s RLS decides rows exactly as it would on the table. It narrows what the BOARD asks for -- it is not a barrier against the account querying the table directly.';

GRANT SELECT ON public.board_quotation_pulse TO authenticated;
