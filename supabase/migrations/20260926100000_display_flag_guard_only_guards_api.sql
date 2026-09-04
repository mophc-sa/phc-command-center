-- =============================================================================
-- The guard blocked the only door an administrator actually uses.
--
-- 20260924100000 added a BEFORE UPDATE trigger so a user could not grant
-- themselves `is_display_account` -- "my session never expires" is not a
-- preference. That part was right and is kept unchanged.
--
-- What it got wrong is reading a NULL `auth.uid()` as an untrusted caller. It
-- is the opposite. Measured on production before writing this:
--
--     UPDATE grant on public.profiles   authenticated, postgres, service_role
--     UPDATE policies on that table     exactly one, TO authenticated
--
-- `anon` holds neither, so there is no unauthenticated API path to this table
-- at all. A NULL uid on this UPDATE therefore means the caller is `postgres`
-- or `service_role` -- already inside the database, holding privileges no
-- trigger can constrain. `postgres` removes this guard with one statement:
--
--     ALTER TABLE public.profiles DISABLE TRIGGER profiles_guard_display_flag;
--
-- So the NULL branch bought nothing, and cost the real thing: the Supabase SQL
-- editor runs as `postgres`, so the system_admin who is SUPPOSED to set this
-- flag was the one person the trigger stopped. It fired against an
-- administrator holding every required role, and never once against an
-- attacker, because the shape it was written to stop cannot reach it.
--
-- A check that only ever refuses the legitimate caller is not a boundary. It
-- is a lock on the inside of the door.
--
-- The guard now fires when there IS an identity and that identity lacks the
-- role -- the case it was written for, and the only case whose answer is not
-- already decided by something stronger than a trigger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.guard_display_account_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_display_account IS DISTINCT FROM OLD.is_display_account
     -- No identity means this is not an API request: `anon` cannot update this
     -- table, so the caller is postgres or service_role and can switch this
     -- trigger off at will. Refusing them protects nothing and locked out the
     -- administrator working in the SQL editor.
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['system_admin','sales_manager']::public.app_role[])
  THEN
    RAISE EXCEPTION 'Only an administrator may mark an account as a display account';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_display_account_flag IS
  'Stops a signed-in user granting themselves display-account status. Silent when auth.uid() is NULL: anon cannot update this table, so that caller is postgres or service_role, who can drop this trigger anyway -- refusing them only locked out the admin in the SQL editor.';
