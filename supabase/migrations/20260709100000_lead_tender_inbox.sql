-- =========================================================
-- Sales OS pilot — Sprint 3: Lead & Tender Inbox.
--
-- A single unified intake point for every new sales input (manual lead,
-- manual tender, manual RFQ, old-data candidate, referral, market signal,
-- and future email/whatsapp automation) before it becomes a real CRM
-- record. Nothing here writes to companies/contacts/projects/rfqs/tenders
-- directly — conversion always goes through the existing create* functions
-- (createCompany, createContact, createProject, createRfq, createTender,
-- createLead), so every downstream safeguard those already enforce (e.g.
-- companies start 'pending_review', leads require the full qualification
-- pipeline before becoming an opportunity) still applies. This table is
-- reviewed and considered: no existing table's shape fits a multi-target,
-- pre-classification capture record — leads is opportunity-only (its
-- duplicate_of/converted_opportunity_id are hard FKs to opportunities),
-- and reusing it would mean bolting on ~15 unrelated columns and a second,
-- conflicting stage machine. One small, purpose-built table instead.
-- =========================================================

CREATE TYPE public.inbox_source_type AS ENUM (
  'manual_lead',
  'manual_tender',
  'manual_rfq',
  'old_data_candidate',
  'referral',
  'market_signal',
  'email_placeholder',    -- reserved for future inbound-email automation
  'whatsapp_placeholder'  -- reserved for future inbound-WhatsApp automation
);

CREATE TYPE public.inbox_classification AS ENUM (
  'unclassified',
  'company',
  'contact',
  'project',
  'rfq',
  'tender',
  'opportunity_candidate',
  'signal_watchlist',
  'duplicate',
  'incomplete'
);

CREATE TYPE public.inbox_status AS ENUM (
  'new',
  'in_review',
  'converted',
  'sent_to_missing_data',
  'marked_duplicate',
  'archived'
);

CREATE TABLE public.inbox_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Every item needs a source (NOT NULL — enforced at the schema level).
  source_type public.inbox_source_type NOT NULL,
  source_name TEXT,

  -- Raw capture fields — free text until conversion maps them onto a real,
  -- validated record via the existing create* functions.
  company_name TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  project_name TEXT,
  client_owner TEXT,
  main_contractor TEXT,
  consultant TEXT,
  scope TEXT,
  location TEXT,
  estimated_value NUMERIC(16,2),
  deadline DATE,
  notes TEXT,
  evidence_url TEXT,

  assigned_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  next_action TEXT,
  follow_up_date DATE,

  classification public.inbox_classification NOT NULL DEFAULT 'unclassified',
  status public.inbox_status NOT NULL DEFAULT 'new',

  -- Polymorphic — set by "mark duplicate" (points at the existing record
  -- this is a duplicate of) and by conversion (points at the record that
  -- was created from it). Never a hard FK: the target table varies.
  duplicate_of_type TEXT,
  duplicate_of_id UUID,
  converted_record_type TEXT,
  converted_record_id UUID,

  missing_data_reason TEXT,
  archive_reason TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbox_items TO authenticated;
GRANT ALL ON public.inbox_items TO service_role;
ALTER TABLE public.inbox_items ENABLE ROW LEVEL SECURITY;

-- Role-aware policies, mirroring the existing leads/rfqs/tenders pattern:
-- readable by any authenticated user, writable by the sales team, editable
-- by the owner/creator or a commercial manager, deletable by managers only
-- (the app itself never calls delete — archive is the supported path; the
-- policy exists only for admin-level cleanup parity with sibling tables).
CREATE POLICY "Inbox items readable" ON public.inbox_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Inbox items insertable by sales team" ON public.inbox_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE POLICY "Inbox items editable by owner or manager" ON public.inbox_items FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_owner_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[])
  )
  WITH CHECK (
    created_by = auth.uid()
    OR assigned_owner_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[])
  );

CREATE POLICY "Inbox items deletable by manager" ON public.inbox_items FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_inbox_items_updated_at BEFORE UPDATE ON public.inbox_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_inbox_items_status ON public.inbox_items(status);
CREATE INDEX idx_inbox_items_classification ON public.inbox_items(classification);
CREATE INDEX idx_inbox_items_owner ON public.inbox_items(assigned_owner_id);
CREATE INDEX idx_inbox_items_source_type ON public.inbox_items(source_type);
