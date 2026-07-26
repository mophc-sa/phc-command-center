-- =========================================================
-- PHC Sales OS — Documentation-only: leads.source vocabulary + owner_id intent
--
-- Resolves two pending product decisions recorded in docs/AI_HANDOFF.md /
-- tasks/backlog.md after the D2 (Pathfinder) PR #119 review:
--   1. leads.source = 'import' (set by supabase/functions/_shared/leads.ts's
--      insertLeadServerSide(), used by import-pipeline's commit_candidates)
--      is now a confirmed, official value alongside the original
--      'protenders' | 'external' | 'manual' set from 20260707100030_leads.sql.
--   2. Server-created leads (both commit_candidates and run_protenders_ingest)
--      intentionally leave owner_id NULL at creation — no default owner is
--      assigned automatically; a human claims/assigns the lead later. Not a bug.
--
-- Purely documentation (COMMENT ON COLUMN) — no schema, constraint, or data
-- change of any kind.
-- =========================================================

COMMENT ON COLUMN public.leads.source IS
'Origin of the lead. Documented vocabulary: protenders | external | manual | import. ''import'' is set server-side by _shared/leads.ts::insertLeadServerSide() for leads created via the Data Import Center (commit_candidates).';

COMMENT ON COLUMN public.leads.owner_id IS
'Sales owner. NULL at creation for server-created leads (Data Import Center commit_candidates and Protenders auto-ingest) by design: no default owner is assigned automatically, a human claims/assigns the lead afterward.';
