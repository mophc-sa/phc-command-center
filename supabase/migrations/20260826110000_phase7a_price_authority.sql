-- =========================================================
-- PHASE 7A (2/3) — who may set a final price.
--
-- WHY THIS SHIPS WITH 7A AND NOT 7C
-- ---------------------------------
-- The next migration creates `internal_prices` with `gm_approved` in its state
-- machine. If the authority function arrived later, there would be a window —
-- the whole length of Phase 7B — in which any estimation user could set the
-- terminal state directly. A guard belongs in the same release as the state it
-- guards.
--
-- WHY NOT is_commercial_manager()
-- -------------------------------
-- It admits sales_manager alongside MD/GM/CEO. Final price is one accountable
-- signature: in a dispute, "who approved this margin" must have exactly one
-- answer. And not is_platform_admin() either, which admits system_admin —
-- administering the platform has never been commercial authority in this
-- system (D24), and it is not going to start here.
--
-- CEO and MD get visibility through can_read_commercial_cost(), not approval.
-- That is the business decision, encoded rather than documented.
--
-- WHY DELEGATION EXISTS AT ALL
-- ----------------------------
-- Production holds exactly one general_manager. Without a recorded way to hand
-- the authority over, a single person on leave blocks every quotation, and what
-- actually happens then is someone shares a password. A delegation with a named
-- grantor, a reason and a mandatory expiry makes cover auditable instead.
--
-- The expiry is NOT NULL on purpose: an open-ended delegation is a second
-- permanent approver wearing a different name. And overlapping active
-- delegations are refused by an exclusion constraint, because two people
-- holding the authority at the same moment is precisely the ambiguity this
-- whole decision exists to avoid.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- gist over a tstzrange needs no extension for the range operator alone;
-- btree_gist would only be required to mix a scalar equality into the same
-- constraint, and this constraint is deliberately global rather than per-person.
CREATE TABLE IF NOT EXISTS public.price_authority_delegations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  grantee_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- Not optional. A delegation without a stated reason is indistinguishable
  -- from a mistake when someone reads it back a year later.
  reason      TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pad_period_sane      CHECK (expires_at > starts_at),
  CONSTRAINT pad_reason_present   CHECK (btrim(reason) <> ''),
  CONSTRAINT pad_revoke_consistent CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT pad_not_self          CHECK (grantee_id <> grantor_id),

  -- No two live delegations may overlap in time. Two simultaneous delegates
  -- would mean two people hold the final-price authority at once, which is the
  -- ambiguity Option A was chosen to prevent.
  CONSTRAINT pad_no_overlap EXCLUDE USING gist (
    tstzrange(starts_at, expires_at, '[)') WITH &&
  ) WHERE (revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS pad_grantee_active ON public.price_authority_delegations (grantee_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.price_authority_delegations IS
  'Temporary transfer of final-price authority from the General Manager. expires_at is mandatory — an open-ended delegation is a second permanent approver. Overlapping live delegations are refused: two holders at once is the ambiguity GM-only exists to avoid.';

-- Only the GM may delegate, and only to somebody else.
CREATE OR REPLACE FUNCTION public.price_delegation_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.has_role(NEW.grantor_id, 'general_manager'::public.app_role) THEN
      RAISE EXCEPTION 'Only the General Manager may delegate final-price authority. | تفويض اعتماد السعر النهائي يقتصر على المدير العام.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- A delegation is a record of a decision. Revoking it early is the only
    -- change permitted; editing its period or its people afterwards would
    -- rewrite who held authority when.
    IF NEW.grantor_id IS DISTINCT FROM OLD.grantor_id
       OR NEW.grantee_id IS DISTINCT FROM OLD.grantee_id
       OR NEW.starts_at  IS DISTINCT FROM OLD.starts_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.reason     IS DISTINCT FROM OLD.reason THEN
      RAISE EXCEPTION 'A delegation cannot be edited; revoke it and create a new one.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'A revoked delegation cannot be reinstated.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Delegations are not deletable — revoke instead.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS pad_guard_ins ON public.price_authority_delegations;
CREATE TRIGGER pad_guard_ins BEFORE INSERT ON public.price_authority_delegations
  FOR EACH ROW EXECUTE FUNCTION public.price_delegation_guard();
DROP TRIGGER IF EXISTS pad_guard_upd ON public.price_authority_delegations;
CREATE TRIGGER pad_guard_upd BEFORE UPDATE ON public.price_authority_delegations
  FOR EACH ROW EXECUTE FUNCTION public.price_delegation_guard();
DROP TRIGGER IF EXISTS pad_guard_del ON public.price_authority_delegations;
CREATE TRIGGER pad_guard_del BEFORE DELETE ON public.price_authority_delegations
  FOR EACH ROW EXECUTE FUNCTION public.price_delegation_guard();

-- ============ The predicate ============
CREATE OR REPLACE FUNCTION public.can_approve_final_price(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND public.is_active_user(_user_id)
    AND (
      public.has_role(_user_id, 'general_manager'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.price_authority_delegations d
         WHERE d.grantee_id = _user_id
           AND d.revoked_at IS NULL
           AND now() >= d.starts_at
           AND now() <  d.expires_at)
    );
$$;

COMMENT ON FUNCTION public.can_approve_final_price IS
  'Final-price authority: the General Manager, or an active unrevoked delegate. Returns TRUE or FALSE, never NULL. Deliberately not is_commercial_manager() (admits sales_manager) and not is_platform_admin() (admits system_admin) — CEO and MD have visibility through can_read_commercial_cost(), not approval.';

-- ============ RLS ============
ALTER TABLE public.price_authority_delegations ENABLE ROW LEVEL SECURITY;

-- Who holds commercial authority is commercial information: the same set that
-- may see cost may see who can approve it.
DROP POLICY IF EXISTS "Delegations readable by commercial cost holders" ON public.price_authority_delegations;
CREATE POLICY "Delegations readable by commercial cost holders"
  ON public.price_authority_delegations FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid())));

DROP POLICY IF EXISTS "Delegations creatable by the GM only" ON public.price_authority_delegations;
CREATE POLICY "Delegations creatable by the GM only"
  ON public.price_authority_delegations FOR INSERT TO authenticated
  WITH CHECK (grantor_id = (SELECT auth.uid())
              AND public.has_role((SELECT auth.uid()), 'general_manager'::public.app_role));

DROP POLICY IF EXISTS "Delegations revocable by the GM only" ON public.price_authority_delegations;
CREATE POLICY "Delegations revocable by the GM only"
  ON public.price_authority_delegations FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'general_manager'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'general_manager'::public.app_role));

-- No DELETE policy; the trigger refuses it for the service role too.
REVOKE ALL ON public.price_authority_delegations FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.price_authority_delegations TO authenticated;
