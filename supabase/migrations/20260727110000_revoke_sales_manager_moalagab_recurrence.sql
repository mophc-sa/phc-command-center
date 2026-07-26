-- =========================================================
-- Re-assert moalagab@phc-sa.com holds no commercial-manager role.
--
-- Third occurrence of the same incident already fixed by
-- 20260713130000_revoke_sales_manager_moalagab.sql and re-asserted by
-- 20260721100000_ensure_moalagab_system_admin_only.sql: sales_manager was
-- granted to this account again (2026-07-27), and the account then could
-- not revoke it from itself — the protect_last_manager trigger blocks
-- self-revocation of any guarded role (system_admin, executives,
-- sales_manager) by design, to prevent accidental admin lockout. That
-- guardrail is intentional and is NOT being changed here; only another
-- admin, or a migration like this one, can remove a guarded role from the
-- account performing the change.
--
-- Per docs/PROJECT.md / docs/ARCHITECTURE.md, commercial approval
-- authority (sales_manager, executives) is deliberately kept separate from
-- system administration (system_admin) — this account is the platform
-- admin and should not also hold commercial approval authority.
--
-- Idempotent and safe to re-run: no-ops if the account already holds no
-- guarded commercial role, or if the account does not exist yet (dev/CI).
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
    RAISE NOTICE 'revoke_sales_manager_moalagab_recurrence: moalagab@phc-sa.com not found — skipping (safe on dev/CI).';
    RETURN;
  END IF;

  ALTER TABLE public.user_roles DISABLE TRIGGER trg_protect_last_manager;

  WITH deleted AS (
    DELETE FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('sales_manager', 'general_manager', 'managing_director', 'ceo')
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
                'reason', 'Re-assertion (3rd occurrence): moalagab@phc-sa.com should not hold commercial-manager authority alongside system_admin'
              ));
    RAISE NOTICE 'revoke_sales_manager_moalagab_recurrence: removed % from moalagab@phc-sa.com.', _removed;
  ELSE
    RAISE NOTICE 'revoke_sales_manager_moalagab_recurrence: moalagab@phc-sa.com already clean — nothing to remove.';
  END IF;
END $$;
