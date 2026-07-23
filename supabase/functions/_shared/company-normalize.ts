// =============================================================================
// Company-name normalization — single source of truth for both the Data
// Import Pipeline (_shared/import-dedup.ts) and the general Duplicate
// Detection Engine (_shared/duplicates.ts). Previously duplicated with a
// silent capability gap: only this version folds Arabic script variants.
// =============================================================================

// Arabic entries are stored in their POST-normalizeArabic form, because
// normalizeCompanyName() normalizes each token before checking membership here.
const COMPANY_STOPWORDS = new Set([
  "co", "company", "llc", "ltd", "limited", "est", "establishment", "corp",
  "corporation", "trading", "contracting", "contractors", "group", "and", "the", "for",
  "شركه", "موسسه", "مقاولات", "التجاريه", "المحدوده", "القابضه", "مجموعه",
]);

// Strip Arabic diacritics/tatweel and unify letter forms so "شركة الراجحي"
// variants collapse to a common key.
export function normalizeArabic(v: string): string {
  return v
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, "") // tashkeel
    .replace(/ـ/g, "") // tatweel
    .replace(/[آأإٱ]/g, "ا") // alef variants -> ا
    .replace(/ى/g, "ي") // alef maqsura -> ي
    .replace(/ة/g, "ه") // taa marbuta -> ه
    .replace(/ؤ/g, "و") // waw hamza -> و
    .replace(/[ءئ]/g, ""); // stray hamza
}

export function normalizeCompanyName(v: string | null | undefined): string {
  if (!v) return "";
  return normalizeArabic(String(v).toLowerCase())
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !COMPANY_STOPWORDS.has(w))
    .join(" ")
    .trim();
}
