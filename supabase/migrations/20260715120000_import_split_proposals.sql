-- =========================================================
-- PHC Sales OS — Import Split Proposals + sheet_count
--
-- import_split_proposals: staging table for entity_extractor AI output.
-- Each row is one proposed entity extracted from a multi-entity import row,
-- pending human review before being promoted to a real import_row.
--
-- import_files.sheet_count: number of sheets found in an xlsx workbook.
-- Written by the parse handler; used by the UI to enable sheet_classifier.
--
-- RLS: uses the existing can_access_import_batch() predicate for reads,
-- and is_pipeline_operator() / is_platform_admin() for writes — consistent
-- with import_intelligence_v2 patterns in this codebase.
--
-- Non-destructive: additive + idempotent.
-- Rollback: DROP TABLE import_split_proposals CASCADE;
--   ALTER TABLE import_files DROP COLUMN IF EXISTS sheet_count;
-- =========================================================

-- ============================================================
-- 1. import_split_proposals
-- ============================================================
create table if not exists public.import_split_proposals (
  id               uuid        primary key default gen_random_uuid(),
  batch_id         uuid        not null references public.import_batches(id) on delete cascade,
  source_row_id    uuid        not null references public.import_rows(id) on delete cascade,
  entity_type      text        not null,
  proposed_payload jsonb       not null default '{}',
  role             text,
  ai_output_id     uuid        references public.ai_agent_outputs(id) on delete set null,
  review_status    text        not null default 'pending'
                               check (review_status in ('pending', 'accepted', 'rejected')),
  reviewed_by      uuid        references auth.users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists idx_import_split_proposals_batch_status
  on public.import_split_proposals(batch_id, review_status);

-- ============================================================
-- 2. sheet_count column on import_files
-- ============================================================
alter table public.import_files
  add column if not exists sheet_count int4 not null default 1;

-- ============================================================
-- 3. RLS — mirrors import_intelligence_v2 access patterns
-- ============================================================
alter table public.import_split_proposals enable row level security;

-- Read: anyone who can access the parent batch (created_by match or pipeline
-- operator / platform admin via can_access_import_batch).
create policy "import_split_proposals_select"
  on public.import_split_proposals
  for select
  using (public.can_access_import_batch(batch_id));

-- Write: pipeline operators and platform admins only (same as other import
-- intelligence tables — bd_manager / sales_manager map to is_pipeline_operator).
create policy "import_split_proposals_insert"
  on public.import_split_proposals
  for insert
  with check (
    public.is_pipeline_operator(auth.uid())
    or public.is_platform_admin(auth.uid())
  );

create policy "import_split_proposals_update"
  on public.import_split_proposals
  for update
  using (
    public.is_pipeline_operator(auth.uid())
    or public.is_platform_admin(auth.uid())
  )
  with check (
    public.is_pipeline_operator(auth.uid())
    or public.is_platform_admin(auth.uid())
  );

create policy "import_split_proposals_delete"
  on public.import_split_proposals
  for delete
  using (public.is_platform_admin(auth.uid()));
