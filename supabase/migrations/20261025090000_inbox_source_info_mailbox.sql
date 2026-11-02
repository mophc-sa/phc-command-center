-- Intake items read from the info@phc-sa.com mailbox (manager feedback
-- 2026-10-19, group 3 part B). Its own migration: a new enum value cannot be
-- used in the same transaction that adds it (see 20260922100000).
ALTER TYPE public.inbox_source_type ADD VALUE IF NOT EXISTS 'info_mailbox';
