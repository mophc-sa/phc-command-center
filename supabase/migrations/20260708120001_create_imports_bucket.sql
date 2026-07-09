-- Extracted from the archived schema-export snapshot duplicate
-- 20260708120000_data_import_center.sql (see docs/migration/archived-duplicates/).
-- This was the only statement in that file not already covered by
-- 20260708083821_39f81e3e-253b-4805-933a-f51a3c413428.sql and
-- 20260708083851_c0f6738d-cd4e-4b52-841f-02457d3a5f09.sql, so it is kept
-- here as its own migration.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imports',
  'imports',
  false,
  10485760, -- 10 MB
  ARRAY['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel','text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
