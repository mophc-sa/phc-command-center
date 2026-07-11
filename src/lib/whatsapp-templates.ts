// WhatsApp click-to-chat helpers for the Communication Hub Phase 1 flow.
//
// Pure functions only — no side effects, no network, no Supabase, no window.
// Consumers render the message inside WhatsAppComposeModal, and call
// buildWaMeUrl(...) when the user clicks "Open WhatsApp".
//
// Phase 1 constraints:
//   - no WhatsApp Business API, no webhook, no automatic sending
//   - never mark a message as sent automatically
//   - open wa.me with a prefilled message only; the user sends manually
//     from their own WhatsApp app/Web

export type TemplateVars = Record<string, string | null | undefined>;

// Replaces {{var}} tokens. Unknown/empty vars are removed (not left as
// literal "{{var}}" in the outgoing message).
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const v = vars[key];
    return v ? String(v).trim() : "";
  });
}

// wa.me requires digits only, in full international format (no +, spaces,
// dashes, parentheses, and no local trunk prefix). We only strip formatting
// — we do not guess or inject a country code for numbers we can't recognise,
// since guessing wrong is worse than leaving it to the user to enter a full
// number. Kept for any caller that just wants raw digits with no KSA logic.
export function sanitizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/[^\d]/g, "");
}

const SAUDI_COUNTRY_CODE = "966";

export type PhoneNormalizationResult = {
  // Final digits to use in the wa.me link. Empty string if invalid.
  digits: string;
  valid: boolean;
  // True when a Saudi local-format number (0-prefixed or bare 9-digit
  // mobile) was auto-converted to international format, so the UI can show
  // a "converted to international format" note.
  wasLocalSaudiFormat: boolean;
};

// PHC KSA Phase-1 phone handling — recognises the handful of formats sales
// actually types for a Saudi mobile number and converts them to the single
// international format wa.me requires. Anything else (already-international
// non-Saudi numbers, etc.) passes through unchanged as long as it's long
// enough to plausibly be a real number; anything too short is invalid.
export function normalizePhone(phone: string | null | undefined): PhoneNormalizationResult {
  const raw = sanitizePhone(phone);
  if (!raw) return { digits: "", valid: false, wasLocalSaudiFormat: false };

  // Already international with the Saudi country code: 966 + 9-digit mobile.
  if (raw.startsWith(SAUDI_COUNTRY_CODE) && raw.length === 12) {
    return { digits: raw, valid: true, wasLocalSaudiFormat: false };
  }
  // Local Saudi format with the leading trunk 0: 0 + 9-digit mobile (05XXXXXXXX).
  if (raw.startsWith("0") && raw.length === 10) {
    return { digits: `${SAUDI_COUNTRY_CODE}${raw.slice(1)}`, valid: true, wasLocalSaudiFormat: true };
  }
  // Saudi mobile with neither trunk 0 nor country code: 5XXXXXXXX (9 digits).
  if (raw.length === 9 && raw.startsWith("5")) {
    return { digits: `${SAUDI_COUNTRY_CODE}${raw}`, valid: true, wasLocalSaudiFormat: true };
  }
  // Any other plausible international number — pass through as-is.
  if (raw.length >= 8) {
    return { digits: raw, valid: true, wasLocalSaudiFormat: false };
  }
  return { digits: raw, valid: false, wasLocalSaudiFormat: false };
}

export function isValidWhatsAppPhone(phone: string | null | undefined): boolean {
  return normalizePhone(phone).valid;
}

export function buildWaMeUrl(phone: string, message: string): string {
  const { digits } = normalizePhone(phone);
  const text = message.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
