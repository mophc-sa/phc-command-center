// Localized, non-leaky messages for Supabase auth failures.
//
// QA 2026-08-10 (ISSUE-004): every auth screen did
// `err instanceof Error ? err.message : …` and toasted the result, so an
// Arabic user who mistyped a password saw the raw English string
// "Invalid login credentials" on the first screen of the product. Raw
// provider messages are also a small information leak (they can carry ids,
// JWT details, and account-existence hints), so unmapped errors now fall back
// to a generic localized message instead of being echoed verbatim.

import type { Lang } from "./i18n";

type Message = { en: string; ar: string };

const GENERIC: Message = { en: "Something went wrong.", ar: "حدث خطأ ما." };

const NETWORK: Message = {
  en: "Could not reach the server. Check your connection and try again.",
  ar: "تعذّر الاتصال. تحقّق من الشبكة وحاول مرة أخرى.",
};

// Keyed by Supabase auth error code. Deliberately generic for credential
// failures — never confirm whether an email is registered.
const BY_CODE: Record<string, Message> = {
  invalid_credentials: {
    en: "Email or password is incorrect.",
    ar: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  },
  email_not_confirmed: {
    en: "Confirm your email address before signing in.",
    ar: "أكّد بريدك الإلكتروني قبل تسجيل الدخول.",
  },
  user_already_exists: {
    en: "An account with this email already exists.",
    ar: "يوجد حساب مسجّل بهذا البريد الإلكتروني.",
  },
  email_exists: {
    en: "An account with this email already exists.",
    ar: "يوجد حساب مسجّل بهذا البريد الإلكتروني.",
  },
  weak_password: {
    en: "Password is too weak. Use at least 8 characters.",
    ar: "كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل.",
  },
  same_password: {
    en: "The new password must be different from the current one.",
    ar: "كلمة المرور الجديدة يجب أن تختلف عن الحالية.",
  },
  over_request_rate_limit: {
    en: "Too many attempts. Try again in a few minutes.",
    ar: "محاولات كثيرة. حاول مرة أخرى بعد بضع دقائق.",
  },
  over_email_send_rate_limit: {
    en: "Too many emails requested. Try again in a few minutes.",
    ar: "طلبات كثيرة للبريد. حاول مرة أخرى بعد بضع دقائق.",
  },
  otp_expired: {
    en: "This code has expired. Request a new one.",
    ar: "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
  },
  mfa_verification_failed: {
    en: "The verification code is incorrect.",
    ar: "رمز التحقق غير صحيح.",
  },
  captcha_failed: {
    en: "CAPTCHA verification failed. Please try again.",
    ar: "فشل التحقق من CAPTCHA. حاول مرة أخرى.",
  },
  session_expired: {
    en: "Your session expired. Sign in again.",
    ar: "انتهت جلستك. سجّل الدخول مرة أخرى.",
  },
  user_banned: {
    en: "This account is suspended. Contact an administrator.",
    ar: "هذا الحساب موقوف. تواصل مع المسؤول.",
  },
};

// Older Supabase releases (and some endpoints) return no `code`, only a
// message. Matched case-insensitively against the raw text.
const BY_MESSAGE: [RegExp, string][] = [
  [/invalid login credentials/i, "invalid_credentials"],
  [/email not confirmed/i, "email_not_confirmed"],
  [/already registered|already exists/i, "user_already_exists"],
  [/password should be at least|weak password/i, "weak_password"],
  [/should be different from the old password/i, "same_password"],
  [/rate limit|too many requests/i, "over_request_rate_limit"],
  [/token has expired|otp.*expired|expired.*otp/i, "otp_expired"],
  [/invalid totp|invalid mfa|mfa.*verification/i, "mfa_verification_failed"],
  [/captcha/i, "captcha_failed"],
  [/banned|suspended/i, "user_banned"],
];

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|network ?error|load failed|networkrequestfailed/i.test(error.message);
}

/**
 * Maps any auth failure to a curated bilingual message. Unknown errors return
 * the generic string rather than the provider's raw text.
 */
export function authErrorMessage(error: unknown, lang: Lang): string {
  const pick = (m: Message) => (lang === "ar" ? m.ar : m.en);

  if (isNetworkError(error)) return pick(NETWORK);

  const code = codeOf(error);
  if (code && BY_CODE[code]) return pick(BY_CODE[code]);

  if (error instanceof Error && error.message) {
    for (const [pattern, mapped] of BY_MESSAGE) {
      if (pattern.test(error.message)) return pick(BY_CODE[mapped]);
    }
  }

  return pick(GENERIC);
}
