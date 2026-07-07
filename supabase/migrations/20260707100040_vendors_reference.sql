-- =========================================================
-- PHC Sales OS — Phase D: Vendor Management (6.12) + Project Reference Library (6.11)
--
-- Vendors carry sensitive commercial data (purchase/reference prices, internal
-- ratings, notes) that salespeople must NOT see. The base table is manager-only;
-- a security-definer VIEW `vendors_public` exposes only the safe columns
-- (capabilities, lead time, public contact) to the whole sales team.
-- =========================================================

CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT,
  materials TEXT,
  city TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  lead_time TEXT,
  quality_level TEXT,
  previous_projects TEXT,
  qualification_files TEXT,
  portal_url TEXT,
  -- Sensitive — excluded from vendors_public:
  reference_prices TEXT,
  internal_rating INT CHECK (internal_rating BETWEEN 1 AND 5),
  internal_notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- Base table: managers only (full record incl. sensitive fields).
CREATE POLICY "Vendors full access by managers" ON public.vendors FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Public-safe projection. A non-security_invoker view runs as its owner and so
-- bypasses the base-table RLS, returning only these columns to any authenticated
-- user. Sensitive columns are simply not selected.
CREATE VIEW public.vendors_public
WITH (security_invoker = false) AS
SELECT
  id, name, scope, materials, city,
  contact_name, contact_phone, contact_email,
  lead_time, quality_level, previous_projects, portal_url,
  created_at, updated_at
FROM public.vendors;
GRANT SELECT ON public.vendors_public TO authenticated;

-- =========================
-- REFERENCE PROJECTS (Project Reference Library — 6.11)
-- =========================
CREATE TABLE public.reference_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  project_type TEXT,
  city TEXT,
  client_or_contractor TEXT,
  sector TEXT,
  year INT,
  phc_scope TEXT,
  sign_types TEXT,
  materials TEXT,
  project_value NUMERIC(16,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  images TEXT,
  challenges TEXT,
  solutions TEXT,
  shareable_with_client BOOLEAN NOT NULL DEFAULT false,
  requires_approval_to_share BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reference_projects TO authenticated;
GRANT ALL ON public.reference_projects TO service_role;
ALTER TABLE public.reference_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reference projects readable" ON public.reference_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Reference projects editable by BD/Manager" ON public.reference_projects FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_reference_projects_updated_at BEFORE UPDATE ON public.reference_projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_vendors_name ON public.vendors(name);
CREATE INDEX idx_reference_projects_sector ON public.reference_projects(sector);
CREATE INDEX idx_reference_projects_year ON public.reference_projects(year);
