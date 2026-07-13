-- =============================================================================
-- Extra data fields: dynamic columns from data import
--
-- Adds extra_data jsonb to companies, contacts, and leads so that import
-- columns that don't map to a known CRM field are preserved rather than
-- discarded. Values are stored as-is (string/number/null) keyed by the
-- original source column name from the upload file.
--
-- Usage in queries:
--   SELECT extra_data->>'مدير الحساب' FROM companies WHERE ...
--   SELECT * FROM companies WHERE extra_data ? 'تاريخ آخر عرض'
-- =============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS extra_data jsonb;
ALTER TABLE leads     ADD COLUMN IF NOT EXISTS extra_data jsonb;

-- GIN indexes for fast key/value lookups on extra_data
CREATE INDEX IF NOT EXISTS idx_companies_extra_data ON companies USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_contacts_extra_data  ON contacts  USING gin(extra_data);
CREATE INDEX IF NOT EXISTS idx_leads_extra_data     ON leads     USING gin(extra_data);

COMMENT ON COLUMN companies.extra_data IS
  'Free-form fields from data import that do not map to a known CRM column. '
  'Keys = original source column names; values = raw string values.';
COMMENT ON COLUMN contacts.extra_data IS
  'Free-form fields from data import that do not map to a known CRM column.';
COMMENT ON COLUMN leads.extra_data IS
  'Free-form fields from data import that do not map to a known CRM column.';
