-- =============================================================================
-- Pricing loop, part 3: what a price is built from (meeting 2026-11-03, rec. 74–76).
--
-- Installation is one rate per sign TYPE, not per sign ("they all go up with
-- double tape"), with modifiers for weight, height, floor cutting and
-- scaffold/crane. The rate is what PHC pays the installer; selling adds margin.
-- Extras (civil works, acoustic, lifting) come from a catalog and are
-- suggested from the install type so none is missed silently.
-- Logistics defaults change with freight prices, so they are a table.
-- All of it is cost: readable and writable by pricers and cost holders only.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.install_type AS ENUM ('double_tape','wall_screw','pylon','ceiling','floor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.pricing_extra_unit AS ENUM ('lump','item','m2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.installation_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  install_type        public.install_type NOT NULL,
  base_rate           numeric(14,2) NOT NULL CHECK (base_rate >= 0),
  per_kg_over         numeric(14,2) NOT NULL DEFAULT 0 CHECK (per_kg_over >= 0),
  weight_threshold_kg numeric(10,2),
  per_m_over          numeric(14,2) NOT NULL DEFAULT 0 CHECK (per_m_over >= 0),
  height_threshold_m  numeric(6,2),
  floor_cut_add       numeric(14,2) NOT NULL DEFAULT 0 CHECK (floor_cut_add >= 0),
  scaffold_add        numeric(14,2) NOT NULL DEFAULT 0 CHECK (scaffold_add >= 0),
  crane_add           numeric(14,2) NOT NULL DEFAULT 0 CHECK (crane_add >= 0),
  currency            text NOT NULL DEFAULT 'SAR',
  effective_from      date NOT NULL DEFAULT current_date,
  effective_to        date,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_rates_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
-- One rate per type in force on any day.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.installation_rates DROP CONSTRAINT IF EXISTS installation_rates_no_overlap;
ALTER TABLE public.installation_rates ADD CONSTRAINT installation_rates_no_overlap
  EXCLUDE USING gist (install_type WITH =, daterange(effective_from, effective_to, '[)') WITH &&);

CREATE TABLE IF NOT EXISTS public.pricing_extras_catalog (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]{2,40}$'),
  name_en              text NOT NULL,
  name_ar              text NOT NULL,
  unit                 public.pricing_extra_unit NOT NULL,
  default_rate         numeric(14,2) NOT NULL DEFAULT 0 CHECK (default_rate >= 0),
  suggest_for          public.install_type[] NOT NULL DEFAULT '{}',
  suggest_min_height_m numeric(6,2),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logistics_rates (
  key        text PRIMARY KEY CHECK (key IN ('container_rate','customs_pct','clearing_fee','delivery_jeddah','delivery_riyadh')),
  value      numeric(14,4) NOT NULL CHECK (value >= 0),
  currency   text NOT NULL DEFAULT 'SAR',
  note       text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Seeds from the meeting (rec. 74 [16:56]). Unclear figures are marked in the
-- note; Ahmed confirms them in the settings screen (PR 2).
INSERT INTO public.logistics_rates (key, value, currency, note) VALUES
  ('container_rate', 12000, 'SAR', 'Meeting 74: 12,000 per container from China, currency unstated — confirm'),
  ('customs_pct',    5,     'SAR', 'Meeting 74: about 5% of goods value (unclear) — confirm'),
  ('clearing_fee',   500,   'SAR', 'Meeting 74: clearing agent fee'),
  ('delivery_jeddah',2000,  'SAR', 'Meeting 74: delivery inside Jeddah'),
  ('delivery_riyadh',5000,  'SAR', 'Meeting 74: Jeddah to Riyadh warehouse')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.logistics_rates_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_by := auth.uid(); NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS logistics_rates_stamp ON public.logistics_rates;
CREATE TRIGGER logistics_rates_stamp BEFORE UPDATE ON public.logistics_rates
  FOR EACH ROW EXECUTE FUNCTION public.logistics_rates_stamp();

ALTER TABLE public.installation_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_extras_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.installation_rates, public.pricing_extras_catalog, public.logistics_rates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.installation_rates, public.pricing_extras_catalog TO authenticated;
GRANT SELECT, UPDATE ON public.logistics_rates TO authenticated;
GRANT ALL ON public.installation_rates, public.pricing_extras_catalog, public.logistics_rates TO service_role;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['installation_rates','pricing_extras_catalog','logistics_rates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Cost holders read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Cost holders read %1$s" ON public.%1$I FOR SELECT TO authenticated
                    USING (public.can_read_commercial_cost(auth.uid()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Pricers write %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Pricers write %1$s" ON public.%1$I FOR UPDATE TO authenticated
                    USING (public.is_pricer(auth.uid())) WITH CHECK (public.is_pricer(auth.uid()))', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "Pricers add installation rates" ON public.installation_rates;
CREATE POLICY "Pricers add installation rates" ON public.installation_rates FOR INSERT TO authenticated
  WITH CHECK (public.is_pricer(auth.uid()));
DROP POLICY IF EXISTS "Pricers add catalog extras" ON public.pricing_extras_catalog;
CREATE POLICY "Pricers add catalog extras" ON public.pricing_extras_catalog FOR INSERT TO authenticated
  WITH CHECK (public.is_pricer(auth.uid()));

-- Structured line attributes: what installation and the later AI need.
-- material / illumination / dimensions stay as the existing text columns.
ALTER TABLE public.boq_lines
  ADD COLUMN IF NOT EXISTS install_type    public.install_type,
  ADD COLUMN IF NOT EXISTS width_mm        numeric(10,1) CHECK (width_mm IS NULL OR width_mm > 0),
  ADD COLUMN IF NOT EXISTS height_mm       numeric(10,1) CHECK (height_mm IS NULL OR height_mm > 0),
  ADD COLUMN IF NOT EXISTS weight_kg       numeric(10,2) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  ADD COLUMN IF NOT EXISTS mount_height_m  numeric(6,2)  CHECK (mount_height_m IS NULL OR mount_height_m >= 0),
  ADD COLUMN IF NOT EXISTS has_screen      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_floor_cut boolean NOT NULL DEFAULT false;
-- boq_lines uses COLUMN-level SELECT grants (Phase 7A, "a cost column added
-- later is NOT granted by default"). These are not cost, so grant them by name.
GRANT SELECT (install_type, width_mm, height_mm, weight_kg, mount_height_m, has_screen, needs_floor_cut)
  ON public.boq_lines TO authenticated;

-- The supplier's "with screen" price (meeting 73 [01:17]) is cost like unit_cost.
-- supplier_quote_lines uses COLUMN-level SELECT grants (Phase 7B §6), so a new
-- column is unreadable by default: not granting it IS the revoke. "Differs
-- from spec" already exists as alternate_spec.
ALTER TABLE public.supplier_quote_lines
  ADD COLUMN IF NOT EXISTS unit_cost_with_screen numeric(14,2) CHECK (unit_cost_with_screen IS NULL OR unit_cost_with_screen >= 0);
