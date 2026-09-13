-- =============================================================================
-- A reply from the client is the strongest proof of contact there is.
--
-- last_verified_client_contact() counts calls, visits, meetings and SENT emails
-- and WhatsApp messages. A reply that arrives from the client is stronger
-- evidence than any of those — it proves the client read us and answered — so it
-- counts too, unconditionally: unlike a draft, a received email has no unsent
-- state to exclude.
--
-- EVERYTHING ELSE IS COPIED EXACTLY FROM 20260917100000
--
-- That version exists to enforce visibility inside the function (it is SECURITY
-- DEFINER and the views call it as the caller). Changing the contact rule must
-- not weaken that, so the body, the search_path and the grant are copied from it,
-- and the only change to the logic is 'email_received' in the first list. A test
-- compares the two.
--
-- One addition that is not a change: the REVOKE from PUBLIC and anon is restated.
-- 20260916100000 made that revocation and CREATE OR REPLACE keeps existing grants,
-- so it already holds; restating it means this file does not depend on that
-- ordering to stay safe.
--
-- The function's own comment says it mirrors isMeaningfulClientActivity() in
-- src/lib/attention.ts and "the two must not drift". The same change is made
-- there in the same commit, and a contract test fails if either list moves
-- without the other.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.last_verified_client_contact(_opportunity_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT max(a.occurred_at)
    FROM public.activities a
   WHERE a.related_opportunity_id = _opportunity_id
     AND (
       a.activity_type IN ('call', 'visit', 'meeting', 'email_received')
       OR (a.activity_type IN ('email_draft', 'whatsapp_draft') AND a.status = 'sent')
     )
     AND (
       -- pg_cron / Edge Function / owner: no subject, not a user.
       (SELECT auth.uid()) IS NULL
       -- Otherwise the caller must be entitled to read the deal itself.
       OR public.can_read_opportunity_record(_opportunity_id, (SELECT auth.uid()))
     );
$$;

-- Unchanged posture: authenticated only. anon and PUBLIC stay revoked — either
-- would take the auth.uid() IS NULL branch and read contact history for any deal.
REVOKE EXECUTE ON FUNCTION public.last_verified_client_contact(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.last_verified_client_contact(UUID) TO authenticated;

COMMENT ON FUNCTION public.last_verified_client_contact(UUID) IS
  'When the client was last actually contacted, or NULL when nothing in the '
  'system proves contact ever happened. NULL means UNKNOWN, never "nobody '
  'called": the import path records no activity history, so promoted '
  'historical deals return NULL while carrying years of real relationship. A '
  'note is written to ourselves and an unsent draft reached nobody, so neither '
  'counts; a reply received from the client (email_received) always does. '
  'Mirrors isMeaningfulClientActivity() in src/lib/attention.ts — the two must '
  'not drift. '
  'SECURITY DEFINER, so it enforces visibility itself via '
  'can_read_opportunity_record(): a caller who cannot read the opportunity '
  'gets NULL, indistinguishable from no contact and from a UUID that does not '
  'exist. authenticated holds EXECUTE because pipeline_by_stage and '
  'sla_breaches call it and function EXECUTE is checked against the CALLER, '
  'not the view owner. anon and PUBLIC must stay revoked (20260916100000): '
  'they would take the auth.uid() IS NULL internal branch.';
