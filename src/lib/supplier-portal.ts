// The supplier portal's rules in the browser (pricing loop PR 3). SQL decides
// (supplier_portal_* in 20261108130000 and 20261108140000); this only shapes
// what the supplier types into what supplier_portal_submit takes, decides where
// the portal's guard sends a session, and words the messages the pricer copies.
// supplier-portal.test.ts pins it.
import type { Lang } from "@/lib/i18n";
import type { AppRole } from "@/lib/roles";
import { parseDraft, type DraftFailure, type DraftRules } from "@/lib/pricing-input";
import type { Bi } from "@/lib/pricing-text";

export type PortalStatus = "open" | "returned" | "submitted" | "closed";
export const PORTAL_STATUS_LABEL: Record<PortalStatus, Bi> = {
  open: { en: "Waiting for your prices", ar: "بانتظار أسعارك" },
  returned: { en: "Returned for changes", ar: "أُعيد للتعديل" },
  submitted: { en: "Submitted", ar: "أُرسل" },
  closed: { en: "Closed", ar: "مغلق" },
};

/** supplier_portal_invitations() rows. */
export type PortalListRow = {
  invitation_id: string;
  project_code: string;
  reply_by: string;
  status: PortalStatus;
  sent_at: string;
  submitted_at: string | null;
  lines: number;
  open_lines: number;
};

export type PortalLine = {
  line_id: string;
  line_number: number | null;
  sign_type: string | null;
  description: string | null;
  dimensions: string | null;
  material: string | null;
  mounting: string | null;
  illumination: string | null;
  finish: string | null;
  quantity: number;
  unit: string | null;
  width_mm: number | null;
  height_mm: number | null;
  has_screen: boolean | null;
  state: "open" | "submitted" | "reopened";
  editable: boolean;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  spec_difference: string | null;
};
export type PortalFile = { file_id: string; name: string; size_bytes: number | null; mime_type: string | null };

/** supplier_portal_invitation(id). */
export type PortalInvitation = {
  invitation_id: string;
  project_code: string;
  reply_by: string;
  sent_at: string;
  instructions: string | null;
  return_message: string | null;
  status: PortalStatus;
  editable: boolean;
  terms: { lead_time_days: number | null; payment_terms: string | null; valid_until: string | null };
  lines: PortalLine[];
  files: PortalFile[];
};

/** supplier_portal_confirmation(lang) returns the same two strings (supplier-portal.contract.test.ts). */
export const PORTAL_CONFIRMATION: Bi = {
  en: "My prices are based only on the files attached to this request; any material or spec difference is written on its line.",
  ar: "أسعاري مبنية فقط على الملفات المرفقة بهذا الطلب، وأي اختلاف في الخامة أو المواصفة مكتوب على سطره.",
};

// numeric(14,2) in the database; the SQL refuses 1e12 and above.
export const PRICE_RULES: DraftRules = { min: 0, below: 1e12 };
export const LEAD_RULES: DraftRules = { min: 0, max: 9999, integer: true };

export type LineDraft = { unit_cost?: string; unit_cost_with_screen?: string; spec_difference?: string };
export type TermsDraft = { lead: string; payment: string; valid: string };
export type SubmissionLine = {
  line_id: string;
  unit_cost: number | null;
  unit_cost_with_screen: number | null;
  spec_difference: string | null;
};
export type SubmissionTerms = { lead_time_days: number; payment_terms: string; valid_until: string };
export type SubmissionProblem = DraftFailure | "required" | "too_long" | "past_date" | "no_price";
/** key: `<line_id>:<field>` for a line box, "lead" / "payment" / "valid" for the terms, "lines" for the whole table. */
export type SubmissionError = { key: string; problem: SubmissionProblem };

const text = (lineDraft: string | undefined, saved: number | null): string =>
  lineDraft !== undefined ? lineDraft : saved == null ? "" : String(saved);

/**
 * What supplier_portal_submit takes, or every box that needs fixing. Only the
 * editable lines are sent (the SQL refuses any other), each one, priced or not;
 * a box the supplier did not touch keeps the price already on file.
 */
export function buildSubmission(
  lines: readonly PortalLine[],
  drafts: Readonly<Record<string, LineDraft>>,
  terms: TermsDraft,
  today: string,
): { ok: true; lines: SubmissionLine[]; terms: SubmissionTerms } | { ok: false; errors: SubmissionError[] } {
  const errors: SubmissionError[] = [];
  const out: SubmissionLine[] = [];
  for (const l of lines.filter((x) => x.editable)) {
    const d = drafts[l.line_id] ?? {};
    const unit = parseDraft(text(d.unit_cost, l.unit_cost), PRICE_RULES);
    const screen = parseDraft(text(d.unit_cost_with_screen, l.unit_cost_with_screen), PRICE_RULES);
    const spec = (d.spec_difference !== undefined ? d.spec_difference : (l.spec_difference ?? "")).trim();
    if (!unit.ok) errors.push({ key: `${l.line_id}:unit_cost`, problem: unit.reason });
    if (!screen.ok) errors.push({ key: `${l.line_id}:unit_cost_with_screen`, problem: screen.reason });
    if (spec.length > 500) errors.push({ key: `${l.line_id}:spec_difference`, problem: "too_long" });
    out.push({
      line_id: l.line_id,
      unit_cost: unit.ok ? unit.value : null,
      unit_cost_with_screen: screen.ok ? screen.value : null,
      spec_difference: spec || null,
    });
  }
  if (out.length > 0 && errors.length === 0 && out.every((l) => l.unit_cost == null)) errors.push({ key: "lines", problem: "no_price" });
  const lead = parseDraft(terms.lead, LEAD_RULES);
  if (!lead.ok) errors.push({ key: "lead", problem: lead.reason });
  else if (lead.value == null) errors.push({ key: "lead", problem: "required" });
  const payment = terms.payment.trim();
  if (!payment) errors.push({ key: "payment", problem: "required" });
  else if (payment.length > 500) errors.push({ key: "payment", problem: "too_long" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(terms.valid)) errors.push({ key: "valid", problem: "required" });
  else if (terms.valid < today) errors.push({ key: "valid", problem: "past_date" });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    lines: out,
    terms: { lead_time_days: (lead as { value: number }).value, payment_terms: payment, valid_until: terms.valid },
  };
}

/** Today in Riyadh, YYYY-MM-DD: reply-by dates are Saudi business days (SQL: _pricing_today()). */
export const riyadhToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Whole days from today to the reply-by date: negative when overdue. */
export function daysLeft(replyBy: string, today: string): number {
  return Math.round((Date.parse(`${replyBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
export const isOverdue = (replyBy: string, today: string): boolean => daysLeft(replyBy, today) < 0;

/** The portal link a pricer sends: the list, or one request. */
export const portalLink = (origin: string, invitationId?: string): string =>
  `${origin.replace(/\/+$/, "")}/supplier${invitationId ? `/${invitationId}` : ""}`;

/** The invite text: the portal link only, no project details (spec section 2). */
export function inviteMessage(link: string, lang: Lang): string {
  return lang === "ar"
    ? `أرسلت لكم PHC طلب تسعير جديداً. سجّلوا الدخول إلى بوابة الموردين لرؤيته: ${link}`
    : `PHC has sent you a new pricing request. Sign in to the PHC supplier portal to see it: ${link}`;
}

/** The new-account text: the one-time set-password link, then where to sign in. */
export function accountMessage(setPasswordUrl: string, signInUrl: string, lang: Lang): string {
  return lang === "ar"
    ? `أُنشئ حسابكم في بوابة موردي PHC. اختاروا كلمة المرور من هذا الرابط (يعمل مرة واحدة ولفترة محدودة): ${setPasswordUrl}\nثم سجّلوا الدخول من ${signInUrl} وفعّلوا التحقق بخطوتين.`
    : `Your PHC supplier portal account is ready. Choose your password with this link (it works once, for a limited time): ${setPasswordUrl}\nThen sign in at ${signInUrl} and set up two-step verification.`;
}

/** Where the portal's guard sends a session. null: let it in. */
export type PortalRedirect =
  | { to: "/auth"; search: { next: string } }
  | { to: "/pending-approval" }
  | { to: "/" }
  | { to: "/mfa-setup" }
  | { to: "/mfa-verify" };
export type GateInput = {
  signedIn: boolean;
  status: string | null;
  roles: readonly AppRole[];
  aal: { currentLevel: string | null; nextLevel: string | null } | null;
};
export function supplierGate(i: GateInput, next: string): { redirect: PortalRedirect | null; signOut: boolean } {
  if (!i.signedIn) return { redirect: { to: "/auth", search: { next } }, signOut: false };
  if (!i.status || i.status === "pending_approval") return { redirect: { to: "/pending-approval" }, signOut: false };
  if (i.status !== "active") return { redirect: { to: "/auth", search: { next: "" } }, signOut: true };
  if (!i.roles.includes("supplier")) return { redirect: { to: "/" }, signOut: false };
  if (i.aal?.nextLevel === "aal1") return { redirect: { to: "/mfa-setup" }, signOut: false };
  if (i.aal?.nextLevel === "aal2" && i.aal.currentLevel !== "aal2") return { redirect: { to: "/mfa-verify" }, signOut: false };
  return { redirect: null, signOut: false };
}
