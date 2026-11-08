// Bilingual text for the pricing screens. Each component keeps its own
// `const TEXT = { ... } satisfies Record<string, Bi>` and shows it with pick().
import type { Lang } from "@/lib/i18n";

export type Bi = { en: string; ar: string };

export const pick = (b: Bi, lang: Lang): string => b[lang];

function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** The database raises 'English. | العربية.'; show the reader's half. */
export function dbMessage(e: unknown, lang: Lang): string {
  const raw = rawMessage(e);
  const i = raw.indexOf(" | ");
  if (i < 0) return raw;
  return lang === "ar" ? raw.slice(i + 3).trim() : raw.slice(0, i).trim();
}

/** For ActionDialog onSubmit: rethrow so the dialog stays open and shows the message. */
export const asError = (e: unknown, lang: Lang): Error => new Error(dbMessage(e, lang));

const DRAFT_ERROR = {
  not_a_number: { en: "Enter a number.", ar: "أدخل رقماً." },
  ambiguous: { en: "Comma is unclear (1,5 may mean 1.5 or 15). Use a dot for decimals and no comma, or exactly three digits after a thousands comma.", ar: "الفاصلة غير واضحة (1,5 قد تعني 1.5 أو 15). استعمل النقطة للكسور، ولا فاصلة إلا لآلاف بثلاث خانات بعدها." },
  range: { en: "Value is out of the allowed range.", ar: "القيمة خارج المدى المسموح." },
  not_integer: { en: "Enter a whole number.", ar: "أدخل عدداً صحيحاً." },
} satisfies Record<string, Bi>;

/** What to tell the reader when a typed number is refused (see pricing-input.ts). */
export function draftError(
  reason: keyof typeof DRAFT_ERROR,
  lang: Lang,
  rules?: { min?: number; above?: number; max?: number; below?: number },
): string {
  if (reason !== "range" || !rules) return DRAFT_ERROR[reason][lang];
  const lo = rules.above != null ? { en: `above ${rules.above}`, ar: `أكبر من ${rules.above}` }
    : rules.min != null ? { en: `at least ${rules.min}`, ar: `${rules.min} على الأقل` } : null;
  const hi = rules.below != null ? { en: `below ${rules.below}`, ar: `أقل من ${rules.below}` }
    : rules.max != null ? { en: `at most ${rules.max}`, ar: `${rules.max} على الأكثر` } : null;
  if (!lo && !hi) return DRAFT_ERROR.range[lang];
  const en = [lo?.en, hi?.en].filter(Boolean).join(" and ");
  const ar = [lo?.ar, hi?.ar].filter(Boolean).join(" و");
  return lang === "ar" ? `القيمة يجب أن تكون ${ar}.` : `The value must be ${en}.`;
}
