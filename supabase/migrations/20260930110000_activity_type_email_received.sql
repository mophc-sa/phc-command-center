-- =============================================================================
-- A client's reply, captured onto the deal, is its own kind of activity.
--
-- An email sent from the system is 'email_draft' with status 'sent' — the row the
-- system already understood. A reply that ARRIVES is not a draft of anything,
-- and recording it as one would make every report that reads activity_type
-- quietly wrong about which way the mail went.
--
-- Its own file, deliberately. Postgres will not let a new enum value be used in
-- the same transaction that adds it, and the next migration uses it inside
-- last_verified_client_contact(). Splitting them is what lets both apply.
-- =============================================================================

ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'email_received';
