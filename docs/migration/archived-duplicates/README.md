# Archived duplicate migrations

The five migration files in this folder were removed from
`supabase/migrations/` on 2026-07-09. All of them are schema-export
snapshot duplicates — they re-declare database objects (types, tables,
policies, functions, triggers, indexes) that already exist in earlier,
separately tracked migrations. They appear to have been produced by a
schema-export/snapshot tool rather than written by hand: no comments,
minified formatting, and (for two of them) an explicit
`-- ==== <original_migration>.sql ====` header naming the file they copy.

## Fully duplicated (no unique SQL — nothing lost by removing them)

- **`20260707174258_fce4a827-cc93-4fc4-8fa5-823ec5702128.sql`**
  duplicates `20260706120000_quotations_boq_targets.sql` +
  `20260707100000_add_salesperson_role.sql`.
- **`20260707174816_7325a47a-61d5-4cc8-adda-728a926e7269.sql`**
  duplicates `20260707100010_crm_core.sql`,
  `20260707100020_activities_pipeline.sql`,
  `20260707100030_leads.sql`,
  `20260707100040_vendors_reference.sql`,
  `20260707100050_recommendations.sql`,
  `20260707100070_rag.sql`.
- **`20260707174904_b5f4fe99-9b30-412a-b6f1-e6375b29fab1.sql`**
  duplicates `20260707100060_storage.sql` (the four `attachments` bucket
  storage policies).
- **`20260708115716_78cfb5ad-f41c-4f69-8cb3-d3a6d737fabd.sql`**
  duplicates, line for line, the combined content of
  `20260708130010_commercial_authority_helpers.sql`,
  `20260708130020_approval_execution.sql`,
  `20260708130030_conversion_rules.sql`,
  `20260708130040_protect_commercial_stage.sql`, and
  `20260708130050_ai_foundation.sql`.

Each was verified statement-by-statement against the migrations it
duplicates; every `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE` /
`CREATE POLICY` / function / trigger / index in these four files has an
identical counterpart elsewhere in `supabase/migrations/`.

## Partially duplicated (one unique statement extracted first)

- **`20260708120000_data_import_center.sql`** duplicates
  `20260708083821_39f81e3e-253b-4805-933a-f51a3c413428.sql` (import
  staging tables, indexes, RLS policies, `companies` columns, the
  `import_batches_updated_at` trigger) and the storage policies in
  `20260708083851_c0f6738d-cd4e-4b52-841f-02457d3a5f09.sql`.

  It also contained one statement that did **not** exist anywhere else in
  the migration history: the `INSERT INTO storage.buckets (...) VALUES
  ('imports', ...)` block that creates the private `imports` bucket. That
  statement was extracted verbatim, unchanged, into its own migration —
  **`supabase/migrations/20260708120001_create_imports_bucket.sql`** —
  before this file was archived, so no SQL was lost.

## Why they were removed

Running `supabase db push` against the PHC AGENT project
(`lrfdtoexyeghrzynapyn`) failed on the first of these files with
`type "quotation_status" already exists (SQLSTATE 42710)`, because the
objects it redeclares were already applied to that project via the
original migrations. Leaving any of these five files in
`supabase/migrations/` would break a fresh rebuild or `db push` against a
project that already has the earlier, real migrations applied (or, for
`115716` and `120000`, would collide with their own un-applied duplicate
counterparts in the same push).

No SQL was lost: every statement in all five files already exists,
unmodified, in the migrations listed above (or, for the one exception,
in `20260708120001_create_imports_bucket.sql`), which remain in
`supabase/migrations/`.
