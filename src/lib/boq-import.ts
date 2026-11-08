// =============================================================================
// BOQ import for the pricing file: read a spreadsheet in the browser, find the
// header row, map columns to BOQ fields, and turn rows into the lines
// pricing_boq_import accepts. The database validates again; this gives Zayed
// the errors by spreadsheet row before he sends anything.
// No Arabic-Indic digit appears in this file (arabic-digits.test.ts): they are
// converted by code point.
// =============================================================================
import type { InstallType } from "@/lib/pricing";
import type { BoqImportLine } from "@/lib/pricing-actions";
import type { Bi } from "@/lib/pricing-text";

export const BOQ_FIELDS = [
  "sign_type", "description", "quantity", "unit", "dimensions", "material", "mounting", "illumination",
  "finish", "location", "install_type", "width_mm", "height_mm", "weight_kg", "mount_height_m",
  "has_screen", "needs_floor_cut",
] as const;
export type BoqField = (typeof BOQ_FIELDS)[number];
export type ColumnMapping = Partial<Record<BoqField, number>>;

export const BOQ_FIELD_LABEL: Record<BoqField, Bi> = {
  sign_type: { en: "Sign type", ar: "نوع اللوحة" },
  description: { en: "Description", ar: "الوصف" },
  quantity: { en: "Quantity", ar: "الكمية" },
  unit: { en: "Unit", ar: "الوحدة" },
  dimensions: { en: "Size", ar: "المقاس" },
  material: { en: "Material", ar: "الخامة" },
  mounting: { en: "Mounting", ar: "التثبيت" },
  illumination: { en: "Illumination", ar: "الإضاءة" },
  finish: { en: "Finish", ar: "التشطيب" },
  location: { en: "Location", ar: "الموقع" },
  install_type: { en: "Install type", ar: "نوع التركيب" },
  width_mm: { en: "Width (mm)", ar: "العرض (مم)" },
  height_mm: { en: "Height (mm)", ar: "الارتفاع (مم)" },
  weight_kg: { en: "Weight (kg)", ar: "الوزن (كغ)" },
  mount_height_m: { en: "Mount height (m)", ar: "ارتفاع التركيب (م)" },
  has_screen: { en: "Screen", ar: "شاشة" },
  needs_floor_cut: { en: "Floor cut", ar: "قص أرضية" },
};

/** Install types in rate-card order, with their labels (also used by Cost review and Settings). */
export const INSTALL_TYPES: readonly InstallType[] = ["double_tape", "wall_screw", "pylon", "ceiling", "floor"];
export const INSTALL_TYPE_LABEL: Record<InstallType, Bi> = {
  double_tape: { en: "Double tape", ar: "دبل تيب" },
  wall_screw: { en: "Screwed to wall", ar: "جدار بالبراغي" },
  pylon: { en: "Pylon", ar: "بايلون" },
  ceiling: { en: "Ceiling", ar: "سقف" },
  floor: { en: "Floor", ar: "أرض" },
};

const HINTS: Record<BoqField, string[]> = {
  sign_type: ["sign type", "sign", "type", "item", "code", "نوع اللوحة", "اللوحة", "البند", "النوع"],
  description: ["description", "desc", "details", "الوصف", "التفاصيل"],
  quantity: ["qty", "quantity", "count", "الكمية", "العدد"],
  unit: ["unit", "uom", "الوحدة"],
  dimensions: ["size", "dimension", "dimensions", "المقاس", "الأبعاد"],
  material: ["material", "المادة", "الخامة"],
  mounting: ["mounting", "fixing", "التثبيت"],
  illumination: ["illumination", "lighting", "light", "الإضاءة"],
  finish: ["finish", "colour", "color", "التشطيب", "اللون"],
  location: ["location", "area", "zone", "الموقع", "المكان"],
  install_type: ["install type", "installation type", "install", "installation", "نوع التركيب", "التركيب"],
  width_mm: ["width", "العرض"],
  height_mm: ["height", "الارتفاع"],
  weight_kg: ["weight", "الوزن"],
  mount_height_m: ["mount height", "mounting height", "installation height", "ارتفاع التركيب"],
  has_screen: ["screen", "display", "شاشة"],
  needs_floor_cut: ["floor cut", "cutting", "قص"],
};

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function score(cell: string, field: BoqField): number {
  let best = 0;
  for (const h of HINTS[field]) {
    if (cell === h) best = Math.max(best, 100 + h.length);
    else if (h.length >= 4 && cell.includes(h)) best = Math.max(best, h.length);
  }
  return best;
}

/** Each column goes to the field it matches best; each field takes one column. */
export function guessMapping(header: readonly unknown[]): ColumnMapping {
  const pairs: { field: BoqField; col: number; s: number }[] = [];
  header.map(norm).forEach((cell, col) => {
    if (!cell) return;
    for (const field of BOQ_FIELDS) {
      const s = score(cell, field);
      if (s > 0) pairs.push({ field, col, s });
    }
  });
  pairs.sort((a, b) => b.s - a.s || a.col - b.col);
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  for (const p of pairs) {
    if (mapping[p.field] !== undefined || taken.has(p.col)) continue;
    mapping[p.field] = p.col;
    taken.add(p.col);
  }
  return mapping;
}

/** The row among the first twenty that maps the most fields, sign type and quantity counting double. */
export function findHeaderRow(rows: readonly (readonly unknown[])[]): number {
  let best = 0;
  let bestScore = 0;
  rows.slice(0, 20).forEach((row, i) => {
    const m = guessMapping(row ?? []);
    const s = Object.keys(m).length + (m.sign_type !== undefined ? 1 : 0) + (m.quantity !== undefined ? 1 : 0);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}

/** Western digits from Arabic-Indic (U+0660–0669) and extended (U+06F0–06F9); U+066B is the decimal mark, U+066C is dropped, U+060C becomes a comma. */
function westernDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (c === 0x066b) out += ".";
    else if (c === 0x066c) continue;
    else if (c === 0x060c) out += ",";
    else out += ch;
  }
  return out;
}

export type NumberResult = { ok: true; value: number | null } | { ok: false; reason: "not_a_number" | "ambiguous" };

/**
 * A number from a cell. Empty is null. A comma followed by exactly three digits
 * (repeating) is a thousands separator; any other comma is ambiguous ("1,5" could
 * be 1.5 or 15) and is refused rather than guessed. Text after the number ("12 pcs") is ignored.
 */
export function parseNumberResult(v: unknown): NumberResult {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v === "number") return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, reason: "not_a_number" };
  const s = westernDigits(String(v)).trim();
  if (s === "") return { ok: true, value: null };
  const m = s.match(/^-?\d+(?:,\d+)*(?:\.\d+)?/);
  if (!m) return { ok: false, reason: "not_a_number" };
  const tok = m[0];
  if (tok.includes(",") && !/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(tok)) return { ok: false, reason: "ambiguous" };
  return { ok: true, value: Number(tok.replace(/,/g, "")) };
}

/** Like parseNumberResult, but a cell that is not a clean number is null. mapRows uses parseNumberResult so it can report them. */
export function parseNumber(v: unknown): number | null {
  const r = parseNumberResult(v);
  return r.ok ? r.value : null;
}

export function parseBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = norm(v);
  if (["yes", "y", "true", "1", "x", "نعم"].includes(s)) return true;
  if (["no", "n", "false", "0", "لا"].includes(s)) return false;
  return null;
}

const INSTALL_WORDS: [InstallType, string[]][] = [
  ["double_tape", ["double tape", "double-tape", "tape", "vhb", "دبل تيب", "لاصق"]],
  ["wall_screw", ["wall", "screw", "bolted", "براغي", "جدار", "حائط"]],
  ["pylon", ["pylon", "totem", "بايلون", "طوطم"]],
  ["ceiling", ["ceiling", "suspended", "hanging", "سقف", "معلق", "تعليق"]],
  ["floor", ["floor", "ground", "أرض"]],
];
export function parseInstallType(v: unknown): InstallType | null {
  const s = norm(v).replace(/_/g, " ");
  if (!s) return null;
  for (const [t, words] of INSTALL_WORDS) {
    if (s === t.replace("_", " ") || words.some((w) => s.includes(w))) return t;
  }
  return null;
}

/**
 * "1200 x 600 mm", "120x60cm", "1.2 × 0.6 m" → millimetres. With no unit the numbers are taken as
 * millimetres, and likelyMetres is set when both are under 20 so the caller can warn.
 */
export function parseDimensions(v: unknown): { width_mm: number; height_mm: number; likelyMetres?: true } | null {
  const s = westernDigits(String(v ?? "")).toLowerCase();
  const n = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?)";
  const m = s.match(new RegExp(`${n}\\s*[x×*]\\s*${n}`));
  if (!m) return null;
  const a = Number(m[1].replace(/,/g, ""));
  const b = Number(m[2].replace(/,/g, ""));
  const hasUnit = /mm|cm|\d\s*m\b|\sm\b/.test(s);
  const factor = /mm/.test(s) ? 1 : /cm/.test(s) ? 10 : /\d\s*m\b|\sm\b/.test(s) ? 1000 : 1;
  const out: { width_mm: number; height_mm: number; likelyMetres?: true } = {
    width_mm: Math.round(a * factor * 10) / 10,
    height_mm: Math.round(b * factor * 10) / 10,
  };
  if (!hasUnit && a < 20 && b < 20) out.likelyMetres = true;
  return out;
}

export type RowError = { row: number; message: Bi };

/** pricing_boq_import takes at most this many lines at a time. */
export const MAX_IMPORT_LINES = 2000;

/** The unit a sheet's mount-height column is in, and the unit its width/height columns are in. Chosen by the user, applied as stated. */
export type ImportUnits = { mountHeight: "m" | "mm"; size: "mm" | "cm" | "m" };
export const DEFAULT_UNITS: ImportUnits = { mountHeight: "m", size: "mm" };
const SIZE_FACTOR = { mm: 1, cm: 10, m: 1000 } as const;

/** A mount height above this many metres is shown as a warning: the column may be in millimetres. */
export const MOUNT_HEIGHT_WARN_ABOVE_M = 30;

/** Mount height in metres from a cell, in the stated unit. No guessing. */
export function parseMountHeightM(v: unknown, unit: "m" | "mm" = "m"): number | null {
  const n = parseNumber(v);
  if (n == null) return null;
  return Math.round((unit === "mm" ? n / 1000 : n) * 100) / 100;
}

/** The longest text pricing_boq_import accepts, per field. */
const TEXT_CAP: Partial<Record<BoqField, number>> = {
  sign_type: 120, description: 500, dimensions: 120, material: 120, mounting: 120,
  illumination: 120, finish: 120, location: 120, unit: 120,
};

/** Numeric columns, as pricing_boq_import's _pricing_boq_line_problem bounds them: decimals kept, must be above zero, exclusive upper bound. */
const NUM_RULE = {
  quantity: { scale: 3, positive: true, below: 1e11 },
  width_mm: { scale: 1, positive: true, below: 1e9 },
  height_mm: { scale: 1, positive: true, below: 1e9 },
  weight_kg: { scale: 2, positive: false, below: 1e8 },
  mount_height_m: { scale: 2, positive: false, below: 1e4 },
} as const;
type NumField = keyof typeof NUM_RULE;

const TOTAL_WORDS = ["total", "grand total", "subtotal", "المجموع", "الإجمالي"];

/** rows: the sheet as arrays; headerRow: 0-based; errors and warnings carry 1-based spreadsheet row numbers. */
export function mapRows(
  rows: readonly (readonly unknown[])[],
  headerRow: number,
  mapping: ColumnMapping,
  units: ImportUnits = DEFAULT_UNITS,
): { lines: BoqImportLine[]; errors: RowError[]; warnings: RowError[]; skipped: number } {
  const lines: BoqImportLine[] = [];
  const errors: RowError[] = [];
  const warnings: RowError[] = [];
  let skipped = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const cell = (f: BoqField) => (mapping[f] === undefined ? null : (r[mapping[f] as number] ?? null));
    const text = (f: BoqField) => {
      const v = cell(f);
      const s = v == null ? "" : String(v).trim();
      return s === "" ? null : s;
    };
    if (r.every((c) => c == null || String(c).trim() === "")) {
      skipped++;
      continue;
    }
    const sign = text("sign_type") ?? text("description");
    if (sign && TOTAL_WORDS.some((w) => norm(sign).startsWith(w))) {
      skipped++;
      continue;
    }
    const row = i + 1;
    const fail = (message: Bi) => errors.push({ row, message });
    const rowWarnings: RowError[] = [];
    const warn = (message: Bi) => rowWarnings.push({ row, message });
    if (!sign) {
      fail({ en: "No sign type or description", ar: "لا يوجد نوع لوحة أو وصف" });
      continue;
    }
    const tooLong = (Object.keys(TEXT_CAP) as BoqField[]).find((f) => (text(f)?.length ?? 0) > (TEXT_CAP[f] as number));
    if (tooLong) {
      const cap = TEXT_CAP[tooLong];
      fail({
        en: `${BOQ_FIELD_LABEL[tooLong].en} is longer than ${cap} characters`,
        ar: `${BOQ_FIELD_LABEL[tooLong].ar} أطول من ${cap} حرفاً`,
      });
      continue;
    }
    if (sign.length > (TEXT_CAP.sign_type as number)) {
      fail({
        en: `Sign type (the description is used when it is empty) is longer than ${TEXT_CAP.sign_type} characters`,
        ar: `نوع اللوحة (يُستخدم الوصف إن كان فارغاً) أطول من ${TEXT_CAP.sign_type} حرفاً`,
      });
      continue;
    }

    // Numbers: a cell that is not a number is an error, an empty cell is null.
    const prob: { v: Bi | null } = { v: null };
    const bad = (m: Bi) => { prob.v ??= m; };
    const num = (f: NumField, raw: unknown, scale = 1): number | null => {
      const rule = NUM_RULE[f];
      const label = BOQ_FIELD_LABEL[f];
      const p = parseNumberResult(raw);
      if (!p.ok) {
        bad(p.reason === "ambiguous"
          ? { en: `${label.en}: ambiguous number (comma). Use a point for decimals`, ar: `${label.ar}: رقم غامض (فاصلة). استخدم النقطة للكسور` }
          : { en: `${label.en} is not a number`, ar: `${label.ar} ليس رقماً` });
        return null;
      }
      if (p.value == null) return null;
      const k = 10 ** rule.scale;
      const v = Math.round(p.value * scale * k) / k;
      if (v < 0) bad({ en: `${label.en} cannot be negative`, ar: `${label.ar} لا يكون سالباً` });
      else if (rule.positive && v === 0) bad({ en: `${label.en} must be above zero`, ar: `${label.ar} يجب أن يكون أكبر من صفر` });
      else if (v >= rule.below) bad({ en: `${label.en} must be below ${rule.below}`, ar: `${label.ar} يجب أن يكون أقل من ${rule.below}` });
      return v;
    };

    const qty = num("quantity", cell("quantity"));
    if (qty == null) bad({ en: "Quantity missing or not above zero", ar: "الكمية غير موجودة أو ليست أكبر من صفر" });
    const sizeFactor = SIZE_FACTOR[units.size];
    const wCol = num("width_mm", cell("width_mm"), sizeFactor);
    const hCol = num("height_mm", cell("height_mm"), sizeFactor);
    const rawDims = text("dimensions");
    const dims = parseDimensions(rawDims);
    if (dims && (wCol == null || hCol == null)) {
      if (dims.likelyMetres) {
        warn({
          en: `Size "${rawDims}" has no unit and both numbers are under 20: read as millimetres. Check whether it is metres`,
          ar: `المقاس "${rawDims}" بلا وحدة ورقماه أقل من 20: قُرئ بالمليمتر. تحقق إن كان بالمتر`,
        });
      }
      const dimBad = (v: number) => v <= 0 || v >= NUM_RULE.width_mm.below;
      if (dimBad(dims.width_mm) || dimBad(dims.height_mm)) bad({ en: "Size is outside the accepted range", ar: "المقاس خارج المدى المقبول" });
    }
    const weight = num("weight_kg", cell("weight_kg"));
    const mountRaw = num("mount_height_m", cell("mount_height_m"), units.mountHeight === "mm" ? 0.001 : 1);
    if (mountRaw != null && mountRaw > MOUNT_HEIGHT_WARN_ABOVE_M && mountRaw < NUM_RULE.mount_height_m.below) {
      warn({
        en: `Mount height ${mountRaw} m: check, over ${MOUNT_HEIGHT_WARN_ABOVE_M} m. Is this column in millimetres?`,
        ar: `ارتفاع التركيب ${mountRaw} م: تحقق، أكثر من ${MOUNT_HEIGHT_WARN_ABOVE_M} م. هل العمود بالمليمتر؟`,
      });
    }
    if (prob.v) {
      fail(prob.v);
      continue;
    }

    const rawInstall = text("install_type");
    const install = parseInstallType(rawInstall);
    if (rawInstall && !install) {
      fail({ en: `Install type not recognised: ${rawInstall}`, ar: `نوع التركيب غير معروف: ${rawInstall}` });
      continue;
    }
    warnings.push(...rowWarnings);
    lines.push({
      sign_type: sign,
      description: text("description"),
      quantity: qty as number,
      unit: text("unit"),
      dimensions: rawDims,
      material: text("material"),
      mounting: text("mounting"),
      illumination: text("illumination"),
      finish: text("finish"),
      location: text("location"),
      install_type: install,
      width_mm: wCol ?? dims?.width_mm ?? null,
      height_mm: hCol ?? dims?.height_mm ?? null,
      weight_kg: weight,
      mount_height_m: mountRaw,
      has_screen: parseBool(cell("has_screen")) ?? false,
      needs_floor_cut: parseBool(cell("needs_floor_cut")) ?? false,
    });
  }
  return { lines, errors, warnings, skipped };
}

/** Every sheet as rows of cells. SheetJS is loaded on demand so it stays out of the main bundle. */
export async function readWorkbook(file: File): Promise<{ name: string; rows: unknown[][] }[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: null, raw: true }),
  }));
}
