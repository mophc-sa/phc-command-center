-- =========================================================
-- Restrict setting profiles.status = 'deleted' to system_admin only.
--
-- profiles' existing UPDATE policy ("Users update own profile or admins
-- update any", 20260713100000_user_status_quarantine.sql) allows any
-- is_platform_admin() (system_admin + executive + sales_manager) to change
-- another user's status — appropriate for Suspend/Activate, but the client
-- spec explicitly restricts account Delete to system_admin specifically.
-- This trigger adds that narrower check as defense in depth, server-side
-- (not just a frontend button restriction), matching the spec's Section 7
-- requirement.
-- =========================================================

CREATE OR REPLACE FUNCTION public.protect_delete_user_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'deleted'
     AND OLD.status IS DISTINCT FROM 'deleted'
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only System Admin may delete an account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_delete_user_status ON public.profiles;
CREATE TRIGGER trg_protect_delete_user_status
  BEFORE UPDATE OF status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_delete_user_status();
