
-- Allow managers (CEO / Sales Manager) to grant and revoke roles, with guardrail: no one can remove the last remaining ceo/sales_manager (via trigger).

GRANT INSERT, DELETE ON public.user_roles TO authenticated;

CREATE POLICY "Managers can grant roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo'::app_role, 'sales_manager'::app_role]));

CREATE POLICY "Managers can revoke roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo'::app_role, 'sales_manager'::app_role]));

-- Guardrail: cannot remove the last active ceo, and cannot remove your own manager role
CREATE OR REPLACE FUNCTION public.protect_last_manager()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining INT;
BEGIN
  IF OLD.role IN ('ceo', 'sales_manager') THEN
    IF OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot revoke your own manager role';
    END IF;
    SELECT COUNT(*) INTO remaining FROM public.user_roles
      WHERE role = OLD.role AND id <> OLD.id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last % account', OLD.role;
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_last_manager ON public.user_roles;
CREATE TRIGGER trg_protect_last_manager
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_manager();
