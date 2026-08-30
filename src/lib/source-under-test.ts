// =============================================================================
// Read a file's CODE, not its prose.
//
// Several suites here assert on source text — that a guard still throws
// nothing, that no component hand-rolls a label, that a component uses no
// mirrored operator. Every one of them has the same failure mode, and it has
// now bitten three times in a single day:
//
//   · authenticated-guard.contract.test.ts matched `throw redirect(` inside the
//     comment explaining why `throw redirect(` was removed.
//   · type-system.contract.test.ts matched `<OutletImpl>` inside React's diff,
//     quoted in a comment.
//   · pipeline-composition.contract.test.ts matched "<1%" inside the comment
//     recording that "<1%" was the wrong choice.
//
// The pattern is not carelessness. It is structural: a well-commented fix
// **quotes the thing it removed**, so the better the explanation, the more
// likely a naive grep fails on it. The test then reports a defect that does not
// exist, and the obvious repair — deleting the quotation from the comment — is
// exactly backwards.
//
// So: strip first, assert second. Always.
// =============================================================================

import { readFileSync } from "node:fs";

/**
 * Block and line comments removed, everything else left alone.
 *
 * Deliberately naive — it does not parse strings, so a `//` inside a string
 * literal would be cut. That has not mattered for any assertion here and the
 * alternative is a parser; if a suite ever needs one, it should say so rather
 * than quietly getting this wrong.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The file as written, and the same file with its prose removed. */
export function readSource(path: string): { raw: string; code: string } {
  const raw = readFileSync(path, "utf8");
  return { raw, code: stripComments(raw) };
}
