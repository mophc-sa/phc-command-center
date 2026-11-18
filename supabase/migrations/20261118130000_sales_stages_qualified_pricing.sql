-- =============================================================================
-- Sales stages to Omar's seven-step path (Mo, 2026-11-18): Qualified · RFQ ·
-- Pricing · Submitted · Negotiation · Verbal award · Signed.
-- Two real stages are added: `qualified` (an opportunity before its RFQ) and
-- `pricing` (the RFQ is being priced; the quotation is not submitted yet), so
-- `jih` now means a submitted quotation only. Existing deals keep their stage;
-- nothing is backfilled. Negotiation shows jih_bafo + under_negotiation, and
-- Signed shows contract_received + contract_signed + won, in the interface.
-- =============================================================================
ALTER TYPE public.sales_stage ADD VALUE IF NOT EXISTS 'qualified' BEFORE 'rfq_received';
ALTER TYPE public.sales_stage ADD VALUE IF NOT EXISTS 'pricing' AFTER 'rfq_received';
