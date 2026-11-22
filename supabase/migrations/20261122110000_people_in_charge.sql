-- Review 81/82 (Omar, 2026-11-22): a deal can have several people in charge
-- next to the sales rep. With one slot, adding Faisal removed Zayed — which
-- read in the meeting as "assigning someone wipes the main person".
-- person_in_charge_id stays (Discussion reads it) and holds the first of the list.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS people_in_charge uuid[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.opportunities.people_in_charge IS
  'Everyone in charge of the deal besides the sales rep; person_in_charge_id mirrors the first entry.';
UPDATE public.opportunities SET people_in_charge = ARRAY[person_in_charge_id]
 WHERE person_in_charge_id IS NOT NULL AND people_in_charge = '{}';
