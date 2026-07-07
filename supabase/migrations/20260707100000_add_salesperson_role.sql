-- =========================================================
-- Add the `salesperson` role (Faisal / Abdulrahman tier).
-- Kept in its OWN migration because Postgres forbids using a
-- newly-added enum value in the same transaction that adds it.
-- The CRM Core migration (next) references 'salesperson' in RLS.
-- =========================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'salesperson';
