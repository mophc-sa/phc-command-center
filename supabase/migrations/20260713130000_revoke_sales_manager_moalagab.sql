-- =========================================================
-- Sprint 1E: Revoke sales_manager from moalagab@phc-sa.com
--
-- Problem (USER_ROLE_CHANGE_APPROVED):
--   The system bootstrap assigned sales_manager to the PHC admin
--   account as a provisional role. Now that the role model is
--   hardened (Sprint 1A–1D), that account should hold only the
--   roles that reflect its actual function — not a catch-all
--   commercial role that bypasses the separation of concerns
--   between platform administration and commercial authority.
--
-- What this migration does:
--   1. Removes the sales_manager row from user_roles for the
--      user whose profile email is moalagab@phc-sa.com.
--   2. Writes a row to audit_log so the change is traceable
--      (actor_id = NULL = system/migration; actor_type = 'system').
--
-- Safety:
--   Uses a subquery on public.profiles (NOT auth.users directly)
--   so the delete is a no-op if the email does not exist — never
--   errors, safe to run on dev/staging where the user may not exist.
-- =========================================================

DO $$
DECLARE
  _user_id uuid;
BEGIN
  -- Resolve user id from the profiles table (email stored there at signup)
  SELECT id INTO _user_id
  FROM public.profiles
  WHERE email = 'moalagab@phc-sa.com'
  LIMIT 1;

  IF _user_id IS NULL THEN
    RAISE NOTICE 'Sprint 1E: moalagab@phc-sa.com not found — skipping (safe on dev/staging).';
    RETURN;
  END IF;

  -- Remove the role (idempotent — DELETE WHERE is a no-op if already gone)
  DELETE FROM public.user_roles
  WHERE user_id = _user_id
    AND role = 'sales_manager';

  IF NOT FOUND THEN
    RAISE NOTICE 'Sprint 1E: sales_manager already absent for moalagab@phc-sa.com — nothing to do.';
    RETURN;
  END IF;

  -- Audit trail
  INSERT INTO public.audit_log (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    after_value
  ) VALUES (
    NULL,
    'system',
    'role.revoked',
    'user_role',
    _user_id::text,
    jsonb_build_object(
      'role',   'sales_manager',
      'reason', 'Sprint 1E — provisional bootstrap role removed; platform admin account should not hold commercial authority'
    )
  );

  RAISE NOTICE 'Sprint 1E: sales_manager revoked from moalagab@phc-sa.com (id: %).', _user_id;
END $$;
