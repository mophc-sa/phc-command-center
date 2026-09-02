/**
 * The message a failed file operation should show.
 *
 * `t()` returns the KEY when it has no entry for one, and a key is a non-empty
 * string — so the original `t(`doc_err_${code}`) || code` never reached its
 * fallback. On 2026-09-02 a user who hit an RLS refusal was shown, literally:
 *
 *     doc_err_new row violates row-level security policy for table "documents"
 *
 * A translation key glued to a Postgres error is worse than either half alone:
 * the key makes it look like a system code, and the Postgres half makes it look
 * like the user did something wrong.
 *
 * Comparing the result against the key is how you ask `t()` whether it actually
 * knew the string. Where it did not, the raw text goes through unprefixed — it
 * is at least true, and it is what the original code meant to do.
 */
export function docError(t: (k: never) => string, code: string): string {
  const key = `doc_err_${code}`;
  const translated = t(key as never);
  return translated === key ? code : translated;
}
