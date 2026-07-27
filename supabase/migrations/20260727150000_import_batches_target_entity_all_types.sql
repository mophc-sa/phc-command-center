-- =============================================================================
-- import_batches.target_entity's CHECK constraint only allowed 6 of the 10
-- entity types the import UI actually offers (ImportTargetEntity /
-- TARGET_ENTITIES in src/lib/import-actions.ts): 'rfqs', 'tenders',
-- 'follow_ups', and 'quotations' were missing, even though
-- import_record_candidates_entity_type_check was already widened for these
-- (and more) by 20260720140000_import_candidates_all_entities.sql. A batch
-- created targeting any of these 4 entity types failed outright at
-- createBatch's INSERT, before the import pipeline could even start.
-- =============================================================================

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS import_batches_target_entity_check;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_target_entity_check
  CHECK (target_entity IN (
    'companies',
    'contacts',
    'leads',
    'opportunities',
    'projects',
    'boq',
    'rfqs',
    'tenders',
    'follow_ups',
    'quotations'
  ));
