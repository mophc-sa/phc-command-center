-- =========================================================
-- PHC Sales OS — Salesperson Dashboard: new workflow stages
-- Adds BAFO stages, contract_signed, and annual target period.
-- Non-destructive: only ADD VALUE to existing enums.
-- =========================================================

-- sales_stage: jih_bafo between jih and under_negotiation
ALTER TYPE public.sales_stage ADD VALUE IF NOT EXISTS 'jih_bafo' AFTER 'jih';
-- sales_stage: contract_signed between contract_received and won
ALTER TYPE public.sales_stage ADD VALUE IF NOT EXISTS 'contract_signed' AFTER 'contract_received';

-- tender_stage: tender_bafo between tender_under_process and award_negotiation
ALTER TYPE public.tender_stage ADD VALUE IF NOT EXISTS 'tender_bafo' AFTER 'tender_under_process';

-- target_period: annual
ALTER TYPE public.target_period ADD VALUE IF NOT EXISTS 'annual' AFTER 'quarterly';
