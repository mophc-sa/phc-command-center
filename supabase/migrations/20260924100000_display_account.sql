-- =============================================================================
-- An account whose whole job is to drive the wall screen.
--
-- `info@phc-sa.com` was created on 2026-09-02 to run the board in the sales
-- manager's office. Two things are asked of it: it should open on the board,
-- and it should not sign itself out.
--
-- WHY A FLAG AND NOT A ROLE
--
-- The obvious move is a `board_display` role. It is the wrong one. Roles in
-- this system carry PERMISSION -- every one of them appears in RLS policies,
-- in MFA_REQUIRED_ROLES, in the landing contract, in a dozen `inGroup` checks.
-- Adding one means auditing all of that to prove the new value grants nothing,
-- and the next person to add a policy has one more role to think about.
--
-- This grants nothing. It answers one question -- "is this account a screen
-- rather than a person" -- and the answer changes where it lands and whether
-- its session is kept warm. Read scope stays exactly what its roles say, which
-- is the real boundary and always was.
--
-- WHAT THIS IS NOT
--
-- It is not a security control. A display account still holds a full session,
-- so anyone at the keyboard can type a different address and read whatever
-- that account may read. The hardened shape -- a revocable per-device token
-- and an endpoint returning only the aggregate payload -- is recorded in
-- docs/AI_HANDOFF.md and is still not built. Until it is, the screen belongs
-- in a trusted room and the account should hold the narrowest roles that let
-- the board render.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_display_account BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.is_display_account IS
  'This account drives a wall display rather than being used by a person: it lands on /board and its session is kept alive. Grants no permission -- the account''s roles are still the only thing that decides what it may read.';

-- Only an administrator may mark an account as a screen. Without this, the
-- existing profile UPDATE policy would let a user set it on themselves, and
-- "my session never expires" is not a preference.
DROP POLICY IF EXISTS "Display flag set by admins only" ON public.profiles;

CREATE OR REPLACE FUNCTION public.guard_display_account_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_display_account IS DISTINCT FROM OLD.is_display_account
     AND NOT public.has_any_role(auth.uid(), ARRAY['system_admin','sales_manager']::public.app_role[])
  THEN
    RAISE EXCEPTION 'Only an administrator may mark an account as a display account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_display_flag ON public.profiles;
CREATE TRIGGER profiles_guard_display_flag
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_display_account_flag();

COMMENT ON FUNCTION public.guard_display_account_flag IS
  'Stops a user granting themselves display-account status. "My session never expires" is not a preference.';
