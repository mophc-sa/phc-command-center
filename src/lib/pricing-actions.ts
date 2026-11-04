// RPC wrappers and reads for the pricing loop. Authorization is in SQL; these
// only call it and throw what the database says (the bilingual message is on
// error.message; show it with dbMessage()). Reads go through an untyped view of
// the client because these tables and views are newer than the generated
// Database types (same pattern as ai-actions.ts). Never select "*": several
// sources have column grants and answer 42501 to a star.
import { supabase } from "@/integrations/supabase/client";
import type { InstallType, PricingState } from "@/lib/pricing";
import { NO_RIGHTS, type PricingRights } from "@/lib/pricing-access";

const db = supabase as unknown as { from: (t: string) => any };

async function call<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

async function one<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? null) as T | null;
}

// ---- PR 1 (unchanged) --------------------------------------------------------

/** Opens the deal's pricing file, or returns the one that is already open. */
export const openPricingFile = (opportunityId: string, rfqId?: string | null) =>
  call<{ id: string }>("open_pricing_file", { _opportunity_id: opportunityId, _rfq_id: rfqId ?? null });

/** Moves the file; the database checks the move against pricing_file_transitions. Closing and sending lines back need a note. */
export const movePricingFile = (fileId: string, to: PricingState, note?: string) =>
  call("pricing_file_move", { _file_id: fileId, _to: to, _note: note ?? null });

/** Package review -> needs_info. `due` is a date, YYYY-MM-DD, from today on. */
export const askNeedsInfo = (fileId: string, items: string[], due: string) =>
  call("pricing_file_set_needs_info", { _file_id: fileId, _items: items, _due: due });

export const answerNeedsInfo = (fileId: string, note: string) =>
  call("pricing_file_answer_needs_info", { _file_id: fileId, _note: note });

/** Returns how many new suggestions were added. */
export const suggestExtras = (fileId: string) => call<number>("pricing_suggest_extras", { _file_id: fileId });

/** Accept (optionally with a different quantity or rate) or dismiss with a reason. */
export const decideExtra = (
  extraId: string,
  accept: boolean,
  opts: { quantity?: number; rate?: number; reason?: string } = {},
) =>
  call("pricing_decide_extra", {
    _extra_id: extraId,
    _accept: accept,
    _quantity: opts.quantity ?? null,
    _rate: opts.rate ?? null,
    _reason: opts.reason ?? null,
  });

// ---- Rights, queue, file -------------------------------------------------------

// A named type, not an inline generic with nested angle brackets: the contract test reads each call with one level of them.
type RightsRow = Partial<PricingRights>;
export async function getPricingRights(): Promise<PricingRights> {
  return { ...NO_RIGHTS, ...(await call<RightsRow>("pricing_my_rights", {})) };
}

export type QueueRow = {
  file_id: string;
  state: PricingState;
  state_changed_at: string;
  created_at: string;
  due_at: string | null;
  needs_info_items: string[];
  needs_info_due: string | null;
  opportunity_id: string;
  project_name: string | null;
  project_code: string | null;
  owner_id: string | null;
  contract_value: number | null;
  quotation_value: number | null;
  estimated_value_max: number | null;
  boq_revision_id: string | null;
  estimation_id: string | null;
  internal_price_id: string | null;
  closed_reason: string | null;
};
const QUEUE_COLUMNS =
  "file_id, state, state_changed_at, created_at, due_at, needs_info_items, needs_info_due, opportunity_id, project_name, project_code, owner_id, contract_value, quotation_value, estimated_value_max, boq_revision_id, estimation_id, internal_price_id, closed_reason";

export const listPricingQueue = () =>
  rows<QueueRow>(db.from("pricing_queue").select(QUEUE_COLUMNS).neq("state", "closed").order("state_changed_at", { ascending: true }).limit(500));

export const getPricingFile = (fileId: string) =>
  one<QueueRow>(db.from("pricing_queue").select(QUEUE_COLUMNS).eq("file_id", fileId).maybeSingle());

export type FileEvent = {
  id: string;
  file_id: string;
  from_state: PricingState | null;
  to_state: PricingState;
  actor_id: string | null;
  note: string | null;
  created_at: string;
};
// cost_note is not granted: listing the columns is what keeps this read legal.
export const listFileEvents = (fileId: string) =>
  rows<FileEvent>(db.from("pricing_file_events").select("id, file_id, from_state, to_state, actor_id, note, created_at").eq("file_id", fileId).order("created_at", { ascending: false }));

export type CostNote = { id: string; to_state: PricingState; cost_note: string; created_at: string };
export const listCostNotes = (fileId: string) =>
  rows<CostNote>(db.from("pricing_file_cost_notes").select("id, to_state, cost_note, created_at").eq("file_id", fileId).order("created_at", { ascending: false }));

// ---- Package: revisions and lines ----------------------------------------------

export type BoqRevisionRow = {
  id: string;
  revision_number: number;
  status: string;
  frozen_at: string | null;
  is_current: boolean;
  superseded_by: string | null;
  source_type: string;
  created_at: string;
};
export const listDealRevisions = (opportunityId: string) =>
  rows<BoqRevisionRow>(
    db
      .from("boq_revisions")
      .select("id, revision_number, status, frozen_at, is_current, superseded_by, source_type, created_at, boqs!inner(related_opportunity_id)")
      .eq("boqs.related_opportunity_id", opportunityId)
      .order("revision_number", { ascending: false }),
  );

export type BoqLineRow = {
  id: string;
  revision_id: string;
  line_number: number | null;
  sign_type: string;
  description: string | null;
  dimensions: string | null;
  material: string | null;
  location: string | null;
  quantity: number;
  unit: string | null;
  install_type: InstallType | null;
  width_mm: number | null;
  height_mm: number | null;
  weight_kg: number | null;
  mount_height_m: number | null;
  has_screen: boolean;
  needs_floor_cut: boolean;
};
// unit_price / line_total are cost and not granted; never add them here.
const LINE_COLUMNS =
  "id, revision_id, line_number, sign_type, description, dimensions, material, location, quantity, unit, install_type, width_mm, height_mm, weight_kg, mount_height_m, has_screen, needs_floor_cut";
export const listBoqLines = (revisionId: string) =>
  rows<BoqLineRow>(db.from("boq_lines").select(LINE_COLUMNS).eq("revision_id", revisionId).order("line_number", { ascending: true, nullsFirst: false }));

/** One line as pricing_boq_import takes it. */
export type BoqImportLine = {
  sign_type: string;
  quantity: number;
  description?: string | null;
  unit?: string | null;
  dimensions?: string | null;
  material?: string | null;
  mounting?: string | null;
  illumination?: string | null;
  finish?: string | null;
  location?: string | null;
  install_type?: InstallType | null;
  width_mm?: number | null;
  height_mm?: number | null;
  weight_kg?: number | null;
  mount_height_m?: number | null;
  has_screen?: boolean;
  needs_floor_cut?: boolean;
};
export const attachRevision = (fileId: string, revisionId: string) =>
  call("pricing_file_attach_revision", { _file_id: fileId, _revision_id: revisionId });
/** A spreadsheet import replaces the draft's lines (`replace` true); a typed line is appended (false, the default). */
export const importBoqLines = (fileId: string, lines: BoqImportLine[], replace = false) =>
  call<{ revision_id: string; revision_number: number; inserted: number }>("pricing_boq_import", {
    _file_id: fileId,
    _lines: lines,
    _replace: replace,
  });
export const deleteBoqLine = (fileId: string, lineId: string) =>
  call<null>("pricing_boq_line_delete", { _file_id: fileId, _line_id: lineId });
export const freezeBoq = (fileId: string, status: "verified" | "partially_verified", note: string) =>
  call("pricing_file_freeze_boq", { _file_id: fileId, _status: status, _note: note });

// ---- Supplier and cost --------------------------------------------------------

export type SupplierCostRow = {
  id: string;
  boq_line_id: string;
  vendor_id: string;
  vendor_name: string;
  status: string;
  is_current: boolean;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  alternate_spec: string | null;
  lead_time_days: number | null;
  /** Only SAR quotes are priced; the grid does not convert. */
  currency: string;
};
export const listSupplierCosts = (revisionId: string) =>
  rows<SupplierCostRow>(
    db
      .from("supplier_quote_costs")
      .select("id, boq_line_id, vendor_id, vendor_name, status, is_current, unit_cost, unit_cost_with_screen, alternate_spec, lead_time_days, currency")
      .eq("boq_revision_id", revisionId)
      .eq("is_current", true),
  );

// ---- Selling price ----------------------------------------------------------

export type FileInputs = {
  file_id: string;
  is_cinema: boolean;
  containers: number;
  delivery: "none" | "jeddah" | "riyadh";
  clearing: boolean;
  overhead_pct: number;
  default_margin_pct: number | null;
};
export const getFileInputs = (fileId: string) =>
  one<FileInputs>(db.from("pricing_file_inputs").select("file_id, is_cinema, containers, delivery, clearing, overhead_pct, default_margin_pct").eq("file_id", fileId).maybeSingle());
export const setFileInputs = (fileId: string, inputs: Partial<Omit<FileInputs, "file_id">>) =>
  call<FileInputs>("pricing_file_set_inputs", { _file_id: fileId, _inputs: inputs });

export type GridRow = {
  file_id: string;
  boq_line_id: string;
  line_number: number | null;
  sign_type: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  has_screen: boolean;
  supplier_quote_line_id: string | null;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  alternate_spec: string | null;
  quotes_count: number;
  use_screen_price: boolean;
  install_type: InstallType | null;
  install_basis: "rate" | "fallback";
  materials: number | null;
  installation: number;
  extras_alloc: number;
  logistics_alloc: number;
  line_cost: number;
  line_margin_pct: number | null;
  typed_selling_price: number | null;
  /** The file's own default margin, else the global one; null when neither is set. */
  default_margin_pct: number | null;
  overhead_pct: number;
  selling_price: number | null;
  margin_pct: number | null;
  extras_total: number;
  logistics_total: number;
  built_cost: number | null;
  built_selling_price: number | null;
  /** No supplier price in SAR, or no typed price and no margin source. */
  unpriced: boolean;
  /** The chosen supplier quote is not in SAR; the line is unpriced (no conversion). */
  currency_mismatch: boolean;
  screen_price_missing: boolean;
};
const GRID_COLUMNS =
  "file_id, boq_line_id, line_number, sign_type, description, quantity, unit, has_screen, supplier_quote_line_id, unit_cost, unit_cost_with_screen, alternate_spec, quotes_count, use_screen_price, install_type, install_basis, materials, installation, extras_alloc, logistics_alloc, line_cost, line_margin_pct, typed_selling_price, default_margin_pct, overhead_pct, selling_price, margin_pct, extras_total, logistics_total, built_cost, built_selling_price, unpriced, currency_mismatch, screen_price_missing";
export const listSellingGrid = (fileId: string) =>
  rows<GridRow>(db.from("pricing_selling_grid").select(GRID_COLUMNS).eq("file_id", fileId).order("line_number", { ascending: true, nullsFirst: false }));

export type TotalsRow = {
  file_id: string;
  line_count: number;
  unpriced_lines: number;
  non_sar_lines: number;
  multi_quote_lines: number;
  screen_price_missing_lines: number;
  materials_total: number;
  installation_total: number;
  extras_total: number;
  logistics_total: number;
  overhead_pct: number;
  total_cost: number;
  total_selling: number | null;
  margin_value: number | null;
  /** null while any line is unpriced. */
  margin_pct: number | null;
  floor_pct: number | null;
  /** null while any line is unpriced. */
  below_floor: boolean | null;
};
export const getSellingTotals = (fileId: string) =>
  one<TotalsRow>(
    db
      .from("pricing_selling_totals")
      .select("file_id, line_count, unpriced_lines, non_sar_lines, multi_quote_lines, screen_price_missing_lines, materials_total, installation_total, extras_total, logistics_total, overhead_pct, total_cost, total_selling, margin_value, margin_pct, floor_pct, below_floor")
      .eq("file_id", fileId)
      .maybeSingle(),
  );

/** Cost keys (pricer or GM) and selling keys (GM). null clears a choice. */
export type LineChoice = {
  use_screen_price?: boolean | null;
  install_type?: InstallType | null;
  margin_pct?: number | null;
  selling_price?: number | null;
};
export const setLineChoice = (fileId: string, boqLineId: string, choice: LineChoice) =>
  call("pricing_file_set_line", { _file_id: fileId, _boq_line_id: boqLineId, _choice: choice });

export type CatalogRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  unit: "lump" | "item" | "m2";
  default_rate: number;
  suggest_for: InstallType[];
  suggest_min_height_m: number | null;
  suggest_if_cinema: boolean;
  active: boolean;
  effective_from: string;
};
const CATALOG_COLUMNS = "id, code, name_en, name_ar, unit, default_rate, suggest_for, suggest_min_height_m, suggest_if_cinema, active, effective_from";
export const listCatalog = () => rows<CatalogRow>(db.from("pricing_extras_catalog").select(CATALOG_COLUMNS).order("name_en"));

export type FileExtraRow = {
  id: string;
  catalog_id: string;
  quantity: number;
  rate: number;
  status: "suggested" | "accepted" | "dismissed";
  dismiss_reason: string | null;
  source_line_id: string | null;
  boq_revision_id: string;
  catalog: { code: string; name_en: string; name_ar: string; unit: CatalogRow["unit"] } | null;
};
export const listFileExtras = (fileId: string, revisionId: string) =>
  rows<FileExtraRow>(
    db
      .from("pricing_file_extras")
      .select("id, catalog_id, quantity, rate, status, dismiss_reason, source_line_id, boq_revision_id, catalog:pricing_extras_catalog(code, name_en, name_ar, unit)")
      .eq("file_id", fileId)
      .eq("boq_revision_id", revisionId)
      .order("created_at"),
  );
/** What Propose is blocked on: undecided rows of this round plus expected extras with no row yet. */
export const countOpenSuggestions = (fileId: string) => call<number>("pricing_file_open_suggestions", { _file_id: fileId });
export const addExtra = (fileId: string, catalogId: string, quantity: number, rate?: number | null) =>
  call("pricing_add_extra", { _file_id: fileId, _catalog_id: catalogId, _quantity: quantity, _rate: rate ?? null });

export type BuildResult = {
  internal_price_id: string;
  estimation_id: string;
  total_cost: number;
  total_selling: number;
  margin_pct: number | null;
  floor_pct: number | null;
  below_floor: boolean;
};
export const buildPrice = (fileId: string) => call<BuildResult>("pricing_file_build_price", { _file_id: fileId });
/** expectedTotal and expectedTotalCost are the totals the GM was shown; the server refuses either if stale. */
export const proposePrice = (fileId: string, expectedTotal: number, expectedTotalCost: number, justification?: string) =>
  call("pricing_file_propose", { _file_id: fileId, _expected_total: expectedTotal, _expected_total_cost: expectedTotalCost, _justification: justification ?? null });

export type PriceSummary = {
  id: string;
  status: string;
  proposed_price: number | null;
  margin_value: number | null;
  margin_percentage: number | null;
  proposed_by: string | null;
  proposed_at: string | null;
  return_reason: string | null;
};
export const getPriceSummary = (priceId: string) =>
  one<PriceSummary>(db.from("internal_price_summary").select("id, status, proposed_price, margin_value, margin_percentage, proposed_by, proposed_at, return_reason").eq("id", priceId).maybeSingle());

// ---- Settings -----------------------------------------------------------------

export type InstallationRateRow = {
  id: string;
  install_type: InstallType;
  base_rate: number;
  per_kg_over: number;
  weight_threshold_kg: number | null;
  per_m_over: number;
  height_threshold_m: number | null;
  floor_cut_add: number;
  scaffold_add: number;
  crane_add: number;
  effective_from: string;
  effective_to: string | null;
};
export const listInstallationRates = () =>
  rows<InstallationRateRow>(
    db
      .from("installation_rates")
      .select("id, install_type, base_rate, per_kg_over, weight_threshold_kg, per_m_over, height_threshold_m, floor_cut_add, scaffold_add, crane_add, effective_from, effective_to")
      .order("install_type")
      .order("effective_from", { ascending: false }),
  );
export type RateInput = Omit<InstallationRateRow, "id" | "effective_to">;
export const setInstallationRate = (r: RateInput) =>
  call("pricing_set_installation_rate", {
    _type: r.install_type,
    _from: r.effective_from,
    _base_rate: r.base_rate,
    _per_kg_over: r.per_kg_over,
    _weight_threshold_kg: r.weight_threshold_kg,
    _per_m_over: r.per_m_over,
    _height_threshold_m: r.height_threshold_m,
    _floor_cut_add: r.floor_cut_add,
    _scaffold_add: r.scaffold_add,
    _crane_add: r.crane_add,
  });

export type LogisticsRateKey =
  | "container_rate" | "customs_pct" | "clearing_fee" | "delivery_jeddah" | "delivery_riyadh"
  | "install_fallback_pct" | "default_margin_pct";
export type LogisticsRateRow = { key: LogisticsRateKey; value: number; currency: string; note: string | null; effective_from: string; updated_at: string };
export const listLogisticsRates = () =>
  rows<LogisticsRateRow>(db.from("logistics_rates").select("key, value, currency, note, effective_from, updated_at").order("key"));
export async function updateLogisticsRate(key: LogisticsRateKey, value: number, note: string | null): Promise<void> {
  const { error } = await db.from("logistics_rates").update({ value, note }).eq("key", key);
  if (error) throw error;
}

export type CatalogInput = Omit<CatalogRow, "id" | "effective_from">;
export async function saveCatalogItem(id: string | null, item: CatalogInput): Promise<void> {
  const { error } = id
    ? await db.from("pricing_extras_catalog").update(item).eq("id", id)
    : await db.from("pricing_extras_catalog").insert(item);
  if (error) throw error;
}

export type MarginFloorRow = { id: string; min_margin_pct: number; effective_from: string; rationale: string | null };
export async function getMarginFloor(): Promise<MarginFloorRow | null> {
  const list = await rows<MarginFloorRow>(
    db.from("margin_policies").select("id, min_margin_pct, effective_from, effective_to, rationale").is("effective_to", null).order("effective_from", { ascending: false }).limit(1),
  );
  return list[0] ?? null;
}
export const setMarginFloor = (pct: number, rationale: string) =>
  call("pricing_set_margin_floor", { _min_margin_pct: pct, _rationale: rationale });
