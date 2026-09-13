-- =============================================================================
-- Private calendar feeds for Outlook — one standing link per person.
--
-- Outlook subscribes to a calendar by URL and polls it without a session, so the
-- link itself is the credential: whoever has it can read that person's dated
-- obligations. That shapes every choice here.
--
-- - One row per person. Creating a new link REPLACES the old one, so "I think my
--   link leaked" has a one-click answer: generate another, and the old link stops
--   working at once.
-- - The token is 160 random bits and stored only as a SHA-256 hash. The plaintext
--   is shown to its owner exactly once, when it is made; this table cannot give it
--   back, and a copy of it hands out no working links.
-- - Service role only. No client role can read, write or enumerate the hashes.
-- - Deleting the user deletes the link.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.calendar_feed_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fetched_at TIMESTAMPTZ
);

COMMENT ON TABLE public.calendar_feed_tokens IS
  'One private Outlook calendar-feed link per person, stored as a SHA-256 hash. Regenerating replaces it, which is how a leaked link is revoked. Service role only.';
COMMENT ON COLUMN public.calendar_feed_tokens.last_fetched_at IS
  'When a calendar client last fetched the feed, so a person can see their subscription is alive.';

ALTER TABLE public.calendar_feed_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_feed_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.calendar_feed_tokens TO service_role;
