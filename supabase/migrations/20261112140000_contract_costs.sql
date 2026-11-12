-- =============================================================================
-- Commercial & Finance part 2, B5: project costs and profit
-- (design docs/superpowers/specs/2026-11-12-contract-costs-design.md).
-- The approved price's cost becomes the contract's cost items (manufacturing,
-- installation, logistics, extras), with the accepted variations' too. Finance
-- records, per item, the supplier's or workshop's actual invoice, planned
-- payments and payments made. contract_profit gives management sold, cost,
-- collected, late, and the profit after a financing cost on late collection.
-- Cost is the cost readers' only, as in the pricing loop.
-- =============================================================================

-- 1. Settings finance owns.
CREATE TABLE IF NOT EXISTS public.finance_settings (
  key         text PRIMARY KEY CHECK (key IN ('late_financing_pct_month')),
  value       numeric NOT NULL CHECK (value >= 0 AND value <= 100),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.finance_settings (key, value) VALUES ('late_financing_pct_month', 1) ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance settings readable by cost readers" ON public.finance_settings;
CREATE POLICY "Finance settings readable by cost readers" ON public.finance_settings FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid())));
DROP POLICY IF EXISTS audit_session_boundary ON public.finance_settings;
CREATE POLICY audit_session_boundary ON public.finance_settings AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
REVOKE ALL ON public.finance_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_settings TO authenticated;
GRANT ALL ON public.finance_settings TO service_role;

CREATE OR REPLACE FUNCTION public.finance_setting_set(_key text, _value numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance sets this. | هذا الإعداد للمالية.' USING ERRCODE = '42501'; END IF;
  IF _key IS DISTINCT FROM 'late_financing_pct_month' OR _value IS NULL OR _value < 0 OR _value > 100 THEN
    RAISE EXCEPTION 'A known setting and a rate between 0 and 100. | إعداد معروف ونسبة بين 0 و100.' USING ERRCODE = '23514';
  END IF;
  UPDATE public.finance_settings SET value = _value, updated_by = u, updated_at = now() WHERE key = _key;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'finance_setting.set', 'finance_setting', NULL, jsonb_build_object('key', _key, 'value', _value));
  RETURN jsonb_build_object('key', _key, 'value', _value);
END $$;
REVOKE ALL ON FUNCTION public.finance_setting_set(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_setting_set(text, numeric) TO authenticated;

-- 2. Cost items and their entries.
CREATE TABLE IF NOT EXISTS public.contract_cost_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (category IN ('manufacturing','installation','logistics','extras','other')),
  source           text NOT NULL CHECK (source IN ('pricing','variation','manual')),
  source_file_id   uuid REFERENCES public.pricing_files(id) ON DELETE SET NULL,
  label            text CHECK (label IS NULL OR char_length(label) <= 200),
  planned_amount   numeric(16,2) NOT NULL CHECK (planned_amount >= 0),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- One pricing-sourced item per category and file.
CREATE UNIQUE INDEX IF NOT EXISTS contract_cost_items_from_file
  ON public.contract_cost_items (contract_id, source_file_id, category) WHERE source IN ('pricing','variation');

CREATE TABLE IF NOT EXISTS public.contract_cost_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES public.contract_cost_items(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('actual_cost','planned_payment','payment')),
  entry_on     date NOT NULL,
  amount       numeric(16,2) NOT NULL CHECK (amount > 0),
  reference    text CHECK (reference IS NULL OR char_length(reference) <= 200),
  note         text CHECK (note IS NULL OR char_length(note) <= 1000),
  recorded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  voided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason  text CHECK (void_reason IS NULL OR char_length(void_reason) <= 1000),
  CONSTRAINT contract_cost_entries_void_consistent CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract_cost_items','contract_cost_entries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s readable by cost readers of the contract" ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY "%s readable by cost readers of the contract" ON public.%I FOR SELECT TO authenticated
      USING (public.can_read_commercial_cost((SELECT auth.uid()))
             AND EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id
                          AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))))$p$, t, t);
    EXECUTE format('DROP POLICY IF EXISTS audit_session_boundary ON public.%I', t);
    EXECUTE format($p$CREATE POLICY audit_session_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())))$p$, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_guard', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.contract_children_guard()', t || '_guard', t);
  END LOOP;
END $$;

-- 3. Load the budget from pricing (the contract's file and its accepted variations).
-- pricing_selling_totals is cost-gated on the caller, so the caller must read cost
-- (finance does; the terms' approval runs as finance). Items with entries keep them.
CREATE OR REPLACE FUNCTION public._contract_costs_load(_contract_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.contracts; f record; t record; cat text; amt numeric; n int := 0;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  PERFORM set_config('contract.terms', c.id::text, true);
  FOR f IN
    SELECT qr.pricing_file_id AS file_id, 'pricing'::text AS source
      FROM public.quotation_revisions qr WHERE qr.id = c.quotation_revision_id AND qr.pricing_file_id IS NOT NULL
    UNION ALL
    SELECT pf.id, 'variation' FROM public.pricing_files pf
     WHERE pf.variation_contract_id = c.id AND pf.variation_accepted_at IS NOT NULL
  LOOP
    SELECT * INTO t FROM public.pricing_selling_totals WHERE file_id = f.file_id;
    CONTINUE WHEN NOT FOUND;
    FOREACH cat IN ARRAY ARRAY['manufacturing','installation','logistics','extras'] LOOP
      amt := CASE cat WHEN 'manufacturing' THEN t.materials_total WHEN 'installation' THEN t.installation_total
                      WHEN 'logistics' THEN t.logistics_total ELSE t.extras_total END;
      CONTINUE WHEN coalesce(amt, 0) = 0 AND NOT EXISTS (
        SELECT 1 FROM public.contract_cost_items WHERE contract_id = c.id AND source_file_id = f.file_id AND category = cat);
      INSERT INTO public.contract_cost_items (contract_id, category, source, source_file_id, planned_amount, created_by)
      VALUES (c.id, cat, f.source, f.file_id, round(coalesce(amt, 0), 2), auth.uid())
      ON CONFLICT (contract_id, source_file_id, category) WHERE source IN ('pricing','variation')
      DO UPDATE SET planned_amount = excluded.planned_amount, updated_at = now();
      n := n + 1;
    END LOOP;
  END LOOP;
  PERFORM set_config('contract.terms', '', true);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._contract_costs_load(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contract_costs_load(_contract_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts;
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance loads the budget. | تحميل الميزانية للمالية.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id;
  IF NOT FOUND OR c.terms_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'On an approved contract. | على عقد معتمد.' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._contract_costs_load(c.id);
END $$;
REVOKE ALL ON FUNCTION public.contract_costs_load(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_costs_load(uuid) TO authenticated;

-- Finance's approval of the terms loads the budget (the reviewer is finance, a cost reader).
CREATE OR REPLACE FUNCTION public._contract_costs_on_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.terms_status = 'approved' AND OLD.terms_status IS DISTINCT FROM 'approved' THEN
    PERFORM public._contract_costs_load(NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._contract_costs_on_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS contracts_costs_on_approval ON public.contracts;
CREATE TRIGGER contracts_costs_on_approval AFTER UPDATE OF terms_status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public._contract_costs_on_approval();

-- 4. Items by hand, entries, voids (finance).
CREATE OR REPLACE FUNCTION public.contract_cost_item_add(_contract_id uuid, _category text, _label text, _planned numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); c public.contracts; i uuid := gen_random_uuid();
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance adds cost items. | إضافة بنود التكلفة للمالية.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id;
  IF NOT FOUND OR c.terms_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'On an approved contract. | على عقد معتمد.' USING ERRCODE = 'P0001'; END IF;
  IF _category IS NULL OR _category NOT IN ('manufacturing','installation','logistics','extras','other')
     OR _planned IS NULL OR _planned < 0 OR nullif(btrim(_label), '') IS NULL THEN
    RAISE EXCEPTION 'A category, a label and a planned amount from 0. | فئة ووصف ومبلغ مخطط من صفر.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('contract.terms', c.id::text, true);
  INSERT INTO public.contract_cost_items (id, contract_id, category, source, label, planned_amount, created_by)
  VALUES (i, c.id, _category, 'manual', btrim(_label), round(_planned, 2), u);
  PERFORM set_config('contract.terms', '', true);
  RETURN i;
END $$;
REVOKE ALL ON FUNCTION public.contract_cost_item_add(uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_cost_item_add(uuid, text, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.contract_cost_entry_record(_item_id uuid, _kind text, _entry_on date, _amount numeric,
  _reference text, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); it public.contract_cost_items; e uuid := gen_random_uuid();
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance records costs and payments. | تسجيل التكاليف والمدفوعات للمالية.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO it FROM public.contract_cost_items WHERE id = _item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown cost item. | بند تكلفة غير موجود.' USING ERRCODE = '23514'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('actual_cost','planned_payment','payment') THEN
    RAISE EXCEPTION 'An invoice, a planned payment or a payment. | فاتورة أو دفعة مخططة أو دفعة.' USING ERRCODE = '23514';
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR _entry_on IS NULL OR (_kind <> 'planned_payment' AND _entry_on > current_date) THEN
    RAISE EXCEPTION 'An amount above zero, and a date up to today (a planned payment may be later). | مبلغ أكبر من صفر وتاريخ حتى اليوم (الدفعة المخططة قد تكون لاحقة).' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('contract.terms', it.contract_id::text, true);
  INSERT INTO public.contract_cost_entries (id, item_id, contract_id, kind, entry_on, amount, reference, note, recorded_by)
  VALUES (e, it.id, it.contract_id, _kind, _entry_on, round(_amount, 2), nullif(btrim(_reference), ''), nullif(btrim(_note), ''), u);
  PERFORM set_config('contract.terms', '', true);
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.contract_cost_entry_record(uuid, text, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_cost_entry_record(uuid, text, date, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.contract_cost_entry_void(_entry_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); en public.contract_cost_entries; r text := nullif(btrim(_reason), '');
BEGIN
  IF NOT public._is_finance_manager(u) THEN RAISE EXCEPTION 'Finance voids entries. | إلغاء القيود للمالية.' USING ERRCODE = '42501'; END IF;
  IF r IS NULL THEN RAISE EXCEPTION 'Say why. | اذكر السبب.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO en FROM public.contract_cost_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND OR en.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Unknown or already voided. | غير موجود أو ملغى.' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('contract.terms', en.contract_id::text, true);
  UPDATE public.contract_cost_entries SET voided_at = now(), voided_by = u, void_reason = r WHERE id = en.id;
  PERFORM set_config('contract.terms', '', true);
  RETURN jsonb_build_object('id', en.id, 'voided', true);
END $$;
REVOKE ALL ON FUNCTION public.contract_cost_entry_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_cost_entry_void(uuid, text) TO authenticated;

-- 5. The profit board: owner-run and gated on the caller (cost readers who can read the contract).
CREATE OR REPLACE VIEW public.contract_profit WITH (security_barrier = true) AS
WITH rate AS (SELECT coalesce((SELECT value FROM public.finance_settings WHERE key = 'late_financing_pct_month'), 0) / 100 AS r),
items AS (
  SELECT i.contract_id, i.id, i.planned_amount,
         (SELECT sum(e.amount) FROM public.contract_cost_entries e
           WHERE e.item_id = i.id AND e.kind = 'actual_cost' AND e.voided_at IS NULL) AS actual
    FROM public.contract_cost_items i),
fin AS (
  -- Financing cost: each invoice's outstanding (or late-paid) amount, from its due date to its
  -- payment (or today), at the monthly rate (30-day months).
  SELECT i.contract_id,
         sum(
           coalesce((SELECT sum(x.amount * greatest(0, x.received_on - i.due_on))
                       FROM public.contract_receipts x WHERE x.invoice_id = i.id AND x.voided_at IS NULL), 0)
           + greatest(0, i.total_incl_vat - coalesce((SELECT sum(x.amount) FROM public.contract_receipts x
                                                      WHERE x.invoice_id = i.id AND x.voided_at IS NULL), 0))
             * greatest(0, current_date - i.due_on)
         ) AS amount_days
    FROM public.contract_invoices i WHERE i.voided_at IS NULL GROUP BY i.contract_id)
SELECT c.id AS contract_id, c.opportunity_id, o.project_name, o.project_code,
       c.contract_value AS sold,
       ex.executed_value,
       coalesce(sum(it.planned_amount), 0)::numeric(16,2) AS planned_cost,
       coalesce(sum(coalesce(it.actual, it.planned_amount)), 0)::numeric(16,2) AS expected_cost,
       coalesce(sum(it.actual), 0)::numeric(16,2) AS actual_cost_recorded,
       (c.contract_value - coalesce(sum(it.planned_amount), 0))::numeric(16,2) AS gross_profit_planned,
       (coalesce(ex.executed_value, c.contract_value) - coalesce(sum(coalesce(it.actual, it.planned_amount)), 0))::numeric(16,2) AS gross_profit_expected,
       round(coalesce(max(fin.amount_days), 0) * (SELECT r FROM rate) / 30, 2)::numeric(16,2) AS financing_cost,
       (coalesce(ex.executed_value, c.contract_value) - coalesce(sum(coalesce(it.actual, it.planned_amount)), 0)
         - round(coalesce(max(fin.amount_days), 0) * (SELECT r FROM rate) / 30, 2))::numeric(16,2) AS net_profit,
       bs.received, bs.outstanding, bs.late_outstanding,
       (SELECT coalesce(sum(e.amount), 0) FROM public.contract_cost_entries e
         WHERE e.contract_id = c.id AND e.kind = 'payment' AND e.voided_at IS NULL)::numeric(16,2) AS cash_out_paid,
       (SELECT coalesce(sum(e.amount), 0) FROM public.contract_cost_entries e
         WHERE e.contract_id = c.id AND e.kind = 'planned_payment' AND e.voided_at IS NULL)::numeric(16,2) AS cash_out_planned
  FROM public.contracts c
  JOIN public.opportunities o ON o.id = c.opportunity_id
  LEFT JOIN items it ON it.contract_id = c.id
  LEFT JOIN fin ON fin.contract_id = c.id
  LEFT JOIN public.contract_execution_summary ex ON ex.contract_id = c.id
  LEFT JOIN public.contract_billing_summary bs ON bs.contract_id = c.id
 WHERE c.terms_status = 'approved'
   AND public.can_read_commercial_cost((SELECT auth.uid()))
   AND public.can_read_contract(c.opportunity_id, c.responsible_user_id, c.created_by, (SELECT auth.uid()))
 GROUP BY c.id, o.project_name, o.project_code, ex.executed_value, bs.received, bs.outstanding, bs.late_outstanding;
REVOKE ALL ON public.contract_profit FROM anon, authenticated;
GRANT SELECT ON public.contract_profit TO authenticated;
COMMENT ON VIEW public.contract_profit IS
  'B5: per approved contract, sold, executed value, planned and expected cost, gross profit, the financing cost of late collection (finance_settings.late_financing_pct_month a 30-day month, from each invoice''s due date to its payment or today) and net profit, collection and money out. Owner-run, gated on cost readers who can read the contract.';
