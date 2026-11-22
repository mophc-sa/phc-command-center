// Review 81/82 item 4: a contact's email and mobile are checked before saving.
import { composePhone, isUsablePhone } from "@/lib/phone-entry";

// A domain needs a dot and a 2+ letter ending: "name@company" alone is refused.
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** The first problem with what was typed, or null. Empty fields are allowed. */
export function contactFieldError(email: string | undefined, phone: string | undefined, ar: boolean): string | null {
  const e = (email ?? "").trim();
  if (e && !EMAIL.test(e)) return ar ? "صيغة البريد غير صحيحة (مثال: name@company.com)" : "Email looks wrong (e.g. name@company.com)";
  const p = (phone ?? "").trim();
  if (p && !isUsablePhone(composePhone(p))) return ar ? "رقم الجوال غير مكتمل أو طوله غير صحيح" : "Mobile number is incomplete or the wrong length";
  return null;
}
