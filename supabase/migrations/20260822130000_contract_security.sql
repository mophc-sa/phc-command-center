-- =========================================================
-- SECURITY HOTFIX — contract read AND write governance, in one place.
--
-- One migration rather than two, because none of this has reached production
-- yet. A read fix followed by a write fix would leave the permanent record of
-- how contracts are governed split across two files that have to be read
-- together to make sense — and the second would spend half its length undoing
-- the first. This is the whole policy set for `public.contracts`.
--
-- ============ THE EXPOSURE ============
--
-- READ. The SELECT policy was, in full:
--
--     "Contracts readable"   USING (true)
--
-- That is the entire predicate. Every signed-in account read every contract
-- row: client, contract value, reference number, start and end dates, notes. A
-- `viewer`, a `system_admin` who administers accounts, and a salesperson who
-- owns none of the underlying deals all saw the commercial terms of every
-- contract the company has. Same shape as the attachment exposure closed on
-- 2026-08-21 and arguably worse — that one at least required knowing an object
-- path, whereas `SELECT * FROM contracts` returns the lot.
--
-- WRITE. INSERT and UPDATE both read:
--
--     is_pipeline_operator(auth.uid())
--     OR has_any_role(auth.uid(), ARRAY['system_admin'])
--
-- so the account that administers users and roles could also author and amend
-- commercial terms. The frontend never offered this: the gate on the contract
-- panel is `canManageSalesPipeline`, whose own comment reads "BD / Sales Ops and
-- above — not system_admin, not viewers". The database was simply looser than
-- the product. Removing it changes no workflow; it makes the database agree
-- with the UI that already exists.
--
-- Neither write policy checked `is_active_user`, so a suspended sales_manager
-- could still author a contract. Closed here too.
--
-- ============ THE RULE ============
--
--   system_admin ALONE:  no SELECT, no INSERT, no UPDATE, no DELETE.
--   multi-role:          authority comes from the business role only, and roles
--                        are a union — holding system_admin never subtracts.
--
-- ============ WHAT IS NOT WIDENED ============
--
-- Nobody gains anything. finance_manager gains READ (they bill against these
-- contracts and could not see them) but no write, because the current
-- commercial process has finance receiving contracts, not authoring them.
-- Creator, responsible user and deal owner gain READ of their own contract but
-- no write, because today's workflow routes every edit through the pipeline —
-- and inventing an owner-edit right here would be a new capability, not a
-- security fix.
--
-- ============ WHY THE FIX IS SMALL ============
--
-- `contracts.opportunity_id` is NOT NULL with a CASCADE foreign key, so every
-- contract has exactly one deal, always, and cannot outlive it or point
-- somewhere else. The relationship needed to derive read access already
-- existed; the policy simply never used it.
--
-- ============ WHY NOT can_view_all_sales_data() ============
--
-- It includes `viewer` and `system_admin`. Reusing it would look like
-- consistency while granting exactly the two roles this exists to exclude —
-- the same trap D24 refused for attachments.
--
-- estimation_manager is excluded as well: BOQs and scope are their work, a
-- signed contract's value and payment dates are not. They keep BOQ *file*
-- access through can_read_attachments; this is the contract *record*.
--
-- Schema, workflow, stages and business data are untouched. There is still no
-- DELETE policy, so contracts cannot be removed through the API at all.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Read predicate ============
-- Takes the row's own columns rather than an id, so it never reads the table it
-- protects and cannot recurse.
--
-- SECURITY DEFINER rather than an inline `EXISTS (SELECT 1 FROM opportunities)`:
-- an inline subquery would have opportunities' own RLS applied to it, making
-- contract visibility depend on a second policy that can change independently.
-- That coupling is exactly what makes projects, inbox_items and contracts leak
-- in the first place.
CREATE OR REPLACE FUNCTION public.can_read_contract(
  _opportunity_id      UUID,
  _responsible_user_id UUID,
  _created_by          UUID,
  _user_id             UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    -- Suspended and pending accounts read nothing, same as every other table.
    AND public.is_active_user(_user_id)
    AND (
      -- The commercial pipeline: MD, GM, CEO, sales_manager, bd_manager,
      -- sales_ops. Same set that may write, below.
      public.is_pipeline_operator(_user_id)
      -- Finance owns invoicing and payment terms; a contract they cannot read
      -- is a contract they cannot bill against. Read only.
      OR public.has_role(_user_id, 'finance_manager'::public.app_role)
      -- The people this particular contract is about. COALESCE because both
      -- columns are nullable and `NULL = uuid` is NULL, not FALSE — without it
      -- the disjunction returns NULL for a contract with no responsible user.
      -- RLS treats NULL as denied so behaviour would be right by luck, but a
      -- boolean helper that returns NULL is a trap for whoever composes it
      -- with NOT.
      OR COALESCE(_responsible_user_id = _user_id, FALSE)
      OR COALESCE(_created_by = _user_id, FALSE)
      -- The salesperson whose deal it is. NOT NULL + CASCADE FK on
      -- opportunity_id means this is always answerable and never forgeable.
      OR EXISTS (
        SELECT 1 FROM public.opportunities o
         WHERE o.id = _opportunity_id
           AND o.owner_id = _user_id
      )
    );
$$;

COMMENT ON FUNCTION public.can_read_contract IS
  'Read predicate for one contract: the commercial pipeline, finance, or a personal stake (responsible user, creator, or owner of the deal). Returns TRUE or FALSE, never NULL. Excludes system_admin and viewer by design — can_view_all_sales_data() includes both and must not be reused here (D24).';

-- ============ 2. Write predicate ============
-- Deliberately narrower than the read set, and deliberately NOT a personal
-- stake: today every contract edit goes through the pipeline, and giving the
-- deal owner an edit right here would be a new capability rather than a
-- security fix.
CREATE OR REPLACE FUNCTION public.can_write_contract(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND public.is_active_user(_user_id)
    -- Exactly `canManageSalesPipeline` on the frontend, which has always been
    -- the real gate on the contract panel. No system_admin: administering the
    -- platform is not authority over commercial terms.
    AND public.is_pipeline_operator(_user_id);
$$;

COMMENT ON FUNCTION public.can_write_contract IS
  'Write predicate for contracts: active pipeline operators only (MD, GM, CEO, sales_manager, bd_manager, sales_ops). Mirrors canManageSalesPipeline in the frontend. Excludes system_admin, finance and every personal stake — reading a contract does not imply authoring one.';

-- ============ 3. Replace every policy on the table ============
DROP POLICY IF EXISTS "Contracts readable" ON public.contracts;
DROP POLICY IF EXISTS "Contracts readable by the deal's people, the pipeline, and finance" ON public.contracts;
DROP POLICY IF EXISTS "Contracts insertable by pipeline operator or admin" ON public.contracts;
DROP POLICY IF EXISTS "Contracts updatable by pipeline operator or admin" ON public.contracts;

CREATE POLICY "Contracts readable by the deal's people, the pipeline, and finance"
  ON public.contracts FOR SELECT
  TO authenticated
  USING (
    public.can_read_contract(
      opportunity_id,
      responsible_user_id,
      created_by,
      (SELECT auth.uid())
    )
  );

CREATE POLICY "Contracts insertable by an active pipeline operator"
  ON public.contracts FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_contract((SELECT auth.uid())));

-- USING decides which rows may be amended, WITH CHECK decides what they may
-- become. Both, so a permitted editor cannot move a row somewhere they could
-- not have created it.
CREATE POLICY "Contracts updatable by an active pipeline operator"
  ON public.contracts FOR UPDATE
  TO authenticated
  USING (public.can_write_contract((SELECT auth.uid())))
  WITH CHECK (public.can_write_contract((SELECT auth.uid())));

-- No DELETE policy, unchanged from before this hotfix: a contract cannot be
-- removed through the API by anyone, including system_admin.
