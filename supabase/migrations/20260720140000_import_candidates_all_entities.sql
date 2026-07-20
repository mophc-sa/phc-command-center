-- import_record_candidates.entity_type only allowed a subset of the entity
-- types the import UI actually lets a batch target (ImportTargetEntity in
-- import-actions.ts includes 'boq', 'rfqs', 'tenders', none of which were in
-- this CHECK). Widening it so candidate generation works for every target
-- entity, not just the ones modeled when this table was first added.

ALTER TABLE public.import_record_candidates
  DROP CONSTRAINT IF EXISTS import_record_candidates_entity_type_check;

ALTER TABLE public.import_record_candidates
  ADD CONSTRAINT import_record_candidates_entity_type_check
  CHECK (entity_type IN (
    'companies',
    'contacts',
    'leads',
    'opportunities',
    'projects',
    'quotations',
    'follow_ups',
    'account_interactions',
    'quotation_updates',
    'sales_actuals',
    'boq',
    'rfqs',
    'tenders'
  ));
