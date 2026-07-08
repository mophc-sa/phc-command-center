// Email templates + mailto helpers for the "Email via Outlook" Phase 1 flow.
//
// Pure functions only — no side effects, no network, no Supabase, no window.
// Consumers render the returned {subject, body} inside EmailComposeModal, and
// call buildMailto(...) when the user clicks "Open in Outlook".
//
// Phase 1 constraints (see the Phase 1 brief):
//   - no SMTP, no Microsoft Graph, no OAuth
//   - never mark an email as sent
//   - open the user's default mail client via a `mailto:` URL only

export type EmailLang = "en" | "ar";

export type EmailContext = {
  recipientName?: string | null;
  recipientEmail?: string | null;
  ccEmails?: string[] | null;
  companyName?: string | null;
  projectName?: string | null;
  opportunityName?: string | null;
  tenderName?: string | null;
  rfqName?: string | null;
  currentStage?: string | null;
  nextAction?: string | null;
  quotationRef?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  aiRecommendation?: string | null;
  missingFields?: string[] | null;
  lang?: EmailLang;
};

export type EmailTemplateKind =
  | "opportunity_follow_up"
  | "tender_clarification"
  | "contractor_introduction"
  | "meeting_request"
  | "missing_information"
  | "quotation_follow_up";

export type EmailDraft = {
  subject: string;
  body: string;
};

// Most Windows/Outlook mailto handlers truncate around ~2000 chars.
// Keep well under that so recipient + subject + body all survive.
export const MAILTO_MAX_LENGTH = 1900;

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pickName(ctx: EmailContext): string {
  return s(ctx.recipientName) || (ctx.lang === "ar" ? "حضرتك" : "there");
}

function pickRecordLabel(ctx: EmailContext): string {
  return (
    s(ctx.projectName) ||
    s(ctx.opportunityName) ||
    s(ctx.tenderName) ||
    s(ctx.rfqName) ||
    s(ctx.companyName) ||
    (ctx.lang === "ar" ? "المشروع" : "the project")
  );
}

function signature(ctx: EmailContext): string {
  const name = s(ctx.ownerName) || (ctx.lang === "ar" ? "فريق PHC" : "PHC Team");
  const email = s(ctx.ownerEmail);
  if (ctx.lang === "ar") {
    return `\n\nمع تحياتي،\n${name}${email ? `\n${email}` : ""}\nPHC — لافتات وإرشاد وتصنيع`;
  }
  return `\n\nBest regards,\n${name}${email ? `\n${email}` : ""}\nPHC — Wayfinding, Signs & Fabrication`;
}

function opportunityFollowUp(ctx: EmailContext): EmailDraft {
  const name = pickName(ctx);
  const proj = pickRecordLabel(ctx);
  const stage = s(ctx.currentStage);
  const next = s(ctx.nextAction);
  if (ctx.lang === "ar") {
    return {
      subject: `متابعة بخصوص ${proj} — PHC`,
      body:
        `مرحباً ${name},\n\n` +
        `نود المتابعة معكم بخصوص ${proj}.\n` +
        (stage ? `المرحلة الحالية: ${stage}.\n` : "") +
        `شركة PHC شريككم في تنفيذ حزم الإرشاد واللافتات، ونحرص على المواءمة مع خططكم القادمة.\n\n` +
        `الخطوة التالية المقترحة: ${next || "تأكيد الجدول الزمني وأي مستندات مطلوبة."}\n\n` +
        `هل يمكن تحديد موعد قصير للمراجعة؟` +
        signature(ctx),
    };
  }
  return {
    subject: `Follow-up on ${proj} — PHC`,
    body:
      `Hi ${name},\n\n` +
      `Following up on ${proj}.\n` +
      (stage ? `Current stage: ${stage}.\n` : "") +
      `PHC is your wayfinding and signage execution partner and we'd like to stay aligned with your upcoming plans.\n\n` +
      `Suggested next step: ${next || "confirm timing and any documents we should review."}\n\n` +
      `Could we set a short call to align?` +
      signature(ctx),
  };
}

function tenderClarification(ctx: EmailContext): EmailDraft {
  const name = pickName(ctx);
  const label = s(ctx.tenderName) || s(ctx.rfqName) || pickRecordLabel(ctx);
  if (ctx.lang === "ar") {
    return {
      subject: `طلب توضيحات — ${label}`,
      body:
        `مرحباً ${name},\n\n` +
        `بخصوص ${label}، نحتاج بعض التوضيحات لإكمال تقييمنا:\n` +
        `- حالة حزمة الإرشاد/اللافتات ضمن نطاق العمل.\n` +
        `- الموعد النهائي لتقديم الحزمة.\n` +
        `- ملفات BOQ / المخططات / المواصفات إن توفرت.\n` +
        `- الشخص المسؤول للتواصل الفني والتجاري.\n` +
        `- الخطوة القادمة في عملية التقديم.\n\n` +
        `شاكرين تعاونكم.` +
        signature(ctx),
    };
  }
  return {
    subject: `Clarification Request — ${label}`,
    body:
      `Hi ${name},\n\n` +
      `Regarding ${label}, we need a few clarifications to complete our review:\n` +
      `- Status of the signage / wayfinding package within the scope.\n` +
      `- Package submission deadline.\n` +
      `- BOQ / drawings / specifications if available.\n` +
      `- Responsible contact for technical and commercial coordination.\n` +
      `- Next step in the submission process.\n\n` +
      `Thank you for your support.` +
      signature(ctx),
  };
}

function contractorIntroduction(ctx: EmailContext): EmailDraft {
  const name = pickName(ctx);
  const proj = pickRecordLabel(ctx);
  const company = s(ctx.companyName);
  if (ctx.lang === "ar") {
    return {
      subject: `دعم PHC للإرشاد واللافتات — ${proj}`,
      body:
        `مرحباً ${name},\n\n` +
        `شركة PHC متخصصة في تنفيذ حزم الإرشاد واللافتات (Wayfinding & Signage) للمشاريع الكبرى.\n` +
        (company ? `نتواصل معكم في ${company} بخصوص ${proj}.\n` : `نتواصل معكم بخصوص ${proj}.\n`) +
        `نرغب بالتنسيق مع الشخص المسؤول عن حزمة اللافتات (فني / مشتريات) لبحث كيفية دعمكم في التنفيذ ضمن الجدول الزمني للمشروع.\n\n` +
        `هل يمكن توجيهنا لجهة الاتصال المناسبة؟` +
        signature(ctx),
    };
  }
  return {
    subject: `PHC Wayfinding & Signage Support — ${proj}`,
    body:
      `Hi ${name},\n\n` +
      `PHC specialises in executing wayfinding and signage packages for major projects.\n` +
      (company ? `We're reaching out to ${company} regarding ${proj}.\n` : `We're reaching out regarding ${proj}.\n`) +
      `We'd like to coordinate with the person responsible for the signage package (technical / procurement) to discuss how we can support execution within the project timeline.\n\n` +
      `Could you point us to the right contact?` +
      signature(ctx),
  };
}

function meetingRequest(ctx: EmailContext): EmailDraft {
  const name = pickName(ctx);
  const label = s(ctx.projectName) || s(ctx.opportunityName) || s(ctx.companyName) || (ctx.lang === "ar" ? "التنسيق" : "coordination");
  if (ctx.lang === "ar") {
    return {
      subject: `طلب اجتماع — ${label}`,
      body:
        `مرحباً ${name},\n\n` +
        `نود ترتيب اجتماع قصير حول ${label}.\n\n` +
        `الغرض المقترح: مراجعة النطاق والمواءمة على الخطوات القادمة.\n` +
        `جدول أعمال مقترح:\n` +
        `- مراجعة المتطلبات الحالية.\n` +
        `- تحديد المسؤوليات والجدول الزمني.\n` +
        `- الخطوات التالية.\n\n` +
        `هل يوجد وقت مناسب هذا الأسبوع أو الأسبوع القادم؟` +
        signature(ctx),
    };
  }
  return {
    subject: `Meeting Request — ${label}`,
    body:
      `Hi ${name},\n\n` +
      `I'd like to set up a short meeting regarding ${label}.\n\n` +
      `Proposed purpose: review scope and align on next steps.\n` +
      `Suggested agenda:\n` +
      `- Review current requirements.\n` +
      `- Confirm responsibilities and timeline.\n` +
      `- Agree on next steps.\n\n` +
      `Would this week or next work on your side?` +
      signature(ctx),
  };
}

function missingInformation(ctx: EmailContext): EmailDraft {
  const name = pickName(ctx);
  const label = pickRecordLabel(ctx);
  const missing = (ctx.missingFields ?? []).filter(Boolean);
  const list = missing.length
    ? missing.map((m) => `- ${m}`).join("\n")
    : ctx.lang === "ar"
      ? "- التفاصيل الأساسية للمشروع.\n- جهة الاتصال المسؤولة."
      : "- Core project details.\n- Responsible contact person.";
  if (ctx.lang === "ar") {
    return {
      subject: `معلومات ناقصة — ${label}`,
      body:
        `مرحباً ${name},\n\n` +
        `لإكمال ملف ${label} لدينا، نحتاج المعلومات التالية:\n` +
        `${list}\n\n` +
        `شاكرين تعاونكم.` +
        signature(ctx),
    };
  }
  return {
    subject: `Missing Information — ${label}`,
    body:
      `Hi ${name},\n\n` +
      `To complete our file on ${label}, we still need the following:\n` +
      `${list}\n\n` +
      `Thanks for your help.` +
      signature(ctx),
  };
}

function quotationFollowUp(ctx: EmailContext): EmailDraft {
  const name = pickName(ctx);
  const label = s(ctx.quotationRef) || s(ctx.opportunityName) || pickRecordLabel(ctx);
  if (ctx.lang === "ar") {
    return {
      subject: `متابعة عرض السعر — ${label}`,
      body:
        `مرحباً ${name},\n\n` +
        `نود متابعة عرض السعر المتعلق بـ ${label}.\n` +
        (s(ctx.quotationRef) ? `المرجع: ${ctx.quotationRef}.\n` : "") +
        `\nنرحب بأي ملاحظات أو تحديثات حول الحالة.\n\n` +
        `الخطوة التالية المقترحة: ${s(ctx.nextAction) || "تأكيد الاتجاه للمضي قدماً."}` +
        signature(ctx),
    };
  }
  return {
    subject: `Quotation Follow-up — ${label}`,
    body:
      `Hi ${name},\n\n` +
      `Following up on the quotation related to ${label}.\n` +
      (s(ctx.quotationRef) ? `Reference: ${ctx.quotationRef}.\n` : "") +
      `\nWe welcome any feedback or a status update.\n\n` +
      `Suggested next step: ${s(ctx.nextAction) || "confirm the direction to move forward."}` +
      signature(ctx),
  };
}

const BUILDERS: Record<EmailTemplateKind, (ctx: EmailContext) => EmailDraft> = {
  opportunity_follow_up: opportunityFollowUp,
  tender_clarification: tenderClarification,
  contractor_introduction: contractorIntroduction,
  meeting_request: meetingRequest,
  missing_information: missingInformation,
  quotation_follow_up: quotationFollowUp,
};

export function buildEmailDraft(kind: EmailTemplateKind, ctx: EmailContext): EmailDraft {
  const draft = BUILDERS[kind](ctx);
  // If an AI recommendation is attached, surface it as a leading note so the
  // user always sees the suggestion they're following up on.
  const aiNote = s(ctx.aiRecommendation);
  if (aiNote) {
    const label = ctx.lang === "ar" ? "توصية الذكاء" : "AI recommendation";
    return { subject: draft.subject, body: `${label}: ${aiNote}\n\n${draft.body}` };
  }
  return draft;
}

// RFC 6068 mailto: use %20 for spaces (URLSearchParams gives '+', which some
// clients render literally). Encode headers via encodeURIComponent so \n, &, ?
// and non-ASCII characters survive the round-trip into Outlook/Apple Mail.
function enc(v: string): string {
  return encodeURIComponent(v).replace(/%20/g, "%20"); // no-op; kept for clarity
}

export type MailtoInput = {
  to: string;
  cc?: string | string[] | null;
  subject?: string;
  body?: string;
};

export function buildMailtoUrl(input: MailtoInput): string {
  const to = s(input.to);
  const params: string[] = [];
  const cc = Array.isArray(input.cc) ? input.cc.filter(Boolean).join(",") : s(input.cc ?? "");
  if (cc) params.push(`cc=${enc(cc)}`);
  const subject = s(input.subject);
  if (subject) params.push(`subject=${enc(subject)}`);
  const body = s(input.body);
  if (body) params.push(`body=${enc(body)}`);
  const query = params.length ? `?${params.join("&")}` : "";
  return `mailto:${enc(to)}${query}`;
}

// Simple RFC-5322-ish check — good enough to gate the "Open in Outlook" action.
export function isValidEmail(v: string | null | undefined): boolean {
  const t = s(v);
  if (!t) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export type EmailValidation =
  | { ok: true; url: string; truncated: boolean }
  | { ok: false; reason: "missing_recipient" | "invalid_recipient" | "empty_content" };

export function validateEmailDraft(input: {
  to: string | null | undefined;
  cc?: string | string[] | null;
  subject: string;
  body: string;
}): EmailValidation {
  if (!s(input.to)) return { ok: false, reason: "missing_recipient" };
  if (!isValidEmail(input.to)) return { ok: false, reason: "invalid_recipient" };
  if (!s(input.subject) && !s(input.body)) return { ok: false, reason: "empty_content" };
  const url = buildMailtoUrl({ to: input.to!, cc: input.cc, subject: input.subject, body: input.body });
  return { ok: true, url, truncated: url.length > MAILTO_MAX_LENGTH };
}
