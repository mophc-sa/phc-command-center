-- Harden direct Data API access to privileged database functions.
--
-- Trigger functions run only through their attached triggers. They are not
-- RPC endpoints and application roles must never invoke them directly.
-- match_knowledge remains available to signed-in users and the service role,
-- but anonymous callers have no business need to bypass its source-table RLS.

REVOKE EXECUTE ON FUNCTION public.protect_commercial_stage()
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.protect_company_owner()
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.protect_opportunity_owner()
FROM PUBLIC, anon, authenticated;

-- Some existing hosted projects contain this event-trigger helper even though
-- it is not part of the repository's clean migration chain. Harden it where it
-- exists without making a fresh database rebuild depend on external drift.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_knowledge(extensions.vector, integer, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.match_knowledge(extensions.vector, integer, text)
TO authenticated, service_role;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Make new
-- public-schema functions opt-in so each future migration must name the roles
-- that are allowed to call its RPCs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;
