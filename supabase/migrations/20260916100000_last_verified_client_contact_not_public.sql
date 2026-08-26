-- =============================================================================
-- last_verified_client_contact() must not be callable by the browser.
--
-- THE DEFECT
-- ----------
-- 20260914100000 created the function SECURITY DEFINER — correctly, it has to
-- read activities regardless of who is asking — and then granted it:
--
--   GRANT EXECUTE ON FUNCTION public.last_verified_client_contact(UUID)
--     TO authenticated, service_role;
--
-- and revoked nothing. Two problems follow from that one line.
--
-- 1. PostgreSQL grants EXECUTE on a new function to PUBLIC by default. The
--    migration never revoked it, so the reachable set was never "authenticated
--    and service_role" — it was EVERYONE, `anon` included. Confirmed against
--    production before this migration was written: an unauthenticated POST to
--    /rest/v1/rpc/last_verified_client_contact returned HTTP 200, not 403.
--    The anon key is public by design and ships in the browser bundle.
--
-- 2. SECURITY DEFINER means the function ignores RLS. Given an opportunity
--    UUID, it answers when that deal was last genuinely contacted — for any
--    opportunity, including one the caller has no permission to read.
--
-- Nothing is leaking today only because production holds no call, visit,
-- meeting or sent draft yet, so every call returns NULL. That is a fact about
-- the data, not about the permission, and it stops being true the first time a
-- rep logs a call.
--
-- THE FIX, AND WHY IT IS THIS ONE
-- -------------------------------
-- Nobody needs to call it directly. Every real caller reaches it through an
-- object that already runs as the owner:
--
--   * run_sales_automations()  — SECURITY DEFINER, owner postgres
--   * pipeline_by_stage        — a plain view; only ONE view in this database
--                                sets security_invoker, and it is not this one
--   * sla_breaches             — likewise
--
-- so each executes the function with the OWNER's privileges, not the caller's.
-- Revoking from authenticated and PUBLIC therefore changes nothing any user
-- can currently do through the product. There is no frontend or Edge Function
-- call site: the entry in types.ts is a generated signature, not a caller.
--
-- Because no authenticated caller exists, adding a visibility predicate inside
-- the function would be defending a door nobody uses, and would leave the
-- function as an authorization oracle — "permission denied" versus NULL still
-- tells you whether a UUID is real. Removing EXECUTE removes the oracle too:
-- every unprivileged caller now gets the same answer regardless of whether the
-- opportunity exists, because none of them can invoke it at all.
--
-- service_role keeps EXECUTE. It is a trusted backend credential that already
-- bypasses RLS wholesale, and this mirrors exactly how the same migration
-- hardened run_sales_automations().
--
-- RLS is untouched. No policy is added, dropped or altered.
-- =============================================================================

-- REVOKE FROM PUBLIC does not remove a grant made directly to a role, so the
-- explicit grant from 20260914100000 has to be revoked by name as well.
REVOKE ALL ON FUNCTION public.last_verified_client_contact(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.last_verified_client_contact(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.last_verified_client_contact(UUID) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.last_verified_client_contact(UUID) TO service_role;

COMMENT ON FUNCTION public.last_verified_client_contact(UUID) IS
  'When the client was last actually contacted, or NULL when nothing in the '
  'system proves contact ever happened. NULL means UNKNOWN, never "nobody '
  'called": the import path records no activity history, so promoted '
  'historical deals return NULL while carrying years of real relationship. A '
  'note is written to ourselves and an unsent draft reached nobody, so neither '
  'counts. Mirrors isMeaningfulClientActivity() in src/lib/attention.ts — the '
  'two must not drift. '
  'SECURITY DEFINER, so it reads activities without regard to RLS: it is '
  'therefore NOT executable by anon or authenticated (20260916100000). Reach '
  'it through pipeline_by_stage, sla_breaches or run_sales_automations, each '
  'of which runs as the owner. Granting it back to a browser-facing role would '
  'let anyone holding an opportunity UUID read that deal''s contact history '
  'without permission to read the deal.';
