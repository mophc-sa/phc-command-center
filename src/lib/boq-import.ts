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

/** Western digits from Arabic-Indic (U+0660–0669) and extended (U+06F0–06F9); drops thousands separators. */
function westernDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (c === 0x066b) out += ".";
    else if (c === 0x066c || ch === ",") continue;
    else out += ch;
  }
  return out;
}

export function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = westernDigits(String(v)).trim().match(/^-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
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

/** "1200 x 600 mm", "120x60cm", "1.2 × 0.6 m" → millimetres. */
export function parseDimensions(v: unknown): { width_mm: number; height_mm: number } | null {
  const s = westernDigits(String(v ?? "")).toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const factor = /mm/.test(s) ? 1 : /cm/.test(s) ? 10 : /\d\s*m\b|\sm\b/.test(s) ? 1000 : 1;
  return { width_mm: Math.round(Number(m[1]) * factor * 10) / 10, height_mm: Math.round(Number(m[2]) * factor * 10) / 10 };
}

export type RowError = { row: number; message: Bi };

/** pricing_boq_import takes at most this many lines at a time. */
export const MAX_IMPORT_LINES = 2000;

/** A mounting height above this is taken to be millimetres (a sheet that says 2700 means 2.7 m). */
const MOUNT_HEIGHT_MM_ABOVE = 30;
export function parseMountHeightM(v: unknown): number | null {
  const n = parseNumber(v);
  if (n == null) return null;
  return Math.round((n > MOUNT_HEIGHT_MM_ABOVE ? n / 1000 : n) * 100) / 100;
}

/** The longest text pricing_boq_import accepts, per field. */
const TEXT_CAP: Partial<Record<BoqField, number>> = {
  sign_type: 120, description: 500, dimensions: 120, material: 120, mounting: 120,
  illumination: 120, finish: 120, location: 120, unit: 120,
};

const TOTAL_WORDS = ["total", "grand total", "subtotal", "المجموع", "الإجمالي"];

/** rows: the sheet as arrays; headerRow: 0-based; errors carry 1-based spreadsheet row numbers. */
export function mapRows(
  rows: readonly (readonly unknown[])[],
  headerRow: number,
  mapping: ColumnMapping,
): { lines: BoqImportLine[]; errors: RowError[]; skipped: number } {
  const lines: BoqImportLine[] = [];
  const errors: RowError[] = [];
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
    if (!sign) {
      errors.push({ row, message: { en: "No sign type or description", ar: "لا يوجد نوع لوحة أو وصف" } });
      continue;
    }
    const tooLong = (Object.keys(TEXT_CAP) as BoqField[]).find((f) => (text(f)?.length ?? 0) > (TEXT_CAP[f] as number));
    if (tooLong) {
      const cap = TEXT_CAP[tooLong];
      errors.push({
        row,
        message: {
          en: `${BOQ_FIELD_LABEL[tooLong].en} is longer than ${cap} characters`,
          ar: `${BOQ_FIELD_LABEL[tooLong].ar} أطول من ${cap} حرفاً`,
        },
      });
      continue;
    }
    const qty = parseNumber(cell("quantity"));
    if (qty == null || qty <= 0 || qty >= 1e11) {
      errors.push({ row, message: { en: "Quantity missing or not above zero", ar: "الكمية غير موجودة أو ليست أكبر من صفر" } });
      continue;
    }
    const rawInstall = text("install_type");
    const install = parseInstallType(rawInstall);
    if (rawInstall && !install) {
      errors.push({ row, message: { en: `Install type not recognised: ${rawInstall}`, ar: `نوع التركيب غير معروف: ${rawInstall}` } });
      continue;
    }
    const dims = parseDimensions(text("dimensions"));
    const positive = (n: number | null) => (n != null && n > 0 ? n : null);
    lines.push({
      sign_type: sign,
      description: text("description"),
      quantity: qty,
      unit: text("unit"),
      dimensions: text("dimensions"),
      material: text("material"),
      mounting: text("mounting"),
      illumination: text("illumination"),
      finish: text("finish"),
      location: text("location"),
      install_type: install,
      width_mm: positive(parseNumber(cell("width_mm"))) ?? dims?.width_mm ?? null,
      height_mm: positive(parseNumber(cell("height_mm"))) ?? dims?.height_mm ?? null,
      weight_kg: parseNumber(cell("weight_kg")),
      mount_height_m: parseMountHeightM(cell("mount_height_m")),
      has_screen: parseBool(cell("has_screen")) ?? false,
      needs_floor_cut: parseBool(cell("needs_floor_cut")) ?? false,
    });
  }
  return { lines, errors, skipped };
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
