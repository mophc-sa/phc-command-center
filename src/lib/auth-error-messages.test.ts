import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authErrorMessage } from "./auth-error-messages";

const root = join(import.meta.dir, "../..");

// QA 2026-08-10 (ISSUE-004): auth screens did `err.message` straight into a
// toast, so an Arabic user failing a sign-in saw the raw Supabase string
// "Invalid login credentials" in English on the very first screen of the app.

class FakeAuthError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
    this.status = status;
  }
}

describe("authErrorMessage", () => {
  test("localizes invalid credentials by error code", () => {
    const err = new FakeAuthError("Invalid login credentials", "invalid_credentials", 400);
    expect(authErrorMessage(err, "ar")).toBe("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    expect(authErrorMessage(err, "en")).toBe("Email or password is incorrect.");
  });

  test("falls back to matching the message when no code is present", () => {
    const err = new Error("Invalid login credentials");
    expect(authErrorMessage(err, "ar")).toBe("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  });

  test("keeps the credential error generic so it cannot enumerate accounts", () => {
    const en = authErrorMessage(new FakeAuthError("x", "invalid_credentials"), "en");
    expect(en).not.toMatch(/no account|not found|does not exist|unregistered/i);
  });

  test("localizes the common auth failures", () => {
    const cases: [string, string, string][] = [
      ["email_not_confirmed", "Confirm your email address before signing in.", "أكّد بريدك الإلكتروني قبل تسجيل الدخول."],
      ["user_already_exists", "An account with this email already exists.", "يوجد حساب مسجّل بهذا البريد الإلكتروني."],
      ["weak_password", "Password is too weak. Use at least 8 characters.", "كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل."],
      ["same_password", "The new password must be different from the current one.", "كلمة المرور الجديدة يجب أن تختلف عن الحالية."],
      ["over_request_rate_limit", "Too many attempts. Try again in a few minutes.", "محاولات كثيرة. حاول مرة أخرى بعد بضع دقائق."],
      ["otp_expired", "This code has expired. Request a new one.", "انتهت صلاحية الرمز. اطلب رمزاً جديداً."],
      ["captcha_failed", "CAPTCHA verification failed. Please try again.", "فشل التحقق من CAPTCHA. حاول مرة أخرى."],
    ];
    for (const [code, en, ar] of cases) {
      expect(authErrorMessage(new FakeAuthError("raw", code), "en")).toBe(en);
      expect(authErrorMessage(new FakeAuthError("raw", code), "ar")).toBe(ar);
    }
  });

  test("localizes a wrong MFA code", () => {
    const err = new FakeAuthError("Invalid TOTP code entered", "mfa_verification_failed");
    expect(authErrorMessage(err, "ar")).toBe("رمز التحقق غير صحيح.");
    expect(authErrorMessage(err, "en")).toBe("The verification code is incorrect.");
  });

  test("localizes network failures", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"), "ar")).toBe(
      "تعذّر الاتصال. تحقّق من الشبكة وحاول مرة أخرى.",
    );
  });

  test("falls back to a generic localized message for unknown errors", () => {
    expect(authErrorMessage(new Error("some internal detail"), "ar")).toBe("حدث خطأ ما.");
    expect(authErrorMessage(new Error("some internal detail"), "en")).toBe("Something went wrong.");
  });

  test("never leaks the raw message for an unmapped error", () => {
    const leaky = new Error("PGRST301: JWT expired for user 4f3a-secret");
    expect(authErrorMessage(leaky, "en")).not.toContain("4f3a-secret");
    expect(authErrorMessage(leaky, "ar")).not.toContain("4f3a-secret");
  });

  test("handles non-Error values", () => {
    expect(authErrorMessage(undefined, "en")).toBe("Something went wrong.");
    expect(authErrorMessage("boom", "ar")).toBe("حدث خطأ ما.");
  });
});

describe("auth screens use the localized mapper (ISSUE-004 regression guard)", () => {
  const files = [
    "src/routes/auth.tsx",
    "src/routes/reset-password.tsx",
    "src/routes/mfa-verify.tsx",
    "src/routes/mfa-setup.tsx",
  ];

  test("no auth screen surfaces a raw error message to the user", () => {
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).toContain("authErrorMessage");
      expect(source).not.toContain("err instanceof Error ? err.message");
    }
  });
});
