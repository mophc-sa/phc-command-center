import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

type Dict = Record<string, { en: string; ar: string }>;

// Curated bilingual strings. Do not machine-translate additions.
export const strings = {
  // Nav
  nav_command_center: { en: "Command Center", ar: "مركز القيادة" },
  nav_opportunities: { en: "Opportunities", ar: "الفرص" },
  nav_follow_ups: { en: "Follow-ups", ar: "المتابعات" },
  nav_discovery: { en: "Discovery Inbox", ar: "الفرص المكتشفة" },
  nav_approvals: { en: "Approvals", ar: "الاعتمادات" },
  nav_reports: { en: "Reports", ar: "التقارير" },
  nav_agent_activity: { en: "Agent Activity", ar: "نشاط الوكيل" },
  nav_team: { en: "Team & Permissions", ar: "الفريق والصلاحيات" },
  nav_settings: { en: "Settings", ar: "الإعدادات" },

  // Header
  area_sales_agent: { en: "Sales Agent", ar: "وكيل المبيعات" },
  agent_status_running: { en: "Running", ar: "قيد التشغيل" },
  agent_status_needs_review: { en: "Needs Review", ar: "يحتاج مراجعة" },
  agent_status_paused: { en: "Paused", ar: "متوقف" },
  agent_status_error: { en: "Error", ar: "خطأ" },
  last_refreshed: { en: "Last refreshed", ar: "آخر تحديث" },
  sign_out: { en: "Sign out", ar: "تسجيل الخروج" },

  // Command Center
  needs_attention: { en: "Needs Attention", ar: "يحتاج إلى إجراء" },
  high_priority_opportunities: { en: "High-Priority Opportunities", ar: "الفرص ذات الأولوية العالية" },
  follow_ups_due: { en: "Follow-ups Due", ar: "المتابعات المستحقة" },
  new_opportunities: { en: "New Opportunities", ar: "فرص جديدة" },
  agent_activity: { en: "Agent Activity", ar: "نشاط الوكيل" },

  // Metrics
  metric_pipeline_value: { en: "Open Pipeline Value", ar: "قيمة الفرص المفتوحة" },
  metric_follow_up_value: { en: "Value Requiring Follow-up", ar: "القيمة التي تحتاج متابعة" },
  metric_awaiting_approval: { en: "Decisions Awaiting Approval", ar: "قرارات بانتظار الاعتماد" },
  metric_newly_qualified: { en: "Newly Qualified", ar: "فرص مؤهلة حديثاً" },

  // Actions (fixed vocabulary)
  action_review: { en: "Review", ar: "مراجعة" },
  action_approve: { en: "Approve", ar: "اعتماد" },
  action_return: { en: "Return for Revision", ar: "إعادة للتعديل" },
  action_assign: { en: "Assign Owner", ar: "تعيين المسؤول" },
  action_schedule: { en: "Schedule Follow-up", ar: "جدولة متابعة" },
  action_escalate: { en: "Escalate", ar: "تصعيد" },
  action_complete: { en: "Mark Complete", ar: "إتمام" },
  action_archive: { en: "Archive", ar: "أرشفة" },
  action_view_evidence: { en: "View Evidence", ar: "عرض الأدلة" },

  // Empty states
  empty_needs_attention: {
    en: "Nothing needs attention right now. The pipeline is on cadence.",
    ar: "لا يوجد ما يستدعي الإجراء الآن. جميع الفرص ضمن الوتيرة المحددة.",
  },
  empty_follow_ups: {
    en: "No follow-ups are overdue. The current pipeline is within its planned cadence.",
    ar: "لا توجد متابعات متأخرة. جميع الفرص المفتوحة ضمن وتيرة المتابعة المحددة.",
  },
  empty_approvals: {
    en: "No opportunities are awaiting approval.",
    ar: "لا توجد فرص بانتظار الاعتماد.",
  },
  empty_discovery: {
    en: "No new discovery candidates need qualification today.",
    ar: "لا توجد فرص مكتشفة تحتاج إلى تأهيل اليوم.",
  },
  empty_evidence: {
    en: "No evidence has been attached to this opportunity yet.",
    ar: "لا توجد أدلة مرفقة بهذه الفرصة حتى الآن.",
  },
  empty_opportunities: {
    en: "No opportunities have been recorded yet.",
    ar: "لم يتم تسجيل أي فرص حتى الآن.",
  },
  empty_agent_runs: {
    en: "The Sales Agent has not run yet.",
    ar: "لم يعمل وكيل المبيعات بعد.",
  },
  empty_team: {
    en: "No team members yet. Invite people from Settings.",
    ar: "لا يوجد أعضاء بالفريق. يمكنك دعوتهم من الإعدادات.",
  },

  // Auth
  sign_in_title: { en: "PHC Command Center", ar: "مركز القيادة PHC" },
  sign_in_sub: {
    en: "Internal operating system for PHC Wayfinding Signs.",
    ar: "نظام التشغيل الداخلي لشركة PHC للوحات الإرشادية.",
  },
  email: { en: "Email", ar: "البريد الإلكتروني" },
  password: { en: "Password", ar: "كلمة المرور" },
  full_name: { en: "Full name", ar: "الاسم الكامل" },
  sign_in: { en: "Sign in", ar: "تسجيل الدخول" },
  create_account: { en: "Create account", ar: "إنشاء حساب" },
  have_account: { en: "Already have an account? Sign in", ar: "لديك حساب؟ سجّل الدخول" },
  no_account: { en: "New here? Create an account", ar: "مستخدم جديد؟ أنشئ حساباً" },

  // Language
  language: { en: "Language", ar: "اللغة" },
  english: { en: "English", ar: "الإنجليزية" },
  arabic: { en: "Arabic", ar: "العربية" },

  // Common
  loading: { en: "Loading…", ar: "جارٍ التحميل…" },
  error_generic: { en: "Something went wrong.", ar: "حدث خطأ ما." },
  back: { en: "Back", ar: "رجوع" },
  not_found: { en: "Not found", ar: "غير موجود" },

  // Opportunity detail — Alert / Evidence / Decision
  section_alert: { en: "Alert & Recommendation", ar: "التنبيه والتوصية" },
  section_qualification: { en: "Qualification & Signage Package", ar: "التأهيل وحزمة اللوحات" },
  section_stakeholders: { en: "Stakeholders", ar: "أصحاب القرار" },
  section_evidence: { en: "Evidence & Sources", ar: "الأدلة والمصادر" },
  section_follow_ups: { en: "Follow-up Timeline", ar: "الجدول الزمني للمتابعات" },
  section_approvals: { en: "Approvals & Decisions", ar: "الاعتمادات والقرارات" },
  section_reasoning: { en: "Agent Reasoning", ar: "منطق الوكيل" },

  label_project: { en: "Project", ar: "المشروع" },
  label_client: { en: "Client", ar: "العميل" },
  label_contractor: { en: "Main Contractor", ar: "المقاول الرئيسي" },
  label_location: { en: "Location", ar: "الموقع" },
  label_sector: { en: "Sector", ar: "القطاع" },
  label_tier: { en: "Tier", ar: "التصنيف" },
  label_stage: { en: "Sales Stage", ar: "مرحلة البيع" },
  label_project_stage: { en: "Project Stage", ar: "مرحلة المشروع" },
  label_package_status: { en: "Signage Package", ar: "حزمة اللوحات" },
  label_package_confidence: { en: "Package Confidence", ar: "درجة الثقة" },
  label_budget_confirmed: { en: "Budget Confirmed", ar: "الميزانية مؤكدة" },
  label_contractor_confirmed: { en: "Contractor Confirmed", ar: "المقاول مؤكد" },
  label_decision_maker: { en: "Decision Maker", ar: "صاحب القرار" },
  label_prequal: { en: "Prequalification", ar: "التأهيل المسبق" },
  label_strategic_value: { en: "Strategic Value", ar: "القيمة الاستراتيجية" },
  label_value_range: { en: "Estimated Value", ar: "القيمة التقديرية" },
  label_quotation: { en: "Quotation Value", ar: "قيمة العرض" },
  label_next_action: { en: "Next Action", ar: "الإجراء التالي" },
  label_recommendation: { en: "Recommendation", ar: "التوصية" },
  label_reasoning: { en: "Reasoning", ar: "المنطق" },
  label_confidence: { en: "Confidence", ar: "الثقة" },
  label_evidence_count: { en: "Evidence items", ar: "عدد الأدلة" },
  label_source: { en: "Source", ar: "المصدر" },
  label_date: { en: "Date", ar: "التاريخ" },
  label_due: { en: "Due", ar: "الاستحقاق" },
  label_channel: { en: "Channel", ar: "القناة" },
  label_status: { en: "Status", ar: "الحالة" },
  label_decision: { en: "Decision", ar: "القرار" },
  label_no_data: { en: "—", ar: "—" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
} satisfies Dict;

type Key = keyof typeof strings;

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
  dir: "ltr" | "rtl";
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    return (localStorage.getItem("phc-lang") as Lang) || "en";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("phc-lang", lang);
  }, [lang]);

  const value: Ctx = {
    lang,
    setLang: setLangState,
    dir: lang === "ar" ? "rtl" : "ltr",
    t: (k) => strings[k][lang],
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function formatNumber(n: number | null | undefined, lang: Lang, opts?: Intl.NumberFormatOptions) {
  if (n == null) return "—";
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  return new Intl.NumberFormat(locale, opts).format(n);
}

export function formatCurrency(n: number | null | undefined, lang: Lang, currency = "SAR") {
  if (n == null) return "—";
  return formatNumber(n, lang, { style: "currency", currency, maximumFractionDigits: 0 });
}
