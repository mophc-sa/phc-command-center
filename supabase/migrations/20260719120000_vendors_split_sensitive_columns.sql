-- =========================================================
-- Fix CRITICAL: vendors_public Security Definer View
--
-- Problem:
--   vendors_public used security_invoker = false (SECURITY DEFINER
--   behaviour) to bypass RLS and expose only safe vendor columns to
--   non-managers. Supabase flags this as CRITICAL because a SECURITY
--   DEFINER view runs as the view owner and bypasses all RLS policies,
--   creating an unaudited privilege-escalation surface.
--
-- Root cause:
--   PostgreSQL has no native column-level RLS. The original migration
--   used the security-definer view pattern as a workaround to hide
--   reference_prices / internal_rating / internal_notes from salespeople.
--
-- Fix — three-part:
--   1. Move sensitive columns to vendors_private (separate table, managers-
--      only RLS). Row-level security on the new table IS sufficient because
--      the columns that need protection now live in a row with proper policy.
--   2. Remove those columns from vendors. vendors becomes fully safe for
--      all authenticated to SELECT; no privileged view needed.
--   3. Introduce vendors_full view (security_invoker = true) for the manager
--      query path: joins vendors + vendors_private. Non-managers who query
--      this view get NULL for private columns (vendors_private RLS blocks
--      their rows → LEFT JOIN returns NULL). Direct-table-query access for
--      non-managers now goes straight to vendors instead of vendors_public.
--
-- Frontend change (vendors.tsx line 33):
--   was:  const source = isManager ? "vendors" : "vendors_public";
--   now:  const source = isManager ? "vendors_full" : "vendors";
--
-- Tables touched: vendors, vendors_private (new), vendors_full (new view)
-- Drops: vendors_public view
-- =========================================================

-- ---- 1. Create vendors_private ----------------------------------------
CREATE TABLE public.vendors_private (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  UUID NOT NULL UNIQUE REFERENCES public.vendors(id) ON DELETE CASCADE,
  reference_prices  TEXT,
  internal_rating   INT CHECK (internal_rating BETWEEN 1 AND 5),
  internal_notes    TEXT
);

GRANT SELECT, INSERT, UPDATE ON public.vendors_private TO authenticated;
GRANT ALL ON public.vendors_private TO service_role;
ALTER TABLE public.vendors_private ENABLE ROW LEVEL SECURITY;

-- Only pipeline operators (BD/managers) can access sensitive vendor data.
CREATE POLICY "Vendors private: pipeline operators only" ON public.vendors_private
  FOR ALL TO authenticated
  USING  (public.is_pipeline_operator(auth.uid()))
  WITH CHECK (public.is_pipeline_operator(auth.uid()));

-- ---- 2. Migrate existing sensitive data --------------------------------
INSERT INTO public.vendors_private (vendor_id, reference_prices, internal_rating, internal_notes)
SELECT id, reference_prices, internal_rating, internal_notes
FROM   public.vendors
WHERE  reference_prices IS NOT NULL
   OR  internal_rating  IS NOT NULL
   OR  internal_notes   IS NOT NULL;

-- ---- 3. Remove sensitive columns from vendors --------------------------
ALTER TABLE public.vendors
  DROP COLUMN IF EXISTS reference_prices,
  DROP COLUMN IF EXISTS internal_rating,
  DROP COLUMN IF EXISTS internal_notes;

-- ---- 4. Open vendors SELECT to all authenticated -----------------------
-- vendors now contains only safe columns. A salesperson querying vendors
-- directly sees exactly what vendors_public used to show them.
CREATE POLICY "Vendors readable by all" ON public.vendors
  FOR SELECT TO authenticated
  USING (true);

-- ---- 5. vendors_full view for the manager query path ------------------
-- security_invoker = true: runs as the calling user. Managers get full
-- data (both tables accessible). Non-managers get vendors rows with NULL
-- for private columns (vendors_private RLS blocks their access →
-- LEFT JOIN returns NULL — no error, just no sensitive data).
DROP VIEW IF EXISTS public.vendors_full;
CREATE VIEW public.vendors_full
WITH (security_invoker = true) AS
SELECT
  v.id, v.name, v.scope, v.materials, v.city,
  v.contact_name, v.contact_phone, v.contact_email,
  v.lead_time, v.quality_level, v.previous_projects,
  v.portal_url, v.created_by, v.created_at, v.updated_at,
  vp.reference_prices,
  vp.internal_rating,
  vp.internal_notes
FROM   public.vendors v
LEFT JOIN public.vendors_private vp ON vp.vendor_id = v.id;

GRANT SELECT ON public.vendors_full TO authenticated;

-- ---- 6. Drop the security-definer view ---------------------------------
DROP VIEW IF EXISTS public.vendors_public;
