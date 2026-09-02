// =============================================================================
// Typing a phone number into the entry form.
//
// Reported 2026-09-02: "when entering a phone number the +966 country code
// should already be there, and the rep completes it."
//
// Almost every number in this business is Saudi, and typing +966 twenty times a
// day is twenty chances to type +96 or 9966. Pre-filling it removes the work
// AND the error class.
//
// What it must NOT do is trap a foreign number. A rep who pastes a UAE or
// Egyptian number has to be able to, so anything that arrives already carrying
// its own country code -- a leading + or 00 -- keeps it.
//
// Validation is deliberately NOT reimplemented here. `normalizePhone` in
// whatsapp-templates.ts already decides what counts as a real Saudi number, it
// is already tested, and it is what the WhatsApp link uses. A second opinion on
// the same question is a bug waiting for the day the two disagree.
// =============================================================================

import { normalizePhone, sanitizePhone } from "@/lib/whatsapp-templates";

export const SAUDI_PREFIX = "+966";

/**
 * What to store, given whatever the user typed into a +966-prefixed box.
 *
 * The prefix is a default, not a cage: the rules below are ordered so that a
 * number carrying its own country code always wins over the assumption.
 */
export function composePhone(typed: string): string {
  const trimmed = (typed ?? "").trim();
  if (trimmed === "") return "";

  // An explicit international number, typed or pasted. Left alone.
  if (trimmed.startsWith("+")) return `+${sanitizePhone(trimmed)}`;

  const digits = sanitizePhone(trimmed);
  if (digits === "") return "";

  // 00 is the other way people write "+".
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  // Already carries 966, with or without a plus.
  if (digits.startsWith("966")) return `+${digits}`;
  // The Saudi trunk zero: 05XXXXXXXX. The 0 does not survive the country code.
  if (digits.startsWith("0")) return `${SAUDI_PREFIX}${digits.slice(1)}`;
  return `${SAUDI_PREFIX}${digits}`;
}

/**
 * The part the user edits — what is left once the prefix is stripped off.
 *
 * A stored number that is NOT Saudi is shown whole, prefix and all, because
 * hiding a +971 behind a box labelled +966 would be a lie about the record.
 */
export function localPart(stored: string): { text: string; showsPrefix: boolean } {
  const s = (stored ?? "").trim();
  if (s === "") return { text: "", showsPrefix: true };
  if (s.startsWith(SAUDI_PREFIX)) return { text: s.slice(SAUDI_PREFIX.length), showsPrefix: true };
  return { text: s, showsPrefix: false };
}

/** Whether a composed number is one this system would actually dial. */
export function isUsablePhone(stored: string): boolean {
  return normalizePhone(stored).valid;
}
