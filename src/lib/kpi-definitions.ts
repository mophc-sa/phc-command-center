// Plain-language KPI definitions in both languages, keyed by Kpi.key.
//
// The engine's `formula` strings are English-only, so on the Arabic UI the one
// sentence that explains a number was the one sentence not in Arabic. KpiTile
// and the hand-built cards (KpiCard, TargetKpiBox) read from here so a
// headline number says the same thing wherever it appears.

type Def = { en: string; ar: string };

const WON: Def = {
  en: "Sum of deals at stage Won, placed in the period by their award date (won_at). Verbal award and contract stages are not counted.",
  ar: "مجموع قيمة الصفقات في مرحلة «رابحة»، موزّعة على الفترة حسب تاريخ الترسية. لا تُحتسب الترسية الشفهية ومراحل العقد.",
};

export const KPI_DEFINITIONS: Record<string, Def> = {
  won_value: WON,
  target_actual: WON,
  target: {
    en: "The sales target set for this period: the annual target when one exists, else the monthly targets.",
    ar: "المستهدف البيعي لهذه الفترة: المستهدف السنوي إن وُجد، وإلا المستهدفات الشهرية.",
  },
  target_achievement: {
    en: "Won value ÷ target. Verbal award and contract stages are not counted.",
    ar: "قيمة الصفقات الرابحة ÷ المستهدف. لا تُحتسب الترسية الشفهية ومراحل العقد.",
  },
  target_gap: {
    en: "Target minus won value, never below zero.",
    ar: "المستهدف ناقص قيمة الصفقات الرابحة، ولا يقل عن صفر.",
  },
  open_pipeline: {
    en: "Sum of deals that are neither won nor lost (on-hold included). A snapshot of now. Deals with no value recorded are counted, not added.",
    ar: "مجموع قيمة الصفقات غير الرابحة وغير الخاسرة (يشمل المعلّقة). لقطة للوضع الحالي. الصفقات بلا قيمة مسجّلة تُعدّ ولا تُجمع.",
  },
  weighted_pipeline: {
    en: "Σ open deal value × win probability (manager's, else AI). Deals with no probability are left out and reported, never assumed.",
    ar: "مجموع (قيمة الصفقة المفتوحة × احتمالية الفوز) — احتمالية المدير وإلا تقدير الذكاء الاصطناعي. الصفقات بلا احتمالية تُستبعد ويُذكر عددها.",
  },
  win_rate: {
    en: "Won ÷ (won + lost) in the period, by close date. Open deals are not in the denominator; — when nothing closed.",
    ar: "الرابحة ÷ (الرابحة + الخاسرة) في الفترة حسب تاريخ الإغلاق. الصفقات المفتوحة خارج المقام؛ «—» إذا لم يُغلق شيء.",
  },
  lost_value: {
    en: "Sum of deals at stage Lost, placed in the period by their close date (lost_at).",
    ar: "مجموع قيمة الصفقات الخاسرة، موزّعة على الفترة حسب تاريخ الإغلاق.",
  },
  late_stage_exposure: {
    en: "Value at verbal award, contract received and contract signed. Exposure, not revenue — these can still be lost.",
    ar: "القيمة في مراحل الترسية الشفهية واستلام العقد وتوقيعه. تعرّض وليس إيرادًا — قد تُخسر بعد.",
  },
  tier_a_open: {
    en: "Open Tier A deals and their value. Deals with no value recorded are counted, not added.",
    ar: "الصفقات المفتوحة من الفئة A وقيمتها. الصفقات بلا قيمة مسجّلة تُعدّ ولا تُجمع.",
  },
  quotation_value: {
    en: "Sum of quotation values with this status in the period. Quotations with no value are counted, not added.",
    ar: "مجموع قيم عروض الأسعار بهذه الحالة في الفترة. العروض بلا قيمة تُعدّ ولا تُجمع.",
  },
  quotation_win_rate: {
    en: "Won ÷ (won + lost) quotations among the records in scope; — when none closed.",
    ar: "العروض الفائزة ÷ (الفائزة + الخاسرة) ضمن السجلات المختارة؛ «—» إذا لم يُغلق أي عرض.",
  },
  conversion: {
    en: "Won ÷ (won + lost) deals in the target period, by close date; — when nothing closed.",
    ar: "الرابحة ÷ (الرابحة + الخاسرة) في فترة المستهدف حسب تاريخ الإغلاق؛ «—» إذا لم يُغلق شيء.",
  },
};

export const kpiDefinition = (key: string, lang: "en" | "ar"): string | undefined => KPI_DEFINITIONS[key]?.[lang];

/** "N without value" — the count a total leaves out. Empty when nothing is missing. */
export const unvaluedLabel = (n: number, lang: "en" | "ar"): string =>
  n > 0 ? (lang === "ar" ? `${n} قيمة غير مسجلة` : `${n} no value recorded`) : "";

// ---- Missing is not zero ------------------------------------------------------

export type ValueSum = { total: number; valued: number; unvalued: number };

/** Sum the recorded values and COUNT the rows that have none, instead of `?? 0`. */
export function sumRecorded<T>(rows: readonly T[], pick: (r: T) => number | string | null | undefined): ValueSum {
  let total = 0;
  let valued = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) continue;
    total += Number(v);
    valued += 1;
  }
  return { total, valued, unvalued: rows.length - valued };
}

/** "—" when nothing has a value — never a confident 0. */
export const totalOrDash = (s: ValueSum, fmt: (n: number) => string): string =>
  s.valued === 0 && s.unvalued > 0 ? "—" : fmt(s.total);
