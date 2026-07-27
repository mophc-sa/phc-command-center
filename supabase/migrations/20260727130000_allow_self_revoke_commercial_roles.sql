-- =========================================================
-- Allow self-revocation of commercial-manager roles; keep the
-- lockout guard for system_admin only.
--
-- This is the fourth time the same incident has needed a manual fix
-- (20260713130000, 20260721100000, 20260727110000): a platform admin
-- grants themselves a commercial-manager role (sales_manager, executive)
-- — often just to explore the RBAC UI — and then cannot remove it via the
-- admin-settings screen or any self-initiated action, because
-- protect_last_manager() blocks self-revocation of every role in its
-- `guarded` array, which bundles system_admin together with
-- managing_director/general_manager/ceo/sales_manager.
--
-- That blanket guard conflates two different concerns:
--   1. Genuine admin-lockout prevention: the last system_admin should not
--      be able to strand the account with no one able to reach
--      admin-settings. This is worth keeping.
--   2. Commercial-authority hygiene: docs/PROJECT.md and
--      docs/ARCHITECTURE.md deliberately keep commercial approval
--      authority separate from system administration. Revoking your OWN
--      commercial role is exactly the self-service action that
--      enforces that separation — blocking it is what causes the
--      recurring incident, not what prevents a real problem.
--
-- This migration narrows the self-revoke guard to system_admin only.
-- The "never remove the last commercial manager org-wide" check (a
-- different, still-valid protection against zero commercial managers
-- existing at all) is unchanged and still applies regardless of who
-- initiates the revoke.
-- =========================================================

CREATE OR REPLACE FUNCTION public.protect_last_manager()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  remaining INT;
BEGIN
  IF OLD.role = 'system_admin' AND OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot revoke your own system_admin role';
  END IF;
  -- Never remove the last commercial manager (any executive or sales_manager).
  IF OLD.role IN ('managing_director','general_manager','ceo','sales_manager') THEN
    SELECT COUNT(*) INTO remaining FROM public.user_roles
      WHERE role IN ('managing_director','general_manager','ceo','sales_manager')
        AND id <> OLD.id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last commercial manager account';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

-- One-time cleanup for the account currently stuck in this exact state:
-- holds ceo/sales_manager/general_manager alongside system_admin and
-- could not self-revoke any of them before this migration. The account
-- explicitly asked for system_admin-only authority.
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
    RAISE NOTICE 'allow_self_revoke_commercial_roles: moalagab@phc-sa.com not found — skipping (safe on dev/CI).';
    RETURN;
  END IF;

  WITH deleted AS (
    DELETE FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('sales_manager', 'general_manager', 'managing_director', 'ceo')
    RETURNING role
  )
  SELECT array_agg(role) INTO _removed FROM deleted;

  INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'system_admin')
    ON CONFLICT (user_id, role) DO NOTHING;

  IF array_length(_removed, 1) > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'role.revoked', 'user_role', _user_id,
              jsonb_build_object(
                'roles_removed', to_jsonb(_removed),
                'reason', 'moalagab@phc-sa.com requested system_admin-only authority; self-revoke guard for commercial roles is removed as of this migration so this will no longer require a manual fix'
              ));
    RAISE NOTICE 'allow_self_revoke_commercial_roles: removed % from moalagab@phc-sa.com.', _removed;
  END IF;
END $$;
