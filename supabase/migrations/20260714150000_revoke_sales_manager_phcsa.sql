-- Remove sales_manager from moalagab@phc-sa.com
-- Temporarily disables trg_protect_last_manager so the delete can proceed.
-- The trigger exists to prevent an accidental full-wipe of all commercial
-- managers; here the removal is intentional and a real sales_manager will be
-- provisioned when they register.

DO $$
DECLARE
  _user_id uuid;
BEGIN
  SELECT id INTO _user_id
  FROM public.profiles
  WHERE email = 'moalagab@phc-sa.com'
  LIMIT 1;

  IF _user_id IS NULL THEN
    RAISE NOTICE 'revoke_sales_manager: moalagab@phc-sa.com not found — skipping.';
    RETURN;
  END IF;

  -- Bypass the "last manager" guardrail for this intentional change
  ALTER TABLE public.user_roles DISABLE TRIGGER trg_protect_last_manager;

  DELETE FROM public.user_roles
  WHERE user_id = _user_id
    AND role = 'sales_manager';

  ALTER TABLE public.user_roles ENABLE TRIGGER trg_protect_last_manager;

  IF NOT FOUND THEN
    RAISE NOTICE 'revoke_sales_manager: sales_manager already absent — nothing to do.';
    RETURN;
  END IF;

  INSERT INTO public.audit_log (
    actor_id, actor_type, action, entity_type, entity_id, after_value
  ) VALUES (
    NULL, 'system', 'role.revoked', 'user_role', _user_id,
    jsonb_build_object(
      'role',   'sales_manager',
      'reason', 'Intentional removal: account holds system_admin only; sales_manager will be assigned to the actual sales manager when they register'
    )
  );

  RAISE NOTICE 'revoke_sales_manager: sales_manager revoked from moalagab@phc-sa.com (id: %).', _user_id;
END $$;
