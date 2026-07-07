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
  nav_admin_settings: { en: "Admin Settings", ar: "إعدادات المسؤول" },

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
  cancel: { en: "Cancel", ar: "إلغاء" },
  confirm: { en: "Confirm", ar: "تأكيد" },
  saved: { en: "Saved", ar: "تم الحفظ" },

  // Phase 1C — action dialogs
  dialog_review_title: { en: "Request review", ar: "طلب مراجعة" },
  dialog_review_desc: {
    en: "Send this opportunity to management for review before quoting.",
    ar: "إرسال هذه الفرصة إلى الإدارة للمراجعة قبل التسعير.",
  },
  dialog_approve_title: { en: "Approve to quote", ar: "اعتماد إصدار العرض" },
  dialog_approve_desc: {
    en: "Confirm this opportunity is cleared to proceed to quotation.",
    ar: "تأكيد أن هذه الفرصة معتمدة للانتقال إلى مرحلة التسعير.",
  },
  dialog_return_title: { en: "Return for revision", ar: "إعادة للتعديل" },
  dialog_return_desc: {
    en: "Send the approval request back to the sales owner with notes.",
    ar: "إعادة طلب الاعتماد إلى صاحب الفرصة مع الملاحظات.",
  },
  dialog_schedule_title: { en: "Schedule follow-up", ar: "جدولة متابعة" },
  dialog_schedule_desc: {
    en: "Plan the next contact with this opportunity.",
    ar: "التخطيط للاتصال التالي بهذه الفرصة.",
  },
  dialog_assign_title: { en: "Assign owner", ar: "تعيين المسؤول" },
  dialog_assign_desc: {
    en: "Assign a sales owner responsible for this opportunity.",
    ar: "تعيين مسؤول مبيعات لهذه الفرصة.",
  },
  dialog_escalate_title: { en: "Escalate", ar: "تصعيد" },
  dialog_escalate_desc: {
    en: "Flag this opportunity for management attention with a reason.",
    ar: "إحالة هذه الفرصة إلى الإدارة مع تحديد السبب.",
  },
  dialog_complete_title: { en: "Mark follow-up complete", ar: "إتمام المتابعة" },
  dialog_complete_desc: {
    en: "Record that the follow-up was completed with a brief note.",
    ar: "تسجيل إتمام المتابعة مع ملاحظة موجزة.",
  },

  field_notes: { en: "Notes", ar: "الملاحظات" },
  field_reason: { en: "Reason", ar: "السبب" },
  field_due_date: { en: "Due date", ar: "تاريخ الاستحقاق" },
  field_channel: { en: "Channel", ar: "القناة" },
  field_cadence: { en: "Cadence tier", ar: "وتيرة المتابعة" },
  field_owner: { en: "Owner", ar: "المسؤول" },
  field_unassigned: { en: "Unassigned", ar: "بدون مسؤول" },
  field_outcome: { en: "Outcome", ar: "النتيجة" },

  action_reschedule: { en: "Reschedule", ar: "إعادة جدولة" },
  dialog_reschedule_title: { en: "Reschedule follow-up", ar: "إعادة جدولة المتابعة" },
  dialog_reschedule_desc: {
    en: "Move this follow-up to a new due date.",
    ar: "نقل هذه المتابعة إلى تاريخ استحقاق جديد.",
  },
  toast_reschedule_ok: { en: "Follow-up rescheduled", ar: "تمت إعادة جدولة المتابعة" },
  approvals_forbidden: {
    en: "Manager access required to act on approvals.",
    ar: "يتطلب الوصول صلاحية المدير لاتخاذ قرارات الاعتماد.",
  },

  channel_call: { en: "Call", ar: "مكالمة" },
  channel_email: { en: "Email", ar: "بريد إلكتروني" },
  channel_meeting: { en: "Meeting", ar: "اجتماع" },
  channel_whatsapp: { en: "WhatsApp", ar: "واتساب" },
  channel_site_visit: { en: "Site visit", ar: "زيارة موقع" },

  toast_review_ok: { en: "Sent for review", ar: "تم الإرسال للمراجعة" },
  toast_approve_ok: { en: "Approved", ar: "تم الاعتماد" },
  toast_return_ok: { en: "Returned for revision", ar: "أعيد للتعديل" },
  toast_schedule_ok: { en: "Follow-up scheduled", ar: "تمت جدولة المتابعة" },
  toast_assign_ok: { en: "Owner assigned", ar: "تم تعيين المسؤول" },
  toast_escalate_ok: { en: "Escalated to management", ar: "تم التصعيد للإدارة" },
  toast_complete_ok: { en: "Follow-up completed", ar: "تمت المتابعة" },
  toast_error: { en: "Action failed", ar: "تعذّر تنفيذ الإجراء" },

  // Team & Permissions
  team_intro: {
    en: "Grant and revoke roles for your team. Managers (CEO, Sales Manager) can change roles.",
    ar: "منح وسحب الأدوار لأعضاء الفريق. يمكن للمديرين (الرئيس التنفيذي، مدير المبيعات) تعديل الأدوار.",
  },
  team_forbidden: {
    en: "You do not have permission to manage team roles.",
    ar: "لا تملك صلاحية إدارة أدوار الفريق.",
  },
  team_col_member: { en: "Member", ar: "العضو" },
  team_col_roles: { en: "Roles", ar: "الأدوار" },
  team_col_manage: { en: "Manage", ar: "إدارة" },
  role_ceo: { en: "CEO", ar: "الرئيس التنفيذي" },
  role_sales_manager: { en: "Sales Manager", ar: "مدير المبيعات" },
  role_bd_manager: { en: "BD Manager", ar: "مدير التطوير" },
  role_viewer: { en: "Viewer", ar: "قارئ" },
  toast_role_granted: { en: "Role granted", ar: "تم منح الدور" },
  toast_role_revoked: { en: "Role revoked", ar: "تم سحب الدور" },

  // Activity timeline filters
  timeline_all: { en: "All", ar: "الكل" },
  timeline_alert: { en: "Alert", ar: "التنبيه" },
  timeline_evidence: { en: "Evidence", ar: "الأدلة" },
  timeline_decision: { en: "Decision", ar: "القرار" },
  timeline_assignment: { en: "Assignment", ar: "التعيين" },
  timeline_follow_up: { en: "Follow-up", ar: "المتابعة" },
  timeline_outcome: { en: "Logged Outcome", ar: "النتيجة المسجلة" },

  // Evidence viewer
  evidence_viewer_title: { en: "Evidence detail", ar: "تفاصيل الدليل" },
  evidence_open_source: { en: "Open source", ar: "فتح المصدر" },
  evidence_no_url: { en: "No linked source URL.", ar: "لا يوجد رابط مصدر." },

  // Approvals extras
  action_escalate_short: { en: "Escalate", ar: "تصعيد" },
  approvals_error: { en: "Could not load approvals.", ar: "تعذّر تحميل الاعتمادات." },
  retry: { en: "Retry", ar: "إعادة المحاولة" },

  // Admin Settings
  admin_settings_title: { en: "Admin Settings", ar: "إعدادات المسؤول" },
  admin_settings_intro: {
    en: "Overview of every role, its active capabilities, and the members holding it. Only the primary administrator (CEO) can change assignments here.",
    ar: "نظرة شاملة على كل دور والصلاحيات المفعّلة له والأعضاء الذين يحملونه. لا يمكن تعديل التعيينات إلا من قِبل المسؤول الرئيسي (الرئيس التنفيذي).",
  },
  admin_settings_forbidden: {
    en: "Only the primary administrator (CEO) can modify roles from this screen.",
    ar: "لا يستطيع تعديل الأدوار من هذه الصفحة إلا المسؤول الرئيسي (الرئيس التنفيذي).",
  },
  admin_section_matrix: { en: "Capabilities by Role", ar: "الصلاحيات حسب الدور" },
  admin_section_holders: { en: "Members by Role", ar: "الأعضاء حسب الدور" },
  admin_section_assign: { en: "Assign Roles", ar: "تعيين الأدوار" },
  admin_col_capability: { en: "Capability", ar: "الصلاحية" },
  admin_no_holders: { en: "No members assigned.", ar: "لا يوجد أعضاء معيّنون." },

  // Git sync status
  git_sync_title: { en: "GitHub Sync", ar: "مزامنة GitHub" },
  git_status_connected: { en: "Connected", ar: "متصل" },
  git_status_unknown: { en: "Unknown", ar: "غير معروف" },
  git_branch_label: { en: "Branch", ar: "الفرع" },
  git_commit_label: { en: "Commit", ar: "الالتزام" },

  // Capabilities
  cap_manage_roles: { en: "Manage roles & permissions", ar: "إدارة الأدوار والصلاحيات" },
  cap_approve_decisions: { en: "Approve / return decisions", ar: "اعتماد وإرجاع القرارات" },
  cap_escalate: { en: "Escalate to management", ar: "التصعيد للإدارة" },
  cap_manage_opps: { en: "Create & edit opportunities", ar: "إنشاء وتعديل الفرص" },
  cap_assign_owner: { en: "Assign opportunity owner", ar: "تعيين مسؤول الفرصة" },
  cap_schedule_followups: { en: "Schedule & complete follow-ups", ar: "جدولة وإتمام المتابعات" },
  cap_view_reports: { en: "View reports & analytics", ar: "عرض التقارير والتحليلات" },
  cap_view_opps: { en: "View opportunities & timeline", ar: "عرض الفرص والجدول الزمني" },
  cap_view_audit: { en: "View full audit trail", ar: "عرض سجل التدقيق الكامل" },
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
