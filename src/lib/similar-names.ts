// Warn before creating a likely duplicate (Omar's CRM review, point 11). Reuses
// the import pipeline's normaliser (AR + EN stopwords) and similarity score, so
// the create dialog and the importer agree on what "the same company" means.
import { normalizeCompanyName } from "../../supabase/functions/_shared/company-normalize";
import { similarity } from "../../supabase/functions/_shared/import-dedup";

/** Existing names that look like `value`, best match first. Exact matches included. */
export function similarNames(value: string, names: readonly string[], limit = 3): string[] {
  const v = normalizeCompanyName(value);
  if (v.length < 3) return [];
  return names
    .map((n) => ({ n, k: normalizeCompanyName(n) }))
    .map(({ n, k }) => ({ n, s: k && (k.includes(v) || v.includes(k)) ? Math.max(0.9, similarity(v, k)) : similarity(v, k) }))
    .filter((x) => x.s >= 0.8)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.n);
}
