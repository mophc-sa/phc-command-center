-- =========================================================
-- PHC Sales OS — Phase E: AI recommendation layer (section 9)
--
-- Every AI recommendation is stored in the fixed 8-field shape:
-- Recommendation / Reason / Evidence / Data Sources / Confidence /
-- Risk Notes / Suggested Owner / Required Approval.
-- The AI only SUGGESTS — acting on a recommendation goes through the
-- Approval Center (section 11). There is no write path from AI to prices,
-- outreach, or deal closure.
-- =========================================================

CREATE TYPE public.recommendation_status AS ENUM (
  'pending',
  'accepted',    -- a human accepted it (usually spawns an approval request)
  'dismissed',
  'actioned'
);

CREATE TABLE public.recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_module TEXT NOT NULL,                 -- e.g. lead_qualification, boq_intelligence
  recommendation TEXT NOT NULL,
  reason TEXT,
  evidence TEXT,
  data_sources TEXT,
  confidence_score INT CHECK (confidence_score BETWEEN 0 AND 100),
  risk_notes TEXT,
  suggested_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  required_approval_type TEXT,                -- one of the 9 approval types, or null
  status public.recommendation_status NOT NULL DEFAULT 'pending',
  related_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE CASCADE,
  related_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  related_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendations TO authenticated;
GRANT ALL ON public.recommendations TO service_role;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recommendations readable" ON public.recommendations FOR SELECT TO authenticated USING (true);
-- Agents write via service_role (bypasses RLS); managers may also author.
CREATE POLICY "Recommendations insertable by BD/Manager" ON public.recommendations FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
-- The suggested owner or a manager can accept/dismiss a recommendation.
CREATE POLICY "Recommendations updatable by owner or manager" ON public.recommendations FOR UPDATE TO authenticated
  USING (suggested_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]))
  WITH CHECK (suggested_owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['bd_manager','sales_manager','ceo']::public.app_role[]));
CREATE POLICY "Recommendations deletable by manager" ON public.recommendations FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]));

CREATE TRIGGER trg_recommendations_updated_at BEFORE UPDATE ON public.recommendations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_recommendations_status ON public.recommendations(status);
CREATE INDEX idx_recommendations_opp ON public.recommendations(related_opportunity_id);
CREATE INDEX idx_recommendations_owner ON public.recommendations(suggested_owner_id);

-- =========================================================
-- Salespeople may REQUEST an approval (as pending, for themselves) — the
-- decision still belongs to a manager (existing manager FOR ALL policy).
-- =========================================================
CREATE POLICY "Approvals requestable by salesperson" ON public.approvals FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['salesperson']::public.app_role[])
    AND requested_by = auth.uid()
    AND status = 'pending'
  );
