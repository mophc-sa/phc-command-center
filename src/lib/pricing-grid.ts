// =============================================================================
// Pure mirror of public.pricing_selling_grid / pricing_selling_totals
// (20261104140000). The database computes every figure the screens show; this
// exists so the arithmetic is unit-tested in TypeScript and held to the SQL by
// pricing-grid.contract.test.ts. Margin is on price (Phase 8).
// =============================================================================

/** Half away from zero to 2 decimals, like SQL round(numeric, 2). */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

export type LogisticsRates = {
  container_rate: number;
  customs_pct: number;
  clearing_fee: number;
  delivery_jeddah: number;
  delivery_riyadh: number;
};
export type LogisticsInputs = { containers: number; delivery: "none" | "jeddah" | "riyadh"; clearing: boolean };

export function logisticsTotal(i: LogisticsInputs, r: LogisticsRates, goodsValue: number): number {
  const delivery = i.delivery === "jeddah" ? r.delivery_jeddah : i.delivery === "riyadh" ? r.delivery_riyadh : 0;
  return round2(i.containers * r.container_rate + (goodsValue * r.customs_pct) / 100 + (i.clearing ? r.clearing_fee : 0) + delivery);
}

export function shares(values: number[]): number[] {
  if (values.length === 0) return [];
  const total = values.reduce((a, b) => a + b, 0);
  return total > 0 ? values.map((v) => v / total) : values.map(() => 1 / values.length);
}

/** null (no price) for a margin of 100 or more, as in SQL, and for -100 or less, which the line's check constraint refuses; never throws, so a render path cannot crash on a typed value. */
export function sellingFromMargin(cost: number, marginPctOnPrice: number): number | null {
  if (!(marginPctOnPrice > -100 && marginPctOnPrice < 100)) return null;
  return round2(cost / (1 - marginPctOnPrice / 100));
}

export function marginPct(selling: number, cost: number): number | null {
  return selling > 0 ? round2(((selling - cost) / selling) * 100) : null;
}

/** estimation_cost_basis on the estimation pricing_file_build_price writes (wastage 0). */
export function fileTotalCost(t: { materials: number; extras: number; logistics: number; installation: number; overheadPct: number }): number {
  const subtotal = t.materials + t.extras + t.logistics + t.installation;
  return round2(subtotal + (subtotal * t.overheadPct) / 100);
}

export type GridLineInput = {
  quantity: number;
  /** The chosen supplier unit price (normal or with screen); null = no supplier price. */
  unitMaterial: number | null;
  /** pricing_installation_cost for the line's type; null = no rate in force. */
  unitInstall: number | null;
  marginPct: number | null;
  typedSelling: number | null;
  /** The chosen supplier quote is not in SAR: no conversion, so the line is unpriced (unitMaterial must be null). */
  currencyMismatch?: boolean;
};
export type FileInput = {
  fallbackPct: number;
  /** The file's own default margin, else the global one; null when neither is set. */
  defaultMarginPct: number | null;
  overheadPct: number;
  /** Accepted extras of the current round, already rounded. */
  extrasTotal: number;
  logistics: LogisticsInputs;
  rates: LogisticsRates;
  /** current_margin_floor(); null when no floor is in force. */
  floorPct?: number | null;
};
export type PricedLine = {
  materials: number | null;
  installation: number;
  installBasis: "rate" | "fallback";
  extrasAlloc: number;
  logisticsAlloc: number;
  lineCost: number;
  selling: number | null;
  marginPct: number | null;
  /** No supplier price in SAR, or no margin source (line, file, global) and no typed price. */
  unpriced: boolean;
  currencyMismatch: boolean;
};
export type FileTotals = {
  materialsTotal: number;
  installationTotal: number;
  extrasTotal: number;
  logisticsTotal: number;
  totalCost: number;
  totalSelling: number | null;
  /** null while any line is unpriced: a margin over part of the file is not a final margin. */
  marginPct: number | null;
  /** null while any line is unpriced. */
  belowFloor: boolean | null;
  unpricedLines: number;
  nonSarLines: number;
};

export function priceFile(lines: GridLineInput[], file: FileInput): { lines: PricedLine[]; totals: FileTotals } {
  const base = lines.map((l) => {
    const materials = l.unitMaterial == null ? null : round2(l.unitMaterial * l.quantity);
    const installation =
      l.unitInstall != null
        ? round2(l.unitInstall * l.quantity)
        : round2(((l.unitMaterial ?? 0) * l.quantity * file.fallbackPct) / 100);
    return { materials, installation, installBasis: (l.unitInstall != null ? "rate" : "fallback") as PricedLine["installBasis"] };
  });
  const goods = base.reduce((a, b) => a + (b.materials ?? 0), 0);
  const logistics = logisticsTotal(file.logistics, file.rates, goods);
  const sh = shares(base.map((b) => (b.materials ?? 0) + b.installation));
  const priced: PricedLine[] = base.map((b, i) => {
    const l = lines[i];
    const raw = ((b.materials ?? 0) + b.installation + sh[i] * file.extrasTotal + sh[i] * logistics) * (1 + file.overheadPct / 100);
    const m = l.marginPct ?? file.defaultMarginPct;
    // The grid's CASE: a typed price wins, then no supplier price, then no margin source, then a margin of 100 or more.
    const selling =
      l.typedSelling != null ? l.typedSelling : l.unitMaterial == null || m == null || m >= 100 ? null : sellingFromMargin(raw, m);
    return {
      ...b,
      extrasAlloc: round2(sh[i] * file.extrasTotal),
      logisticsAlloc: round2(sh[i] * logistics),
      lineCost: round2(raw),
      selling,
      marginPct: selling != null && selling > 0 ? round2(((selling - raw) / selling) * 100) : null,
      unpriced: l.unitMaterial == null || (l.typedSelling == null && m == null),
      currencyMismatch: l.currencyMismatch === true,
    };
  });
  const materialsTotal = round2(priced.reduce((a, p) => a + (p.materials ?? 0), 0));
  const installationTotal = round2(priced.reduce((a, p) => a + p.installation, 0));
  const totalCost = fileTotalCost({ materials: materialsTotal, extras: file.extrasTotal, logistics, installation: installationTotal, overheadPct: file.overheadPct });
  const sold = priced.filter((p) => p.selling != null);
  const totalSelling = sold.length ? round2(sold.reduce((a, p) => a + (p.selling ?? 0), 0)) : null;
  const unpricedLines = priced.filter((p) => p.unpriced).length;
  const fileMargin = totalSelling != null ? marginPct(totalSelling, totalCost) : null;
  const floor = file.floorPct ?? null;
  return {
    lines: priced,
    totals: {
      materialsTotal,
      installationTotal,
      extrasTotal: file.extrasTotal,
      logisticsTotal: logistics,
      totalCost,
      totalSelling,
      marginPct: unpricedLines === 0 ? fileMargin : null,
      belowFloor: unpricedLines === 0 ? fileMargin != null && floor != null && fileMargin < floor : null,
      unpricedLines,
      nonSarLines: priced.filter((p) => p.currencyMismatch).length,
    },
  };
}
