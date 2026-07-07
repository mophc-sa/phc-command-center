-- =========================================================
-- Sales OS extension: Quotations, BOQ Intelligence, Sales Targets
-- Derived from the PHC Sales OS plan (vault: 09 AI and Systems)
-- =========================================================

-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.quotation_status AS ENUM (
  'draft',
  'under_internal_review',
  'approved_for_submission',
  'submitted',
  'follow_up',
  'negotiation',
  'revised',
  'won',
  'lost',
  'expired'
);

CREATE TYPE public.boq_status AS ENUM (
  'verified',
  'partially_verified',
  'estimated_scope',
  'missing'
);

CREATE TYPE public.target_period AS ENUM ('monthly', 'quarterly');

-- =========================
-- BOQS
-- =========================
CREATE TABLE public.boqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  related_opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status public.boq_status NOT NULL DEFAULT 'missing',
  source TEXT,
  source_confidence public.confidence_level NOT NULL DEFAULT 'low',
  assumptions TEXT,
  missing_items TEXT,
  estimated_value NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  file_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boqs TO authenticated;
GRANT ALL ON public.boqs TO service_role;
ALTER TABLE public.boqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "BOQs readable" ON public.boqs FOR SELECT TO authenticated USING (true);
CREATE POLICY "BOQs editable by BD/Manager/CEO" ON public.boqs FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_boqs_updated_at BEFORE UPDATE ON public.boqs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- BOQ ITEMS
-- =========================
CREATE TABLE public.boq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_id UUID NOT NULL REFERENCES public.boqs(id) ON DELETE CASCADE,
  sign_type TEXT NOT NULL,
  size TEXT,
  material TEXT,
  quantity NUMERIC(12,2),
  location TEXT,
  mounting TEXT,
  illumination TEXT,
  finish TEXT,
  unit_rate NUMERIC(14,2),
  cost_estimate NUMERIC(14,2),
  selling_price NUMERIC(14,2),
  item_source TEXT,
  confidence public.confidence_level NOT NULL DEFAULT 'medium',
  sort_order INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boq_items TO authenticated;
GRANT ALL ON public.boq_items TO service_role;
ALTER TABLE public.boq_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "BOQ items readable" ON public.boq_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "BOQ items editable by BD/Manager/CEO" ON public.boq_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));

-- =========================
-- QUOTATIONS
-- =========================
CREATE TABLE public.quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT NOT NULL,
  related_opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  boq_id UUID REFERENCES public.boqs(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  value NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'SAR',
  version INT NOT NULL DEFAULT 1,
  status public.quotation_status NOT NULL DEFAULT 'draft',
  issued_date DATE,
  valid_until DATE,
  last_follow_up_at TIMESTAMPTZ,
  win_loss_reason TEXT,
  pdf_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quote_number, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations TO authenticated;
GRANT ALL ON public.quotations TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Quotations readable" ON public.quotations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Quotations insertable by BD/Manager/CEO" ON public.quotations FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Quotations updatable by owner or Manager/CEO" ON public.quotations FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Quotations deletable by Manager/CEO" ON public.quotations FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_quotations_updated_at BEFORE UPDATE ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- SALES TARGETS
-- Multi-dimensional targets per salesperson (not sales value only),
-- per the Sales OS plan: sales / pipeline / quotations / activities / reactivation.
-- =========================
CREATE TABLE public.sales_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_type public.target_period NOT NULL DEFAULT 'monthly',
  period_start DATE NOT NULL,
  sales_target NUMERIC(14,2) NOT NULL DEFAULT 0,
  pipeline_target NUMERIC(14,2) NOT NULL DEFAULT 0,
  quotation_target INT NOT NULL DEFAULT 0,
  activity_target INT NOT NULL DEFAULT 0,
  reactivation_target INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_type, period_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_targets TO authenticated;
GRANT ALL ON public.sales_targets TO service_role;
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;
-- Salespeople see their own targets; managers see everyone's.
CREATE POLICY "Targets readable by self or Manager/CEO" ON public.sales_targets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Targets managed by Manager/CEO" ON public.sales_targets FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_sales_targets_updated_at BEFORE UPDATE ON public.sales_targets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX idx_quotations_opp ON public.quotations(related_opportunity_id);
CREATE INDEX idx_quotations_status ON public.quotations(status);
CREATE INDEX idx_quotations_valid_until ON public.quotations(valid_until);
CREATE INDEX idx_boqs_opp ON public.boqs(related_opportunity_id);
CREATE INDEX idx_boqs_status ON public.boqs(status);
CREATE INDEX idx_boq_items_boq ON public.boq_items(boq_id);
CREATE INDEX idx_targets_user_period ON public.sales_targets(user_id, period_start);
