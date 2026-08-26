// =============================================================================
// Structured explanations — computed as facts, rendered in a language.
//
// THE DEFECT THIS REMOVES
// -----------------------
// Every metric caveat and every attention reason was an English sentence built
// inside the engine: `${unscored} open deals have no probability`. Arabic RTL
// worked perfectly and then rendered those sentences in English, so a manager
// on the Arabic UI got "No target has been set for this period" inside an
// otherwise Arabic card.
//
// Translating at the point of computation would have been worse: the engine
// would need a language, its tests would assert prose, and the same business
// rule would end up phrased twice with nothing keeping the two in step.
//
// So the engines now return WHAT IS TRUE and nothing about how to say it:
//
//     { key: "cav_probability_missing", params: { count: 48 } }
//
// and the UI turns that into a sentence. The rule lives in one place, the
// wording in another, and a test can assert the fact without asserting English.
//
// Translation files hold ONLY wording. A phrase like "48 open deals have no
// probability" is a template with a slot; it never decides WHICH deals count as
// unscored, or what the threshold is. If a translation ever needs to know a
// business rule to be written, the split has been drawn in the wrong place.
// =============================================================================

/** A fact plus its slots. Rendered by formatMessage, never by the producer. */
export type MessageRef = {
  key: string;
  params?: Record<string, string | number>;
};

export const msg = (key: string, params?: Record<string, string | number>): MessageRef => ({
  key,
  ...(params ? { params } : {}),
});

/**
 * Fill `{slot}` placeholders in a translated template.
 *
 * Numbers go through the caller's formatter so Arabic gets Arabic-Indic digits
 * and grouped thousands rather than a bare JS `String(n)` — the whole point of
 * doing this at the presentation layer.
 *
 * An unknown key returns the key itself rather than throwing or rendering an
 * empty card: a missing translation should be visible and reportable, not
 * silently blank.
 */
export function formatMessage(
  ref: MessageRef | undefined | null,
  t: (key: string) => string,
  formatValue: (v: string | number) => string = String,
): string | undefined {
  if (!ref) return undefined;
  const template = t(ref.key);
  if (!ref.params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, slot: string) => {
    const v = ref.params?.[slot];
    return v === undefined ? whole : formatValue(v);
  });
}
