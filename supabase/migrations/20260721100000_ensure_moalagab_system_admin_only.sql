-- =========================================================
-- Ensure moalagab@phc-sa.com holds system_admin only
--
-- Defensive re-assertion of the end state established by Sprint 1E
-- (20260713130000_revoke_sales_manager_moalagab.sql), Phase B
-- (20260713140000_phase_b_team_provisioning.sql), and the sales_manager
-- correction (20260714150000_revoke_sales_manager_phcsa.sql).
--
-- One of those corrections (20260714140000_revoke_sales_manager_mo.sql)
-- targeted moalagab@gmail.com instead of the real @phc-sa.com account —
-- a copy-paste mistake that left a gap in the record even though the
-- correct account was already fixed by 20260714150000. This migration
-- re-asserts the intended state directly against the real account so
-- that gap can't matter.
--
-- Idempotent and safe to re-run: no-ops if the account already holds
-- system_admin only, or if the account does not exist yet (dev/CI).
-- =========================================================

DO $$
DECLARE
  _user_id uuid;
  _removed public.app_role[];
BEGIN
  SELECT id INTO _user_id
  FROM public.profiles
  WHERE email = 'moalagab@phc-sa.com'
  LIMIT 1;

  IF _user_id IS NULL THEN
    RAISE NOTICE 'ensure_system_admin_only: moalagab@phc-sa.com not found — skipping (safe on dev/CI).';
    RETURN;
  END IF;

  -- Bypass the "last manager" guardrail — this account intentionally
  -- holds no commercial-manager roles going forward.
  ALTER TABLE public.user_roles DISABLE TRIGGER trg_protect_last_manager;

  -- Single statement: delete and capture what was actually removed
  -- (array_agg over zero rows yields NULL, not an empty array — the
  -- array_length check below treats NULL the same as "nothing removed").
  WITH deleted AS (
    DELETE FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('general_manager', 'sales_manager')
    RETURNING role
  )
  SELECT array_agg(role) INTO _removed FROM deleted;

  ALTER TABLE public.user_roles ENABLE TRIGGER trg_protect_last_manager;

  INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'system_admin')
    ON CONFLICT (user_id, role) DO NOTHING;

  IF array_length(_removed, 1) > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'role.revoked', 'user_role', _user_id,
              jsonb_build_object(
                'roles_removed', to_jsonb(_removed),
                'reason', 'Re-assertion: moalagab@phc-sa.com holds system_admin only (closes the gap left by 20260714140000 misfiring against the wrong email)'
              ));
    RAISE NOTICE 'ensure_system_admin_only: removed % from moalagab@phc-sa.com.', _removed;
  ELSE
    RAISE NOTICE 'ensure_system_admin_only: moalagab@phc-sa.com already clean — nothing to remove.';
  END IF;

  RAISE NOTICE 'ensure_system_admin_only: system_admin confirmed for moalagab@phc-sa.com (id: %).', _user_id;
END $$;
