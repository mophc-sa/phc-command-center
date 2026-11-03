-- =============================================================================
-- Pricing loop, part 1: one open pricing file per deal (spec 2026-11-03-pricing-loop-design).
--
-- The file carries one state for the deal's RFQ-to-quotation path, so the
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
  -- Final review I4: a note on a move out of a cost stage (supplier_priced,
  -- selling_build, price_review) is about cost or margin, so it lands here and
  -- is read through pricing_file_cost_notes only. `note` stays for everyone who
  -- reads the deal: the missing-items question and its answer are the rep's.
  cost_note   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_file_events_file ON public.pricing_file_events (file_id, created_at);

ALTER TABLE public.pricing_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_file_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pricing_files, public.pricing_file_events FROM anon, authenticated;
GRANT SELECT ON public.pricing_files TO authenticated;
-- Column grants: cost_note is not granted, so not granting it IS the revoke.
GRANT SELECT (id, file_id, from_state, to_state, actor_id, note, created_at)
  ON public.pricing_file_events TO authenticated;
GRANT ALL ON public.pricing_files, public.pricing_file_events TO service_role;

-- Whoever can read the deal can read where its price is; pricers read all.
DROP POLICY IF EXISTS "Pricing files readable with the deal" ON public.pricing_files;
CREATE POLICY "Pricing files readable with the deal" ON public.pricing_files FOR SELECT TO authenticated
  USING (public.is_pricer(auth.uid()) OR public.can_read_boq(opportunity_id, auth.uid()));
DROP POLICY IF EXISTS "Pricing file events readable with the file" ON public.pricing_file_events;
CREATE POLICY "Pricing file events readable with the file" ON public.pricing_file_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pricing_files f WHERE f.id = file_id
                 AND (public.is_pricer(auth.uid()) OR public.can_read_boq(f.opportunity_id, auth.uid()))));

-- Final review I4: cost notes for cost holders who can read the file, and
-- nobody else. Owner-run like supplier_quote_costs, so it reaches the column
-- the authenticated role is not granted; the gate is in the WHERE.
CREATE OR REPLACE VIEW public.pricing_file_cost_notes AS
  SELECT e.id, e.file_id, e.from_state, e.to_state, e.actor_id, e.cost_note, e.created_at
    FROM public.pricing_file_events e
    JOIN public.pricing_files f ON f.id = e.file_id
   WHERE e.cost_note IS NOT NULL
     AND public.can_read_commercial_cost((SELECT auth.uid()))
     AND (public.is_pricer((SELECT auth.uid())) OR public.can_read_boq(f.opportunity_id, (SELECT auth.uid())));
REVOKE ALL ON public.pricing_file_cost_notes FROM anon, authenticated;
GRANT SELECT ON public.pricing_file_cost_notes TO authenticated;

-- Opens (or returns) the deal's open file. Shared by the RPC and the RFQ trigger.
-- Final review M1: two openers racing on one deal (two RFQs saved at once, or
-- an RFQ and a pricer) both miss the SELECT; the loser's insert then skips the
-- conflict instead of raising, so the RFQ insert behind the trigger never
-- aborts, and it returns the winner's file. The ON CONFLICT predicate is the
-- partial unique index's, exactly (pricing_files_one_open_per_deal).
CREATE OR REPLACE FUNCTION public._pricing_file_open(_opportunity_id uuid, _rfq_id uuid, _actor uuid)
RETURNS public.pricing_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.pricing_files;
BEGIN
  SELECT * INTO f FROM public.pricing_files
   WHERE opportunity_id = _opportunity_id AND state <> 'closed' FOR UPDATE;
  IF FOUND THEN RETURN f; END IF;
  INSERT INTO public.pricing_files (opportunity_id, rfq_id, opened_by, state_changed_by)
  VALUES (_opportunity_id, _rfq_id, _actor, _actor)
  ON CONFLICT (opportunity_id) WHERE state <> 'closed' DO NOTHING
  RETURNING * INTO f;
  IF NOT FOUND THEN
    SELECT * INTO f FROM public.pricing_files
     WHERE opportunity_id = _opportunity_id AND state <> 'closed' FOR UPDATE;
    RETURN f;
  END IF;
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
-- Final review I3: the file also opens when an RFQ saved without a deal is
-- linked to one later (the intake-conversion path creates the RFQ first), or
-- is moved to another deal. A deal that already has an open file keeps it.
-- RFQs that existed before this migration are not backfilled: a pricer opens
-- their files by hand with open_pricing_file.
-- The placeholder RFQ the classification edit creates on a deal with none
-- (opportunity-collab-actions.ts, upsertClientDetails) opens a file too: it
-- carries no column or flag that tells it apart from a real RFQ saved with few
-- fields. Recorded as a PR 2 decision in AI_HANDOFF.
CREATE OR REPLACE FUNCTION public.pricing_file_on_rfq()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id THEN
    RETURN NEW;
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    PERFORM public._pricing_file_open(NEW.opportunity_id, NEW.id, NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pricing_file_on_rfq() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rfqs_open_pricing_file ON public.rfqs;
CREATE TRIGGER rfqs_open_pricing_file AFTER INSERT OR UPDATE OF opportunity_id ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.pricing_file_on_rfq();

COMMENT ON TABLE public.pricing_files IS
  'One open file per deal, for its RFQ-to-quotation path. State only, no money. Read with the deal; written through RPCs (pricing_file_*). Spec 2026-11-03-pricing-loop-design.';
