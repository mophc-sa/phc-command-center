-- =============================================================================
-- Pricing loop PR 3: the supplier role (spec section 2). Alone in its file: a
-- new enum value cannot be used in the transaction that adds it, and the next
-- migration uses it.
-- =============================================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supplier';
