-- =========================================================
-- Revoke sales_manager from moalagab@gmail.com
--
-- The previous migration (20260713130000) used the wrong email
-- (moalagab@phc-sa.com instead of moalagab@gmail.com) and was
-- therefore a no-op. This migration corrects that.
--
-- After this: Mo's account holds system_admin only.
-- sales_manager will be assigned when the actual Sales Manager
-- registers and is approved.
-- =========================================================

DO $$
DECLARE
  _user_id uuid;
BEGIN
  SELECT id INTO _user_id
  FROM public.profiles
  WHERE email = 'moalagab@gmail.com'
  LIMIT 1;

  IF _user_id IS NULL THEN
    RAISE NOTICE 'revoke_sales_manager: moalagab@gmail.com not found — skipping.';
    RETURN;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _user_id
    AND role = 'sales_manager';

  IF NOT FOUND THEN
    RAISE NOTICE 'revoke_sales_manager: sales_manager already absent for moalagab@gmail.com — nothing to do.';
    RETURN;
  END IF;

  INSERT INTO public.audit_log (
    actor_id, actor_type, action, entity_type, entity_id, after_value
  ) VALUES (
    NULL, 'system', 'role.revoked', 'user_role', _user_id::text,
    jsonb_build_object(
      'role',   'sales_manager',
      'reason', 'Provisional bootstrap role removed — account holds system_admin only until actual sales manager registers'
    )
  );

  RAISE NOTICE 'revoke_sales_manager: sales_manager revoked from moalagab@gmail.com (id: %).', _user_id;
END $$;
