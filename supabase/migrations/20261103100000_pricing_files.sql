-- =============================================================================
-- Pricing loop, part 1: one pricing file per RFQ (spec 2026-11-03-pricing-loop-design).
--
-- The file carries one state for the whole RFQ-to-quotation path, so the
-- estimation queue, the deal page and the GM all read the same answer to
-- "where is this price and who owes the next step". It holds no money: cost
-- lives in the Phase 7A–8 tables it points at, behind their own gates.
-- Writes go through RPCs only; the state machine is in the next migration.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.pricing_file_state AS ENUM (
    'received','package_review','needs_info','boq_frozen','at_supplier',
    'supplier_priced','selling_build','price_review',
    'approved','quoted','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estimation and finance are one person today (Ahmed Zayed, DECISIONS
-- 2026-08); the predicate admits either role so the split stays possible.
CREATE OR REPLACE FUNCTION public.is_pricer(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL
     AND public.has_app_access(_user_id)
     AND (public.has_role(_user_id, 'estimation_manager'::public.app_role)
          OR public.has_role(_user_id, 'finance_manager'::public.app_role));
$$;
REVOKE ALL ON FUNCTION public.is_pricer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_pricer(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.pricing_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id    uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  rfq_id            uuid REFERENCES public.rfqs(id) ON DELETE SET NULL,
  state             public.pricing_file_state NOT NULL DEFAULT 'received',
  boq_revision_id   uuid REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  estimation_id     uuid REFERENCES public.estimations(id) ON DELETE RESTRICT,
  internal_price_id uuid REFERENCES public.internal_prices(id) ON DELETE RESTRICT,
  due_at            date,
  needs_info_items  text[] NOT NULL DEFAULT '{}',
  needs_info_due    date,
  closed_reason     text,
  opened_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  state_changed_at  timestamptz NOT NULL DEFAULT now(),
  state_changed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT pricing_files_closed_has_reason CHECK (state <> 'closed' OR closed_reason IS NOT NULL)
);
-- One open file per deal: a client revision reuses the file, it does not fork it.
CREATE UNIQUE INDEX IF NOT EXISTS pricing_files_one_open_per_deal
  ON public.pricing_files (opportunity_id) WHERE state <> 'closed';
CREATE INDEX IF NOT EXISTS pricing_files_state ON public.pricing_files (state, state_changed_at);

CREATE TABLE IF NOT EXISTS public.pricing_file_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  from_state  public.pricing_file_state,
  to_state    public.pricing_file_state NOT NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_file_events_file ON public.pricing_file_events (file_id, created_at);

ALTER TABLE public.pricing_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_file_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_files, public.pricing_file_events FROM anon, authenticated;
GRANT SELECT ON public.pricing_files, public.pricing_file_events TO authenticated;
GRANT ALL ON public.pricing_files, public.pricing_file_events TO service_role;

-- Whoever can read the deal can read where its price is; pricers read all.
DROP POLICY IF EXISTS "Pricing files readable with the deal" ON public.pricing_files;
CREATE POLICY "Pricing files readable with the deal" ON public.pricing_files FOR SELECT TO authenticated
  USING (public.is_pricer(auth.uid()) OR public.can_read_boq(opportunity_id, auth.uid()));
DROP POLICY IF EXISTS "Pricing file events readable with the file" ON public.pricing_file_events;
CREATE POLICY "Pricing file events readable with the file" ON public.pricing_file_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pricing_files f WHERE f.id = file_id
                 AND (public.is_pricer(auth.uid()) OR public.can_read_boq(f.opportunity_id, auth.uid()))));

-- Opens (or returns) the deal's open file. Shared by the RPC and the RFQ trigger.
CREATE OR REPLACE FUNCTION public._pricing_file_open(_opportunity_id uuid, _rfq_id uuid, _actor uuid)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files;
BEGIN
  SELECT * INTO f FROM public.pricing_files
   WHERE opportunity_id = _opportunity_id AND state <> 'closed' FOR UPDATE;
  IF FOUND THEN RETURN f; END IF;
  INSERT INTO public.pricing_files (opportunity_id, rfq_id, opened_by, state_changed_by)
  VALUES (_opportunity_id, _rfq_id, _actor, _actor) RETURNING * INTO f;
  INSERT INTO public.pricing_file_events (file_id, from_state, to_state, actor_id, note)
  VALUES (f.id, NULL, 'received', _actor, CASE WHEN _actor IS NULL THEN 'Opened with the RFQ' END);
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (_actor, CASE WHEN _actor IS NULL THEN 'system' ELSE 'user' END, 'pricing_file.opened',
          'opportunity', _opportunity_id, jsonb_build_object('file_id', f.id, 'rfq_id', _rfq_id));
  RETURN f;
END $$;
REVOKE ALL ON FUNCTION public._pricing_file_open(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.open_pricing_file(_opportunity_id uuid, _rfq_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files;
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance may open a pricing file. | فتح ملف التسعير يقتصر على التقدير أو المالية.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id = _opportunity_id) THEN
    RAISE EXCEPTION 'Unknown deal. | الفرصة غير موجودة.' USING ERRCODE = '23514';
  END IF;
  f := public._pricing_file_open(_opportunity_id, _rfq_id, u);
  RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION public.open_pricing_file(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_pricing_file(uuid, uuid) TO authenticated;

-- An RFQ that belongs to a deal starts its price. RFQs without a deal wait
-- for one: a BOQ (boqs.related_opportunity_id NOT NULL) cannot exist without it.
CREATE OR REPLACE FUNCTION public.pricing_file_on_rfq()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.opportunity_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    PERFORM public._pricing_file_open(NEW.opportunity_id, NEW.id, NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_on_rfq() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rfqs_open_pricing_file ON public.rfqs;
CREATE TRIGGER rfqs_open_pricing_file AFTER INSERT ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_on_rfq();

COMMENT ON TABLE public.pricing_files IS
  'One per RFQ-to-quotation path. State only, no money. Read with the deal; written through RPCs (pricing_file_*). Spec 2026-11-03-pricing-loop-design.';
