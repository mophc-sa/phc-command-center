-- =========================================================
-- PHC Sales OS — Phase A: CRM Core
-- Normalizes the flat opportunity-centric model into
-- Company -> Contacts / Projects, then links opportunities via FK
-- and backfills from the existing free-text fields.
-- Derived from the PHC Sales OS plan (vault: 09 AI and Systems),
-- sections 6.3 (Accounts), 6.4 (Contacts), 6.5 (Projects).
-- =========================================================

-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.company_type AS ENUM (
  'main_contractor',
  'developer',
  'owner',
  'consultant',
  'existing_client',
  'previous_client',
  'target_account',
  'vendor',
  'do_not_target'
);

CREATE TYPE public.account_status AS ENUM (
  'pending_review',
  'active',
  'dormant',
  'do_not_target'
);

CREATE TYPE public.contact_authority AS ENUM (
  'decision_maker',
  'influencer',
  'technical_contact',
  'unknown_authority'
);

CREATE TYPE public.contact_location AS ENUM ('site_office', 'head_office', 'unknown');

CREATE TYPE public.verification_status AS ENUM ('pending_verification', 'verified', 'rejected');

-- =========================
-- Trigger helper: only managers may reassign an owner column.
-- Enforces the Sales OS rule that salespeople cannot change
-- Account Owner / Opportunity Owner.
-- =========================
-- Note: enforcement is skipped when auth.uid() IS NULL, i.e. the trusted
-- service-role / backend layer (sales-os-api Edge Function), which does its own
-- authorization before reassigning owners. For direct authenticated users the
-- guard still applies as defense in depth alongside RLS.
CREATE OR REPLACE FUNCTION public.protect_company_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_owner_id IS DISTINCT FROM OLD.account_owner_id
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only a manager can change the account owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_opportunity_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only a manager can change the opportunity owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_opportunities_protect_owner
BEFORE UPDATE ON public.opportunities
FOR EACH ROW EXECUTE FUNCTION public.protect_opportunity_owner();

-- =========================
-- COMPANIES (Accounts & Client Relations — 6.3)
-- =========================
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_type public.company_type NOT NULL DEFAULT 'target_account',
  regions TEXT,
  account_status public.account_status NOT NULL DEFAULT 'pending_review',
  account_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  relationship_level TEXT,
  last_contact_at TIMESTAMPTZ,
  next_action TEXT,
  next_action_due DATE,
  internal_notes TEXT,
  upsell_notes TEXT,
  source TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Companies readable" ON public.companies FOR SELECT TO authenticated USING (true);
-- Salespeople may add a company (as pending_review); managers/BD too.
CREATE POLICY "Companies insertable by sales team" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
-- Account owner, BD, or managers may update. Owner reassignment is blocked by trigger for non-managers.
CREATE POLICY "Companies updatable by owner or BD/Manager" ON public.companies FOR UPDATE TO authenticated
  USING (account_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (account_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
-- Only managers may delete a company.
CREATE POLICY "Companies deletable by Manager/CEO" ON public.companies FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_companies_protect_owner BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.protect_company_owner();

-- =========================
-- CONTACTS (Contacts & Decision Makers — 6.4)
-- Independent of any single opportunity; belongs to a company.
-- =========================
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  title TEXT,
  phone TEXT,
  email TEXT,
  linkedin TEXT,
  location public.contact_location NOT NULL DEFAULT 'unknown',
  authority public.contact_authority NOT NULL DEFAULT 'unknown_authority',
  source TEXT,
  last_verified_at TIMESTAMPTZ,
  confidence_score INT CHECK (confidence_score BETWEEN 0 AND 100),
  verification_status public.verification_status NOT NULL DEFAULT 'pending_verification',
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contacts readable" ON public.contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Contacts insertable by sales team" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Contacts updatable by owner or BD/Manager" ON public.contacts FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Contacts deletable by Manager/CEO" ON public.contacts FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- PROJECTS (Projects Module — 6.5)
-- A project is its own entity, distinct from an opportunity.
-- =========================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  sector TEXT,
  owner_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  main_contractor_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  consultant_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  total_value NUMERIC(16,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  project_stage public.project_stage NOT NULL DEFAULT 'unknown',
  completion_pct NUMERIC(5,2) CHECK (completion_pct BETWEEN 0 AND 100),
  signage_package_status public.signage_package_status NOT NULL DEFAULT 'unknown',
  expected_boq_date DATE,
  expected_signage_date DATE,
  source TEXT,
  source_confidence public.confidence_level NOT NULL DEFAULT 'low',
  verification_status public.verification_status NOT NULL DEFAULT 'pending_verification',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Projects readable" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Projects insertable by sales team" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Projects updatable by sales team" ON public.projects FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Projects deletable by Manager/CEO" ON public.projects FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- OPPORTUNITIES: link to the normalized entities
-- (free-text columns are kept during the transition, then backfilled).
-- =========================
ALTER TABLE public.opportunities
  ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN main_contractor_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

-- Let salespeople create opportunities they own (as owner); previously BD/Manager only.
DROP POLICY IF EXISTS "BD/Manager/CEO can insert opportunities" ON public.opportunities;
CREATE POLICY "Sales team can insert opportunities" ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

-- Let salespeople add stakeholders / BOQ / draft quotations on their work.
DROP POLICY IF EXISTS "Stakeholders editable by BD/Manager/CEO" ON public.stakeholders;
CREATE POLICY "Stakeholders editable by sales team" ON public.stakeholders FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

DROP POLICY IF EXISTS "BOQs editable by BD/Manager/CEO" ON public.boqs;
CREATE POLICY "BOQs editable by sales team" ON public.boqs FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

DROP POLICY IF EXISTS "BOQ items editable by BD/Manager/CEO" ON public.boq_items;
CREATE POLICY "BOQ items editable by sales team" ON public.boq_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

DROP POLICY IF EXISTS "Quotations insertable by BD/Manager/CEO" ON public.quotations;
CREATE POLICY "Quotations insertable by sales team" ON public.quotations FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

-- =========================
-- INDEXES
-- =========================
CREATE INDEX idx_companies_type ON public.companies(company_type);
CREATE INDEX idx_companies_owner ON public.companies(account_owner_id);
CREATE INDEX idx_companies_status ON public.companies(account_status);
CREATE INDEX idx_contacts_company ON public.contacts(company_id);
CREATE INDEX idx_contacts_owner ON public.contacts(owner_id);
CREATE INDEX idx_projects_contractor ON public.projects(main_contractor_id);
CREATE INDEX idx_projects_stage ON public.projects(project_stage);
CREATE INDEX idx_opportunities_company ON public.opportunities(company_id);
CREATE INDEX idx_opportunities_project ON public.opportunities(project_id);
CREATE INDEX idx_opportunities_contractor ON public.opportunities(main_contractor_id);

-- =========================================================
-- BACKFILL — derive normalized rows from existing free text.
-- Case-insensitive dedup by name. Backfilled rows are marked active/verified
-- because they represent real, already-known data (not new pending entries).
-- =========================================================

-- Main contractors
INSERT INTO public.companies (name, company_type, account_status, source)
SELECT DISTINCT btrim(o.main_contractor), 'main_contractor', 'active', 'backfill'
FROM public.opportunities o
WHERE o.main_contractor IS NOT NULL AND btrim(o.main_contractor) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE lower(c.name) = lower(btrim(o.main_contractor)));

-- Clients (skip any name already inserted as a contractor)
INSERT INTO public.companies (name, company_type, account_status, source)
SELECT DISTINCT btrim(o.client), 'existing_client', 'active', 'backfill'
FROM public.opportunities o
WHERE o.client IS NOT NULL AND btrim(o.client) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE lower(c.name) = lower(btrim(o.client)));

-- Projects (one per distinct project name, with a representative row)
INSERT INTO public.projects (name, location, sector, project_stage, signage_package_status, main_contractor_id, source, source_confidence, verification_status)
SELECT DISTINCT ON (lower(btrim(o.project_name)))
  btrim(o.project_name), o.location, o.sector, o.project_stage, o.signage_package_status,
  (SELECT c.id FROM public.companies c WHERE lower(c.name) = lower(btrim(o.main_contractor)) LIMIT 1),
  'backfill', o.source_confidence, 'verified'
FROM public.opportunities o
WHERE o.project_name IS NOT NULL AND btrim(o.project_name) <> ''
ORDER BY lower(btrim(o.project_name)), o.created_at;

-- Link opportunities to the normalized entities
UPDATE public.opportunities o SET main_contractor_id = c.id
FROM public.companies c
WHERE o.main_contractor IS NOT NULL AND lower(c.name) = lower(btrim(o.main_contractor));

UPDATE public.opportunities o SET company_id = c.id
FROM public.companies c
WHERE o.client IS NOT NULL AND lower(c.name) = lower(btrim(o.client));

UPDATE public.opportunities o SET project_id = p.id
FROM public.projects p
WHERE o.project_name IS NOT NULL AND lower(p.name) = lower(btrim(o.project_name));
