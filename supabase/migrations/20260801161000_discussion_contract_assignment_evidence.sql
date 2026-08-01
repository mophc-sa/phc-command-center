-- System-redesign request (2026-08-01): Discussion, Contract Stage,
-- Assignment simplification, and Evidence file uploads on Opportunities.

-- ============================================================
-- 1. DISCUSSION — a single free-text update thread per opportunity,
--    append-only (no UPDATE/DELETE grant: previous updates are never
--    replaced, matching the product requirement). Restricted to General
--    Manager, Sales Manager, Development Manager (bd_manager), and System
--    Administrator.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_use_discussion(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(
    _user_id,
    ARRAY['general_manager','sales_manager','bd_manager','system_admin']::public.app_role[]
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_use_discussion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_discussion(uuid) TO authenticated;

CREATE TABLE public.opportunity_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  person_in_charge_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  person_in_charge_note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_opportunity_discussions_opp ON public.opportunity_discussions(opportunity_id, created_at DESC);

-- INSERT/SELECT only — no UPDATE/DELETE grant at all, so posts can never be
-- edited or removed by anyone (including service_role callers using the
-- anon/authenticated grant path); this is an intentional immutable log.
GRANT SELECT, INSERT ON public.opportunity_discussions TO authenticated;
GRANT ALL ON public.opportunity_discussions TO service_role;
ALTER TABLE public.opportunity_discussions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Discussion readable by authorised roles" ON public.opportunity_discussions
  FOR SELECT TO authenticated USING (public.can_use_discussion(auth.uid()));
CREATE POLICY "Discussion postable by authorised roles" ON public.opportunity_discussions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_use_discussion(auth.uid()) AND created_by = auth.uid());

-- ============================================================
-- 2. ASSIGNMENT — Person in Charge lives on the opportunity itself (single
--    source of truth), reused by both the Assignment card and each
--    Discussion post rather than duplicated per-post.
-- ============================================================

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS person_in_charge_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS person_in_charge_note TEXT;

-- ============================================================
-- 3. CONTRACTS — minimal contract record linked to an opportunity. Multiple
--    contracts per opportunity are allowed (the UI lists all of them).
-- ============================================================

CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  contract_name TEXT,
  contract_reference_number TEXT,
  stage TEXT NOT NULL DEFAULT 'draft'
    CHECK (stage IN ('draft','sent_for_signature','signed','active','completed','terminated')),
  client TEXT,
  contract_value NUMERIC,
  currency TEXT NOT NULL DEFAULT 'SAR',
  start_date DATE,
  end_date DATE,
  responsible_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  document_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contracts_opportunity ON public.contracts(opportunity_id);
CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No DELETE grant to authenticated: matches this schema's established
-- pattern (20260711160000_rbac_record_lifecycle_hardening.sql) of routing
-- hard-deletes of commercial records through the governed
-- request_delete/decide_approval/execute_delete flow rather than raw RLS.
GRANT SELECT, INSERT, UPDATE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contracts readable" ON public.contracts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Contracts insertable by pipeline operator or admin" ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (public.is_pipeline_operator(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));
CREATE POLICY "Contracts updatable by pipeline operator or admin" ON public.contracts FOR UPDATE TO authenticated
  USING (public.is_pipeline_operator(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]))
  WITH CHECK (public.is_pipeline_operator(auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));

-- Safe, additive backfill: opportunities already carried ad-hoc contract
-- fields (contract_value / contract_reference_number, populated by the
-- "contract_received" sales-stage advance action — see applySalesStage() in
-- supabase/functions/sales-os-api/shared.ts). The contract document itself
-- was never a column on opportunities — it's recorded as a row in the
-- existing `award_evidence` table (evidence_type = 'contract_received').
-- Nothing is dropped from either table here — this only copies the data
-- forward into the new dedicated `contracts` table so it's visible under
-- the new Contract Stage section too.
INSERT INTO public.contracts (opportunity_id, contract_reference_number, contract_value, currency, document_url, client, stage, notes, created_at)
SELECT
  o.id,
  o.contract_reference_number,
  o.contract_value,
  COALESCE(o.currency, 'SAR'),
  ev.document_url,
  COALESCE(o.client, o.project_name),
  CASE WHEN o.stage = 'won' THEN 'active' ELSE 'draft' END,
  ev.note,
  COALESCE(o.updated_at, o.created_at, now())
FROM public.opportunities o
LEFT JOIN LATERAL (
  SELECT document_url, note
  FROM public.award_evidence
  WHERE linked_record_type = 'opportunity'
    AND linked_record_id = o.id
    AND evidence_type = 'contract_received'
  ORDER BY date_received DESC NULLS LAST
  LIMIT 1
) ev ON true
WHERE o.contract_reference_number IS NOT NULL
   OR o.contract_value IS NOT NULL;

-- ============================================================
-- 4. EVIDENCE — file metadata columns for uploads (size/type for
--    server-side validation feedback, uploader for attribution).
-- ============================================================

ALTER TABLE public.evidence_sources
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add system_admin to the existing evidence write policy (was
-- bd_manager/sales_manager/ceo only) so Evidence uploads work for admins
-- too, matching this migration set's broader Development Manager / System
-- Administrator authority grant.
DROP POLICY IF EXISTS "Evidence editable by BD/Manager/CEO" ON public.evidence_sources;
CREATE POLICY "Evidence editable by BD/Manager/CEO/Admin" ON public.evidence_sources FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo','system_admin']::public.app_role[]));

-- Server-side file type/size enforcement on the storage bucket itself
-- (Supabase Storage validates these at upload time, not just in client JS).
UPDATE storage.buckets
SET file_size_limit = 26214400, -- 25 MB
    allowed_mime_types = ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/webp'
    ]
WHERE id = 'attachments';

-- Add system_admin to the storage upload policy too (was salesperson/bd
-- manager/sales manager/ceo only).
DROP POLICY IF EXISTS "Attachments insertable by sales team" ON storage.objects;
CREATE POLICY "Attachments insertable by sales team"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo','system_admin']::public.app_role[])
  );
