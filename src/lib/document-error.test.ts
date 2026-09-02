import { describe, expect, it } from "bun:test";
import { docError } from "@/lib/document-error";

/** A `t` that behaves the way the real one does: unknown key in, key back out. */
const t = ((k: string) =>
  k === "doc_err_file_too_large" ? "File is larger than 25MB." : k) as unknown as (
  k: never,
) => string;

describe("what a failed upload tells the user", () => {
  it("uses the translation when there is one", () => {
    expect(docError(t, "file_too_large")).toBe("File is larger than 25MB.");
  });

  it("never shows the key glued to a database error", () => {
    // The exact string a BD Manager was shown on 2026-09-02.
    const raw = 'new row violates row-level security policy for table "documents"';
    const shown = docError(t, raw);
    expect(shown).toBe(raw);
    expect(shown).not.toContain("doc_err_");
  });

  it("does not treat a translated string that happens to differ as missing", () => {
    // Guards the comparison itself: it must compare against the KEY, not
    // against emptiness, or every real translation would look absent.
    expect(docError(t, "file_too_large")).not.toBe("file_too_large");
  });
});
