-- =============================================================================
-- Sending email from inside the system — storage.
--
-- Requested 2026-09-13. Design: docs/implementation/outlook-integration.md.
-- Mail is sent through Postmark on the company domain; the Microsoft Graph route
-- is blocked on a GoDaddy-held tenant admin.
--
-- NO NEW ACTIVITY TYPE FOR OUTBOUND MAIL
--
-- A sent email is recorded as the row the system already understands:
-- activity_type 'email_draft', status 'sent'. last_verified_client_contact
-- (20260917100000) has counted exactly that as client contact since it shipped,
-- so mail sent from the system feeds stale-deal detection without touching the
-- detection logic. `last_activity_at` is filled on 46 of 741 opportunities; every
-- email sent from here closes part of that gap on its own.
--
-- THE ORIGINAL RULE, AND WHAT SURVIVES OF IT
--
-- 20260707100020 says of draft_content: "Drafts are NEVER auto-sent: sending is a
-- human action outside this system." The second half no longer holds — sending
-- now happens inside. The first half does: the only path to the provider is an
-- explicit click through the `send_email` handler. There is no scheduled,
-- automated or bulk sender, and none should be added without revisiting this.
-- =============================================================================

-- ---- Delivery facts on the activity row -------------------------------------
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS email_from TEXT,
  ADD COLUMN IF NOT EXISTS email_to TEXT,
  ADD COLUMN IF NOT EXISTS email_cc TEXT;

-- One provider message, one row. This is what will make the inbound webhook
-- idempotent too: Postmark retries up to ten times, and a retried delivery must
-- not attach the same reply to a deal twice.
CREATE UNIQUE INDEX IF NOT EXISTS activities_provider_message_id_key
  ON public.activities (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON COLUMN public.activities.provider_message_id IS
  'The mail provider''s message id. Unique, so a retried webhook cannot record the same message twice.';
COMMENT ON COLUMN public.activities.email_from IS 'Sender address, for email activities.';
COMMENT ON COLUMN public.activities.email_to IS 'Comma-separated To addresses, for email activities.';
COMMENT ON COLUMN public.activities.email_cc IS 'Comma-separated Cc addresses, for email activities.';

-- ---- Thread tokens ----------------------------------------------------------
-- Every email sent from the system carries a capture address in its Reply-To:
-- reply+TOKEN@<capture domain>. When the client replies, the token is what binds
-- that reply to the deal. Nothing is inferred from the sender or the subject.
--
-- The token is visible to the client — it sits in a header — so it is not a
-- credential. What it must be is unguessable, because a valid token lets anyone
-- attach an email to that deal. Eighty random bits, and stored here only as a
-- SHA-256 hash, so a copy of this table does not hand out working tokens.
CREATE TABLE IF NOT EXISTS public.email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_threads_opportunity_idx ON public.email_threads (opportunity_id);

COMMENT ON TABLE public.email_threads IS
  'Hashed reply tokens binding client replies to the record an email was sent from. Service role only: no client can read, write or enumerate them.';

-- Service role only. RLS on with no policies denies every client role, and the
-- grants are removed as well, so neither a missing policy nor a future
-- permissive one exposes the hashes to the browser.
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_threads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_threads TO service_role;
