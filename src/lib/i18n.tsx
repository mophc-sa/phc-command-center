import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

type Dict = Record<string, { en: string; ar: string }>;

// Curated bilingual strings. Do not machine-translate additions.
export const strings = {
  // Nav
  nav_command_center: { en: "Command Center", ar: "مركز القيادة" },
  nav_opportunities: { en: "Opportunities", ar: "الفرص" },
  nav_follow_ups: { en: "Follow-ups", ar: "المتابعات" },
  nav_discovery: { en: "Project Radar", ar: "رادار المشاريع" },
  nav_approvals: { en: "Approvals", ar: "الاعتمادات" },
  nav_commercial: { en: "Commercial", ar: "التجاري" },
  nav_crm: { en: "CRM", ar: "إدارة العلاقات" },
  nav_performance: { en: "Performance", ar: "الأداء" },
  nav_quotations: { en: "Quotations", ar: "عروض الأسعار" },
  nav_boq: { en: "BOQ Center", ar: "مركز الـ BOQ" },
  nav_targets: { en: "Targets & Performance", ar: "الأهداف والأداء" },
  nav_reports: { en: "Reports", ar: "التقارير" },
  nav_sales_management: { en: "Sales Management", ar: "إدارة المبيعات" },
  nav_agent_activity: { en: "Agent Activity", ar: "نشاط الوكيل" },
  nav_settings: { en: "Settings", ar: "الإعدادات" },
  nav_admin_settings: { en: "Admin Settings", ar: "إعدادات المسؤول" },
  nav_workspace: { en: "My Workspace", ar: "مساحتي" },
  nav_accounts: { en: "Accounts", ar: "الحسابات" },
  nav_contacts: { en: "Contacts", ar: "جهات الاتصال" },
  nav_projects: { en: "Projects", ar: "المشاريع" },
  nav_vendors: { en: "Vendors", ar: "الموردون" },
  nav_reference_library: { en: "Reference Library", ar: "مكتبة المراجع" },
  nav_knowledge: { en: "Knowledge Search", ar: "البحث المعرفي" },
  nav_ai_agents: { en: "AI Agents", ar: "وكلاء الذكاء" },
  nav_rfq_jih: { en: "RFQ & JIH Board", ar: "لوحة RFQ والفرص القائمة" },
  nav_tenders: { en: "Tender Monitor", ar: "مراقب المناقصات" },
  tender_monitor_intro: { en: "Track live tenders, deadlines, and conversion readiness.", ar: "تتبع المناقصات الحية والمواعيد النهائية وجاهزية التحويل." },
  nav_award_queue: { en: "Award & Contract Queue", ar: "طابور الترسية والعقود" },
  nav_action_center: { en: "Action Required", ar: "الإجراءات المطلوبة" },
  nav_tender_conversion: { en: "Tender Conversion", ar: "تحويل المناقصات" },
  nav_lead_tender_inbox: { en: "Lead & Tender Inbox", ar: "صندوق العملاء والمناقصات" },

  // Phase 1 navigation (PRD 2026-08-12 target architecture).
  navgroup_sales: { en: "Sales", ar: "المبيعات" },
  nav_awarded_projects: { en: "Awarded Projects", ar: "المشاريع المرساة" },
  nav_ai_configuration: { en: "AI Configuration", ar: "إعداد الذكاء" },
  nav_ai_audit: { en: "AI Audit", ar: "تدقيق الذكاء" },

  // Sidebar / nav groups
  navgroup_overview: { en: "Overview", ar: "نظرة عامة" },
  navgroup_home: { en: "Home", ar: "الرئيسية" },
  navgroup_crm: { en: "CRM", ar: "إدارة العلاقات" },
  navgroup_production: { en: "Production", ar: "الإنتاج" },
  navgroup_pipeline: { en: "Pipeline", ar: "خط المبيعات" },
  navgroup_execution: { en: "Execution", ar: "التنفيذ" },
  navgroup_intelligence: { en: "Intelligence & Resources", ar: "المعلومات والموارد" },
  navgroup_admin: { en: "Admin", ar: "الإدارة" },

  // Sales stages (RFQ/JIH flow)
  sstage_rfq_received: { en: "RFQ Received", ar: "استلام طلب عرض سعر" },
  // DISPLAY LABEL ONLY. The canonical stage stays `jih`; nothing in the
  // database, the lifecycle or the transition map changes.
  //
  // "Job In Hand" reads, to any English speaker, as work we have already won —
  // which is what the 2026-08-25 review objected to when the whole SAR 63.4M
  // sat under it. The guide defines the stage as "Live opportunity being
  // priced", so the English label contradicted its own definition. The Arabic
  // "فرصة قائمة" was always right and is unchanged; "Active JIH" keeps the
  // term the business actually says while removing the won-work reading.
  sstage_jih: { en: "Active JIH", ar: "فرصة قائمة" },
  sstage_under_negotiation: { en: "Under Negotiation", ar: "قيد التفاوض" },
  sstage_verbally_awarded: { en: "Verbally Awarded", ar: "ترسية شفهية" },
  sstage_contract_received: { en: "Contract Received", ar: "استلام العقد" },
  sstage_won: { en: "Won", ar: "تم الفوز" },
  sstage_lost: { en: "Lost", ar: "خسرت الفرصة" },
  sstage_on_hold: { en: "On Hold", ar: "معلقة" },

  // Win confidence
  wconf_low: { en: "Low", ar: "ضعيفة" },
  wconf_possible: { en: "Possible", ar: "محتملة" },
  wconf_strong: { en: "Strong", ar: "قوية" },
  wconf_sure_win: { en: "Sure Win", ar: "شبه مؤكدة" },
  win_confidence_label: { en: "Win Confidence", ar: "احتمالية الفوز" },

  // Tender stages
  tstage_tender_identified: { en: "Tender Identified", ar: "رصد مناقصة" },
  tstage_tender_under_process: { en: "Under Process", ar: "قيد الإجراء" },
  tstage_award_negotiation: { en: "Award Negotiation", ar: "تفاوض الترسية" },
  tstage_awarded_to_contractor: { en: "Awarded to Contractor", ar: "تمت الترسية على المقاول" },
  tstage_converted_to_jih: { en: "Converted to JIH", ar: "تحويل إلى فرصة قائمة" },
  tstage_tender_lost_or_archived: { en: "Lost / Archived", ar: "خاسرة / مؤرشفة" },
  tstage_tender_bafo: { en: "Tender BAFO", ar: "BAFO المناقصة" },
  sstage_jih_bafo: { en: "JIH BAFO", ar: "BAFO الفرصة" },
  sstage_contract_signed: { en: "Contract Signed", ar: "عقد موقّع" },

  // Workflow generic
  wf_new_rfq: { en: "New RFQ", ar: "طلب عرض سعر جديد" },
  wf_add_new_project: { en: "+ Add new project", ar: "+ إضافة مشروع جديد" },
  wf_add_new_company: { en: "+ Add new company", ar: "+ إضافة شركة جديدة" },
  wf_view_details: { en: "View Details", ar: "عرض التفاصيل" },
  rfq_created_location_hint: { en: "RFQ created — find it under RFQ & JIH Board → RFQ Received.", ar: "تم إنشاء طلب عرض السعر — تجده ضمن RFQ & JIH Board ← RFQ المستلمة." },
  intake_created_location_hint: { en: "Saved to Intake — convert it to an RFQ, Tender, or Lead when ready.", ar: "تم الحفظ في Intake — حوّله إلى RFQ أو منافسة أو Lead عند الجاهزية." },
  wf_new_tender: { en: "New Tender", ar: "مناقصة جديدة" },
  wf_convert_to_jih: { en: "Convert to JIH", ar: "تحويل لفرصة قائمة" },
  wf_advance_stage: { en: "Advance Stage", ar: "تقديم المرحلة" },
  wf_move_to: { en: "Move to", ar: "الانتقال إلى" },
  wf_request_conversion: { en: "Request Conversion", ar: "طلب التحويل" },
  wf_approve_conversion: { en: "Approve Conversion", ar: "اعتماد التحويل" },
  wf_set_confidence: { en: "Set Win Confidence", ar: "تحديد احتمالية الفوز" },
  wf_pending_approval: { en: "Sent for approval", ar: "أُرسل للاعتماد" },
  wf_pending_exception: { en: "Exception sent to executive", ar: "أُرسل الاستثناء للإدارة" },
  conv_review_title: { en: "Conversion Review", ar: "مراجعة التحويل" },
  conv_stage_suitable: { en: "Is the project stage suitable?", ar: "هل مرحلة المشروع مناسبة؟" },
  conv_package_open: { en: "Is the signage package still open?", ar: "هل باقة اللافتات لا تزال مفتوحة؟" },
  conv_signage_value: { en: "Expected signage value (SAR)", ar: "القيمة المتوقعة للافتات (ريال)" },
  conv_contact_plan: { en: "Is there a contact plan?", ar: "هل توجد خطة تواصل؟" },
  conv_contractor_confirmed: { en: "Main contractor confirmed?", ar: "هل تم تأكيد المقاول الرئيسي؟" },
  conv_package_status: { en: "Signage package status", ar: "حالة باقة اللافتات" },
  conv_package_confidence: { en: "Package confidence", ar: "مستوى الثقة في الباقة" },
  conv_reason: { en: "Clear reason to convert now", ar: "سبب واضح للتحويل الآن" },
  conv_yes: { en: "Yes", ar: "نعم" },
  conv_no: { en: "No", ar: "لا" },
  wf_evidence: { en: "Evidence", ar: "الأدلة" },
  wf_notes: { en: "Notes", ar: "ملاحظات" },
  wf_run_automations: { en: "Run Automations", ar: "تشغيل الأتمتة" },
  wf_classification: { en: "Classification", ar: "التصنيف" },
  wf_contractor: { en: "Winning Contractor", ar: "المقاول الفائز" },
  wf_expected_award: { en: "Expected Award", ar: "الترسية المتوقعة" },
  wf_expected_contract: { en: "Expected Contract", ar: "العقد المتوقع" },
  rfq_classification: { en: "Classification", ar: "تصنيف الطلب" },
  rfq_classification_other: { en: "Classification (if \"Other\")", ar: "التصنيف (عند اختيار «آخر»)" },
  rfq_received_date: { en: "Date Request Received", ar: "تاريخ استلام الطلب" },
  rfq_assigned_salesperson: { en: "Assigned Salesperson", ar: "مندوب المبيعات المسؤول" },
  rfq_classification_jih: { en: "JIH", ar: "JIH" },
  rfq_classification_tender: { en: "Tender", ar: "مناقصة" },
  rfq_classification_other_label: { en: "Other", ar: "آخر" },
  wf_contract_value: { en: "Contract Value", ar: "قيمة العقد" },
  wf_contract_ref: { en: "Contract Reference", ar: "مرجع العقد" },
  wf_loss_reason: { en: "Loss Reason", ar: "سبب الخسارة" },
  wf_hold_reason: { en: "Hold Reason", ar: "سبب التعليق" },
  wf_hold_review: { en: "Hold Review Date", ar: "تاريخ مراجعة التعليق" },
  wf_award_contact: { en: "Confirming Person", ar: "الشخص المؤكِّد" },
  wf_award_title: { en: "Their Title", ar: "منصبه" },
  wf_award_method: { en: "Communication Method", ar: "طريقة التواصل" },
  wf_no_records: { en: "Nothing here yet.", ar: "لا شيء هنا بعد." },
  wf_source: { en: "Source", ar: "المصدر" },

  // Award & Contract Queue widgets
  aq_verbal_no_contract: { en: "Verbally Awarded — No Contract", ar: "ترسية شفهية بلا عقد" },
  aq_expected_passed: { en: "Expected Contract Date Passed", ar: "تجاوز تاريخ العقد المتوقع" },
  aq_contracts_received: { en: "Contracts Received — Awaiting Handover", ar: "عقود مستلمة بانتظار التسليم" },
  aq_high_value: { en: "High-Value Awards", ar: "ترسيات عالية القيمة" },

  // Action Required Center
  ac_open_actions: { en: "Open Actions", ar: "الإجراءات المفتوحة" },
  ac_resolve: { en: "Resolve", ar: "إغلاق" },
  ac_add_action: { en: "Add Action", ar: "إضافة إجراء" },
  ac_kind: { en: "Kind", ar: "النوع" },
  ac_reason: { en: "Reason", ar: "السبب" },

  // Sales Action Queue — Sprint 5
  ac_title: { en: "Sales Action Queue", ar: "قائمة إجراءات المبيعات" },
  ac_subtitle: { en: "Every follow-up, review, and gap the daily action engine has surfaced for the team.", ar: "كل متابعة أو مراجعة أو نقص بيانات رصدها محرك الإجراءات اليومي للفريق." },
  ac_tab_active: { en: "Active", ar: "نشطة" },
  ac_tab_completed: { en: "Completed", ar: "مكتملة" },
  ac_tab_dismissed: { en: "Dismissed", ar: "مرفوضة" },
  ac_tab_all: { en: "All", ar: "الكل" },
  ac_kpi_open: { en: "Open items", ar: "بنود مفتوحة" },
  ac_kpi_overdue: { en: "Overdue", ar: "متأخرة" },
  ac_kpi_escalated: { en: "Escalated / Blocked", ar: "مصعّدة / متوقفة" },
  ac_kpi_ai: { en: "AI-generated", ar: "من الذكاء الاصطناعي" },
  ac_owner: { en: "Owner", ar: "المسؤول" },
  ac_unassigned: { en: "Unassigned", ar: "غير مُعيَّن" },
  ac_due: { en: "Due", ar: "الاستحقاق" },
  ac_recommended_action: { en: "Recommended action", ar: "الإجراء الموصى به" },
  ac_ai_badge: { en: "AI", ar: "ذكاء اصطناعي" },
  ac_start: { en: "Start", ar: "بدء" },
  ac_complete: { en: "Complete", ar: "إكمال" },
  ac_dismiss: { en: "Dismiss", ar: "رفض" },
  ac_escalate: { en: "Escalate", ar: "تصعيد" },
  ac_block: { en: "Block", ar: "تعليق" },
  ac_complete_title: { en: "Complete action", ar: "إكمال الإجراء" },
  ac_complete_note: { en: "Note (optional)", ar: "ملاحظة (اختياري)" },
  ac_dismiss_title: { en: "Dismiss action", ar: "رفض الإجراء" },
  ac_dismiss_reason: { en: "Reason (required)", ar: "السبب (مطلوب)" },
  ac_escalate_title: { en: "Escalate action", ar: "تصعيد الإجراء" },
  ac_escalate_note: { en: "Note (optional)", ar: "ملاحظة (اختياري)" },
  ac_block_title: { en: "Mark as blocked", ar: "وسم كمتوقف" },
  ac_block_reason: { en: "Reason (required)", ar: "السبب (مطلوب)" },
  ac_no_active: { en: "No active actions — the queue is clear.", ar: "لا توجد إجراءات نشطة — القائمة فارغة." },

  // Sales Action Queue — status labels
  acst_open: { en: "Open", ar: "مفتوح" },
  acst_in_progress: { en: "In Progress", ar: "قيد التنفيذ" },
  acst_completed: { en: "Completed", ar: "مكتمل" },
  acst_resolved: { en: "Completed", ar: "مكتمل" },
  acst_dismissed: { en: "Dismissed", ar: "مرفوض" },
  acst_escalated: { en: "Escalated", ar: "مُصعَّد" },
  acst_blocked: { en: "Blocked", ar: "متوقف" },

  // Sales Action Queue — type labels
  acty_follow_up_due: { en: "Follow-up Due", ar: "متابعة مستحقة" },
  acty_follow_up_overdue: { en: "Follow-up Overdue", ar: "متابعة متأخرة" },
  acty_missing_data: { en: "Missing Data", ar: "بيانات ناقصة" },
  acty_rfq_review_needed: { en: "RFQ Review Needed", ar: "مراجعة طلب عرض سعر" },
  acty_tender_review_needed: { en: "Tender Review Needed", ar: "مراجعة مناقصة" },
  acty_approval_needed: { en: "Approval Needed", ar: "اعتماد مطلوب" },
  acty_quotation_follow_up: { en: "Quotation Follow-up", ar: "متابعة عرض سعر" },
  acty_no_next_action: { en: "No Next Action", ar: "بلا إجراء تالٍ" },
  acty_inactive_tier_a_opportunity: { en: "Inactive Tier A Opportunity", ar: "فرصة طبقة أ خاملة" },
  acty_contract_evidence_missing: { en: "Contract Evidence Missing", ar: "دليل عقد ناقص" },
  acty_submission_pending_on: { en: "Submission waiting on you", ar: "تسليم بانتظارك" },

  // Sales Action Queue — related record type labels
  acrt_opportunity: { en: "Opportunity", ar: "فرصة" },
  acrt_rfq: { en: "RFQ", ar: "طلب عرض سعر" },
  acrt_tender: { en: "Tender", ar: "مناقصة" },
  acrt_approval: { en: "Approval", ar: "اعتماد" },
  acrt_quotation: { en: "Quotation", ar: "عرض سعر" },

  // Tender Conversion Review
  tc_pending_reviews: { en: "Pending Conversion Reviews", ar: "مراجعات التحويل المعلّقة" },
  tc_no_reviews: { en: "No tender conversions awaiting review.", ar: "لا توجد تحويلات مناقصات بانتظار المراجعة." },
  tc_approve: { en: "Approve & Create JIH", ar: "اعتماد وإنشاء فرصة" },

  // Lead & Tender Inbox — Sprint 3
  ibx_title: { en: "Lead & Tender Inbox", ar: "صندوق العملاء والمناقصات" },
  ibx_intro: { en: "Every new sales input lands here first — nothing becomes a CRM record without review.", ar: "كل مُدخل مبيعات جديد يوصل هنا أولاً — ولا يتحول لسجل CRM بدون مراجعة." },
  ibx_new_item: { en: "New Intake", ar: "إدخال جديد" },
  ibx_source_type: { en: "Source Type", ar: "نوع المصدر" },
  ibx_source_name: { en: "Source Name", ar: "اسم المصدر" },
  ibx_company_name: { en: "Company Name", ar: "اسم الشركة" },
  ibx_contact_name: { en: "Contact Name", ar: "اسم جهة الاتصال" },
  ibx_client_owner: { en: "Client / Owner", ar: "العميل / المالك" },
  ibx_consultant: { en: "Consultant", ar: "الاستشاري" },
  ibx_scope: { en: "Scope notes", ar: "وصف النطاق" },
  ibx_estimated_value: { en: "Estimated Value", ar: "القيمة التقديرية" },
  ibx_deadline: { en: "Deadline", ar: "الموعد النهائي" },
  ibx_evidence_url: { en: "Evidence URL / Attachment", ar: "رابط الدليل / المرفق" },
  doc_files: { en: "Files", ar: "الملفات" },
  doc_documents: { en: "Documents", ar: "المستندات" },
  doc_photos: { en: "Photos", ar: "الصور" },
  doc_upload: { en: "Upload", ar: "رفع ملف" },
  doc_uploading: { en: "Uploading…", ar: "جارٍ الرفع…" },
  doc_uploaded: { en: "File uploaded", ar: "تم رفع الملف" },
  doc_deleted: { en: "File removed", ar: "أُزيل الملف" },
  doc_unlinked: { en: "File detached from this record", ar: "فُصل الملف عن هذا السجل" },
  doc_none: { en: "No files yet", ar: "لا ملفات بعد" },
  doc_none_hint: {
    en: "Upload a BOQ, a drawing, a signed contract or a site photo. Files attached here are visible to whoever can see this record.",
    ar: "ارفع BOQ أو مخططًا أو عقدًا موقّعًا أو صورة موقع. الملفات المرفقة هنا يراها من يرى هذا السجل.",
  },
  doc_count: { en: "{n} file(s)", ar: "{n} ملف" },
  doc_versions: { en: "Versions", ar: "الإصدارات" },
  doc_supersede: { en: "Replace with a new version", ar: "استبدال بإصدار جديد" },
  doc_replacing: { en: "Next upload replaces the selected file", ar: "الرفع القادم يستبدل الملف المحدد" },
  doc_superseded: { en: "Replaced by a newer version", ar: "استُبدل بإصدار أحدث" },
  doc_single_version: { en: "Only one version", ar: "إصدار واحد فقط" },
  doc_this_one: { en: "current", ar: "الحالي" },
  doc_unlink: { en: "Detach from this record", ar: "فصل عن هذا السجل" },
  doc_delete: { en: "Remove", ar: "إزالة" },
  doc_title_placeholder: { en: "Title (optional)", ar: "عنوان (اختياري)" },
  doc_err_file_too_large: { en: "File is larger than 25MB.", ar: "حجم الملف يتجاوز 25 ميغابايت." },
  doc_err_file_type_not_allowed: { en: "That file type is not accepted.", ar: "نوع الملف غير مقبول." },
  attachment_unavailable: {
    en: "This attachment could not be opened — the file is missing or you do not have access.",
    ar: "تعذّر فتح المرفق — الملف غير موجود أو لا تملك صلاحية الوصول إليه.",
  },
  ibx_assigned_owner: { en: "Assigned Owner", ar: "المسؤول المعيّن" },
  ibx_follow_up_date: { en: "Follow-up Date", ar: "تاريخ المتابعة" },
  ibx_classify: { en: "Classify", ar: "تصنيف" },
  ibx_convert: { en: "Convert", ar: "تحويل" },
  ibx_create_opportunity_candidate: { en: "Create Opportunity Candidate", ar: "إنشاء فرصة مرشحة" },
  ibx_send_missing_data: { en: "Send to Missing Data", ar: "إرسال لبيانات ناقصة" },
  ibx_mark_duplicate: { en: "Mark Duplicate", ar: "وسم كمكرر" },
  ibx_archive: { en: "Archive", ar: "أرشفة" },
  ibx_archive_reason: { en: "Archive Reason", ar: "سبب الأرشفة" },
  ibx_missing_data_reason: { en: "What's missing?", ar: "ما الناقص؟" },
  ibx_duplicate_of: { en: "Duplicate of", ar: "مكرر لـ" },
  ibx_duplicates_found: { en: "Possible duplicates found — review before creating", ar: "احتمال وجود تكرار — راجع قبل الإنشاء" },
  ibx_no_duplicates: { en: "No likely duplicates found.", ar: "لا يوجد تكرار محتمل." },
  ibx_checking_duplicates: { en: "Checking for duplicates…", ar: "جارٍ التحقق من التكرار…" },
  ibx_no_source: { en: "Every item must have a source.", ar: "كل عنصر لازم يكون له مصدر." },
  label_owner: { en: "Owner", ar: "المسؤول" },

  // Inbox source types
  src_manual_lead: { en: "Manual Lead", ar: "عميل محتمل يدوي" },
  src_manual_tender: { en: "Manual Tender", ar: "مناقصة يدوية" },
  src_manual_rfq: { en: "Manual RFQ", ar: "طلب عرض سعر يدوي" },
  src_old_data_candidate: { en: "Old Data Candidate", ar: "مرشح بيانات قديمة" },
  src_referral: { en: "Referral", ar: "إحالة" },
  src_market_signal: { en: "Market Signal", ar: "إشارة سوق" },
  src_email_placeholder: { en: "Email (coming soon)", ar: "بريد إلكتروني (قريبًا)" },
  src_whatsapp_placeholder: { en: "WhatsApp (coming soon)", ar: "واتساب (قريبًا)" },

  // Inbox classifications
  cls_unclassified: { en: "Unclassified", ar: "غير مصنّف" },
  cls_company: { en: "Company", ar: "شركة" },
  cls_contact: { en: "Contact", ar: "جهة اتصال" },
  cls_project: { en: "Project", ar: "مشروع" },
  cls_rfq: { en: "RFQ", ar: "طلب عرض سعر" },
  cls_tender: { en: "Tender", ar: "مناقصة" },
  cls_opportunity_candidate: { en: "Opportunity Candidate", ar: "فرصة مرشحة" },
  cls_signal_watchlist: { en: "Signal / Watchlist", ar: "إشارة / متابعة" },
  cls_duplicate: { en: "Duplicate", ar: "مكرر" },
  cls_incomplete: { en: "Incomplete", ar: "غير مكتمل" },

  // Inbox statuses
  ibxst_new: { en: "New", ar: "جديد" },
  ibxst_in_review: { en: "In Review", ar: "قيد المراجعة" },
  ibxst_converted: { en: "Converted", ar: "تم التحويل" },
  ibxst_sent_to_missing_data: { en: "Missing Data", ar: "بيانات ناقصة" },
  ibxst_marked_duplicate: { en: "Duplicate", ar: "مكرر" },
  ibxst_archived: { en: "Archived", ar: "مؤرشف" },

  // CRM — shared
  crm_add: { en: "Add", ar: "إضافة" },
  crm_new_account: { en: "New Account", ar: "حساب جديد" },
  crm_new_contact: { en: "New Contact", ar: "جهة اتصال جديدة" },
  crm_new_project: { en: "New Project", ar: "مشروع جديد" },
  crm_pending_review: { en: "Pending Review", ar: "بانتظار المراجعة" },
  crm_pending_verification: { en: "Pending Verification", ar: "بانتظار التحقق" },
  crm_verified: { en: "Verified", ar: "مُتحقَّق" },
  crm_account_owner: { en: "Account Owner", ar: "مسؤول الحساب" },
  crm_unassigned: { en: "Unassigned", ar: "غير مُعيَّن" },
  crm_last_contact: { en: "Last Contact", ar: "آخر تواصل" },
  crm_next_action: { en: "Next Action", ar: "الإجراء التالي" },
  crm_relationship: { en: "Relationship", ar: "مستوى العلاقة" },
  crm_regions: { en: "Regions", ar: "المناطق" },
  crm_sector: { en: "Sector", ar: "القطاع" },
  crm_location: { en: "Location", ar: "الموقع" },
  crm_title: { en: "Job Title", ar: "المسمى الوظيفي" },
  crm_authority: { en: "Authority", ar: "مستوى القرار" },
  crm_confidence: { en: "Confidence", ar: "مستوى الثقة" },
  confidence_high: { en: "High", ar: "عالية" },
  confidence_medium: { en: "Medium", ar: "متوسطة" },
  confidence_low: { en: "Low", ar: "منخفضة" },
  crm_phone: { en: "Phone", ar: "الجوال" },
  crm_email: { en: "Email", ar: "البريد" },
  crm_website: { en: "Website", ar: "الموقع الإلكتروني" },
  crm_company: { en: "Company", ar: "الشركة" },
  crm_project_stage: { en: "Project Stage", ar: "مرحلة المشروع" },
  crm_completion: { en: "Completion", ar: "نسبة الإنجاز" },
  crm_signage_package: { en: "Signage Package", ar: "بكج اللوحات" },
  crm_accounts_intro: { en: "Every client, contractor, and consultant in one place.", ar: "كل عميل ومقاول واستشاري في مكان واحد." },
  crm_search_accounts: { en: "Search accounts…", ar: "البحث في الحسابات…" },
  crm_search_contacts: { en: "Search contacts…", ar: "البحث في جهات الاتصال…" },
  crm_search_projects: { en: "Search projects…", ar: "البحث في المشاريع…" },
  crm_expected_boq: { en: "Expected BOQ", ar: "BOQ المتوقع" },
  crm_expected_signage: { en: "Expected Signage Date", ar: "تاريخ اللوحات المتوقع" },
  crm_source_confidence: { en: "Source Confidence", ar: "موثوقية المصدر" },
  crm_page_of: { en: "Page", ar: "صفحة" },
  crm_main_contractor: { en: "Main Contractor", ar: "المقاول الرئيسي" },
  crm_total_value: { en: "Total Value", ar: "القيمة الإجمالية" },
  crm_no_accounts: { en: "No accounts yet. Add your first target account.", ar: "لا توجد حسابات بعد. أضف أول حساب مستهدف." },
  crm_no_contacts: { en: "No contacts yet.", ar: "لا توجد جهات اتصال بعد." },
  crm_no_projects: { en: "No projects yet.", ar: "لا توجد مشاريع بعد." },
  crm_internal_notes: { en: "Internal Notes", ar: "ملاحظات داخلية" },
  crm_additional_data: { en: "Additional Data", ar: "بيانات إضافية" },
  crm_linked_projects: { en: "Linked Projects", ar: "المشاريع المرتبطة" },
  crm_linked_contacts: { en: "Contacts", ar: "جهات الاتصال" },
  crm_linked_opportunities: { en: "Opportunities", ar: "الفرص" },
  crm_new_opportunity: { en: "New Opportunity", ar: "فرصة جديدة" },
  crm_multi_contractor_hint: { en: "Multiple contractors are competing on this project — each opportunity below tracks its own stage, package status, and BOQ independently.", ar: "عدّة مقاولين يتنافسون على هذا المشروع — كل فرصة أدناه تتبّع مرحلتها وحالة الباكج والـ BOQ الخاصة بها بشكل مستقل." },
  crm_no_contractor: { en: "No contractor", ar: "بلا مقاول" },
  crm_package: { en: "Package", ar: "الباكج" },
  crm_boq: { en: "BOQ", ar: "BOQ" },
  crm_saved: { en: "Saved", ar: "تم الحفظ" },
  crm_filter_all_types: { en: "All Types", ar: "كل الأنواع" },

  // Company types
  company_type_main_contractor: { en: "Main Contractor", ar: "مقاول رئيسي" },
  company_type_developer: { en: "Developer", ar: "مطوّر" },
  company_type_owner: { en: "Owner", ar: "مالك" },
  company_type_consultant: { en: "Consultant", ar: "استشاري" },
  company_type_existing_client: { en: "Existing Client", ar: "عميل حالي" },
  company_type_previous_client: { en: "Previous Client", ar: "عميل سابق" },
  company_type_target_account: { en: "Target Account", ar: "حساب مستهدف" },
  company_type_vendor: { en: "Vendor", ar: "مورّد" },
  company_type_do_not_target: { en: "Do Not Target", ar: "غير مستهدف" },

  // Account status
  account_status_pending_review: { en: "Pending Review", ar: "بانتظار المراجعة" },
  account_status_active: { en: "Active", ar: "نشط" },
  account_status_dormant: { en: "Dormant", ar: "خامل" },
  account_status_do_not_target: { en: "Do Not Target", ar: "غير مستهدف" },
  crm_mark_active: { en: "Mark Active", ar: "تفعيل" },
  crm_reassign_owner: { en: "Reassign Owner", ar: "تغيير المسؤول" },
  crm_manager_only: { en: "Managers only", ar: "المدراء فقط" },
  crm_edit: { en: "Edit", ar: "تعديل" },
  crm_back_to_accounts: { en: "Back to Accounts", ar: "العودة للحسابات" },

  // Record lifecycle (archive / unarchive / request delete / mark duplicate)
  lifecycle_menu_label: { en: "More actions", ar: "إجراءات إضافية" },
  lifecycle_archive: { en: "Archive", ar: "أرشفة" },
  lifecycle_archive_desc: { en: "Hide this record from active views. It can be restored later.", ar: "إخفاء هذا السجل من العروض النشطة. يمكن استعادته لاحقًا." },
  lifecycle_reason_optional: { en: "Reason (optional)", ar: "السبب (اختياري)" },
  lifecycle_archived_toast: { en: "Archived", ar: "تمت الأرشفة" },
  lifecycle_archived_badge: { en: "Archived", ar: "مؤرشف" },
  lifecycle_unarchive: { en: "Unarchive", ar: "إلغاء الأرشفة" },
  lifecycle_unarchive_desc: { en: "Restore this record to active views.", ar: "استعادة هذا السجل إلى العروض النشطة." },
  lifecycle_unarchived_toast: { en: "Restored from archive", ar: "تمت الاستعادة من الأرشيف" },
  lifecycle_include_archived: { en: "Include archived", ar: "تضمين المؤرشف" },
  lifecycle_request_delete: { en: "Request Delete", ar: "طلب حذف" },
  lifecycle_request_delete_desc: { en: "Sends this to a commercial manager for approval. Nothing is deleted until a manager approves and a system admin executes it.", ar: "يُرسل هذا لمدير تجاري للموافقة. لن يُحذف شيء حتى يوافق المدير وينفّذه مسؤول النظام." },
  lifecycle_reason_required: { en: "Reason (required)", ar: "السبب (مطلوب)" },
  lifecycle_delete_requested_toast: { en: "Delete request submitted for approval", ar: "تم إرسال طلب الحذف للموافقة" },
  lifecycle_mark_duplicate: { en: "Mark Duplicate", ar: "وضع علامة تكرار" },
  lifecycle_mark_duplicate_desc: { en: "Flags this record as a likely duplicate for a manager to review. No data is merged automatically.", ar: "يضع علامة على هذا السجل كتكرار محتمل ليراجعه مدير. لا يتم دمج أي بيانات تلقائيًا." },
  lifecycle_duplicate_of_id: { en: "Duplicate of (record ID)", ar: "مكرر لـ (معرّف السجل)" },
  lifecycle_duplicate_flagged_toast: { en: "Marked as duplicate", ar: "تم وضع علامة التكرار" },
  lifecycle_execute_delete: { en: "Execute Delete", ar: "تنفيذ الحذف" },
  lifecycle_execute_delete_desc: { en: "This permanently deletes the linked record. This cannot be undone.", ar: "سيؤدي هذا إلى حذف السجل المرتبط نهائيًا. لا يمكن التراجع عن هذا." },
  lifecycle_executed_toast: { en: "Record deleted", ar: "تم حذف السجل" },

  // Contact authority
  authority_decision_maker: { en: "Decision Maker", ar: "صاحب القرار" },
  authority_influencer: { en: "Influencer", ar: "مؤثّر" },
  authority_technical_contact: { en: "Technical Contact", ar: "جهة فنية" },
  authority_unknown_authority: { en: "Unknown Authority", ar: "غير محدد" },
  location_site_office: { en: "Site Office", ar: "مكتب الموقع" },
  location_head_office: { en: "Head Office", ar: "المكتب الرئيسي" },
  location_unknown: { en: "Unknown", ar: "غير معروف" },

  // Intake — client type / project type / RFQ from
  ibx_client_type: { en: "Client Type", ar: "نوع العميل" },
  ibx_client_type_main_client: { en: "Main Client", ar: "العميل الرئيسي" },
  ibx_client_type_contractor_jih: { en: "Contractor (JIH)", ar: "مقاول (JIH)" },
  ibx_client_type_contractor_tender: { en: "Contractor (Tender)", ar: "مقاول (منافسة)" },
  ibx_client_type_consultant: { en: "Consultant", ar: "استشاري" },
  ibx_project_type: { en: "Project Type", ar: "نوع المشروع" },
  ibx_project_type_jih: { en: "JIH", ar: "JIH" },
  ibx_project_type_tender: { en: "Tender", ar: "منافسة" },
  ibx_project_number: { en: "Project Number", ar: "رقم المشروع" },
  ibx_rfq_from: { en: "RFQ From", ar: "طلب عرض السعر من" },
  ibx_rfq_from_owner_developer: { en: "Owner / Developer", ar: "المالك / المطوّر" },
  ibx_rfq_from_main_contractor: { en: "Main Contractor", ar: "المقاول الرئيسي" },
  ibx_rfq_from_consultant: { en: "Consultant", ar: "استشاري" },
  ibx_date_received: { en: "Date Received", ar: "تاريخ الاستلام" },
  // Intake — scope (fixed vocabulary, replaces free-text scope textarea)
  ibx_scope_type: { en: "Scope of work", ar: "نطاق العمل" },
  ibx_scope_supply_and_installation: { en: "Supply and Installation of Signage", ar: "توريد وتركيب اللوحات" },
  ibx_scope_supply_only_signage: { en: "Supply Only - Signage", ar: "توريد فقط - لوحات" },
  ibx_scope_supply_installation_others: { en: "Supply of Installation (Others)", ar: "توريد التركيب (أخرى)" },
  ibx_scope_supply_only_others: { en: "Supply Only (Others)", ar: "توريد فقط (أخرى)" },
  ibx_scope_mockup_sample_request: { en: "Mock-up Sample Request", ar: "طلب عينة نموذجية" },
  ibx_scope_installation_only: { en: "Installation Only", ar: "تركيب فقط" },
  // Intake — location (fixed vocabulary, replaces free-text location input)
  ibx_location_city: { en: "Project Location", ar: "موقع المشروع" },
  ibx_location_riyadh: { en: "Riyadh", ar: "الرياض" },
  ibx_location_jeddah: { en: "Jeddah", ar: "جدة" },
  ibx_location_makkah: { en: "Makkah", ar: "مكة المكرمة" },
  ibx_location_madinah: { en: "Madinah", ar: "المدينة المنورة" },
  ibx_location_dammam: { en: "Dammam", ar: "الدمام" },
  ibx_location_al_khobar: { en: "Al Khobar", ar: "الخبر" },
  ibx_location_dhahran: { en: "Dhahran", ar: "الظهران" },
  ibx_location_jubail: { en: "Jubail", ar: "الجبيل" },
  ibx_location_taif: { en: "Taif", ar: "الطائف" },
  ibx_location_tabuk: { en: "Tabuk", ar: "تبوك" },
  ibx_location_abha: { en: "Abha", ar: "أبها" },
  ibx_location_yanbu: { en: "Yanbu", ar: "ينبع" },
  ibx_location_jazan: { en: "Jazan", ar: "جازان" },
  ibx_location_buraydah: { en: "Buraydah", ar: "بريدة" },
  ibx_location_hail: { en: "Hail", ar: "حائل" },

  // My Workspace
  ws_title: { en: "My Workspace", ar: "مساحة عملي" },
  ws_my_targets: { en: "My Targets", ar: "أهدافي" },
  ws_target_sales: { en: "Sales", ar: "المبيعات" },
  ws_target_pipeline: { en: "Pipeline", ar: "الفرص" },
  ws_target_quotations: { en: "Quotations", ar: "العروض" },
  ws_target_activities: { en: "Activities", ar: "الأنشطة" },
  ws_my_accounts: { en: "My Accounts", ar: "حساباتي" },
  ws_open_opportunities: { en: "Open Opportunities", ar: "الفرص المفتوحة" },
  ws_overdue_followups: { en: "Overdue Follow-ups", ar: "المتابعات المتأخرة" },
  ws_tasks_today: { en: "Tasks Today", ar: "مهام اليوم" },
  ws_recent_activity: { en: "Recent Activity", ar: "النشاط الأخير" },
  ws_no_target: { en: "No target set for this period.", ar: "لا يوجد هدف محدد لهذه الفترة." },
  ws_none: { en: "Nothing here.", ar: "لا شيء هنا." },
  ws_log_activity: { en: "Log Activity", ar: "تسجيل نشاط" },
  ws_of: { en: "of", ar: "من" },
  ws_today_followups: { en: "Today follow-ups", ar: "متابعات اليوم" },
  ws_tier_a_opportunities: { en: "My Tier A opportunities", ar: "فرصي من الفئة A" },
  ws_my_rfqs: { en: "My RFQs", ar: "طلبات عروض أسعاري" },
  ws_my_tenders: { en: "My tenders", ar: "مناقصاتي" },
  ws_missing_data: { en: "Missing data tasks", ar: "مهام بيانات ناقصة" },
  ws_target_snapshot: { en: "Target Snapshot", ar: "لمحة الأهداف" },
  ws_target_reactivation: { en: "Reactivation", ar: "إعادة التنشيط" },
  ws_actual_not_tracked: { en: "Actuals not tracked yet", ar: "لم يُحتسب الفعلي بعد" },
  ws_rfqs_open: { en: "open", ar: "مفتوح" },
  ws_tenders_active: { en: "active", ar: "نشطة" },
  ws_awarded_value: { en: "Awarded Value", ar: "قيمة الترسيات" },
  ws_achievement_pct: { en: "Achievement", ar: "نسبة الإنجاز" },
  ws_jih_summary: { en: "JIH Pipeline", ar: "فرص قائمة" },
  ws_urgent_quotations: { en: "Urgent Quotations", ar: "عروض أسعار عاجلة" },
  ws_quotation_due: { en: "Submission Due", ar: "موعد تقديم العرض" },
  ws_new_rfq: { en: "New RFQ", ar: "طلب عرض سعر" },
  ws_rfq_step1: { en: "Company & Contact", ar: "الشركة وجهة الاتصال" },
  ws_rfq_step2: { en: "RFQ Details", ar: "تفاصيل الطلب" },
  ws_rfq_company: { en: "Company Name", ar: "اسم الشركة" },
  ws_rfq_contact: { en: "Contact Name", ar: "اسم جهة الاتصال" },
  ws_rfq_contact_phone: { en: "Phone", ar: "الجوال" },
  ws_rfq_project: { en: "Project / Scope", ar: "المشروع / النطاق" },
  ws_rfq_due: { en: "Response Due Date", ar: "الموعد النهائي للرد" },
  ws_rfq_value: { en: "Estimated Value (SAR)", ar: "القيمة التقديرية (ريال)" },
  ws_rfq_created: { en: "RFQ created and follow-up scheduled.", ar: "تم إنشاء طلب العرض وجدولة المتابعة." },
  ws_dedup_found: { en: "Existing contact found — linked.", ar: "تم العثور على جهة الاتصال وربطها." },

  // Activity types
  activity_type_call: { en: "Call", ar: "مكالمة" },
  activity_type_visit: { en: "Visit", ar: "زيارة" },
  activity_type_meeting: { en: "Meeting", ar: "اجتماع" },
  activity_type_email_draft: { en: "Email Draft", ar: "مسودة إيميل" },
  activity_type_whatsapp_draft: { en: "WhatsApp Draft", ar: "مسودة واتساب" },
  activity_type_note: { en: "Note", ar: "ملاحظة" },
  activity_summary: { en: "Summary", ar: "الملخص" },
  activity_draft_body: { en: "Draft Body", ar: "نص المسودة" },
  pipeline_step_label: { en: "Pipeline Step", ar: "خطوة المسار" },

  // Lead Intake (Project Radar)
  lead_intake_title: { en: "Lead Intake Queue", ar: "طابور الفرص الواردة" },
  lead_intake_hint: { en: "Raw leads qualified step-by-step. A lead never becomes an opportunity automatically — a human decides.", ar: "فرص خام تُؤهَّل خطوة بخطوة. لا يتحول Lead إلى فرصة تلقائيًا — القرار بشري." },
  lead_new: { en: "New Lead", ar: "فرصة جديدة" },
  lead_source: { en: "Source", ar: "المصدر" },
  lead_score: { en: "Score", ar: "التقييم" },
  lead_advance: { en: "Advance", ar: "تقديم" },
  lead_reject: { en: "Reject", ar: "رفض" },
  lead_convert: { en: "Convert to Opportunity", ar: "تحويل لفرصة" },
  lead_reject_reason: { en: "Rejection Reason", ar: "سبب الرفض" },
  lead_no_leads: { en: "No leads in the queue.", ar: "لا توجد فرص في الطابور." },
  lead_converted_badge: { en: "Converted", ar: "مُحوَّلة" },
  lead_est_value: { en: "Est. Value", ar: "القيمة التقديرية" },

  // Vendors
  vendor_new: { en: "New Vendor", ar: "مورّد جديد" },
  vendor_scope: { en: "Scope", ar: "النطاق" },
  vendor_materials: { en: "Materials / Services", ar: "المواد / الخدمات" },
  vendor_lead_time: { en: "Lead Time", ar: "مدة التوريد" },
  vendor_quality: { en: "Quality", ar: "الجودة" },
  vendor_contact: { en: "Contact", ar: "التواصل" },
  vendor_portal: { en: "Portal", ar: "البوابة" },
  vendor_ref_prices: { en: "Reference Prices", ar: "الأسعار المرجعية" },
  vendor_rating: { en: "Internal Rating", ar: "التقييم الداخلي" },
  vendor_sensitive_hidden: { en: "Sensitive fields (prices, ratings) are visible to managers only.", ar: "الحقول الحساسة (الأسعار، التقييمات) تظهر للمدراء فقط." },
  vendor_no_vendors: { en: "No vendors yet.", ar: "لا يوجد موردون بعد." },

  // Reference Library
  ref_new: { en: "Add Reference Project", ar: "إضافة مشروع مرجعي" },
  ref_search: { en: "Search reference projects…", ar: "ابحث في المشاريع المرجعية…" },
  ref_type: { en: "Type", ar: "النوع" },
  ref_year: { en: "Year", ar: "السنة" },
  ref_scope: { en: "PHC Scope", ar: "نطاق PHC" },
  ref_sign_types: { en: "Sign Types", ar: "أنواع اللوحات" },
  ref_challenges: { en: "Challenges", ar: "التحديات" },
  ref_solutions: { en: "Solutions", ar: "الحلول" },
  ref_shareable: { en: "Shareable with client", ar: "قابل للمشاركة مع العميل" },
  ref_needs_approval: { en: "Needs approval to share", ar: "يحتاج موافقة للمشاركة" },
  ref_no_projects: { en: "No reference projects yet.", ar: "لا توجد مشاريع مرجعية بعد." },

  // AI recommendations (8-field structure)
  rec_title: { en: "AI Recommendations", ar: "توصيات الذكاء الاصطناعي" },
  rec_recommendation: { en: "Recommendation", ar: "التوصية" },
  rec_reason: { en: "Reason", ar: "السبب" },
  rec_evidence: { en: "Evidence", ar: "الأدلة" },
  rec_data_sources: { en: "Data Sources", ar: "مصادر البيانات" },
  rec_confidence: { en: "Confidence", ar: "مستوى الثقة" },
  rec_risk_notes: { en: "Risk Notes", ar: "ملاحظات المخاطر" },
  rec_suggested_owner: { en: "Suggested Owner", ar: "المسؤول المقترح" },
  rec_required_approval: { en: "Required Approval", ar: "الموافقة المطلوبة" },
  rec_accept: { en: "Accept", ar: "قبول" },
  rec_dismiss: { en: "Dismiss", ar: "تجاهل" },
  rec_none: { en: "No open recommendations.", ar: "لا توجد توصيات مفتوحة." },
  rec_disclaimer: { en: "AI suggests. A human decides.", ar: "الذكاء الاصطناعي يقترح، والإنسان يقرر." },

  // Approval types (section 11)
  approval_type_lead: { en: "Lead Approval", ar: "اعتماد فرصة" },
  approval_type_outreach: { en: "Outreach Approval", ar: "اعتماد تواصل" },
  approval_type_boq: { en: "BOQ Approval", ar: "اعتماد BOQ" },
  approval_type_quotation: { en: "Quotation Approval", ar: "اعتماد عرض سعر" },
  approval_type_discount: { en: "Discount Approval", ar: "اعتماد خصم" },
  approval_type_tender: { en: "Tender Approval", ar: "اعتماد مناقصة" },
  approval_type_contract: { en: "Contract Approval", ar: "اعتماد عقد" },
  approval_type_won_lost: { en: "Won / Lost Approval", ar: "اعتماد ربح/خسارة" },
  approval_type_account_ownership: { en: "Account Ownership Change", ar: "تغيير ملكية حساب" },

  // Knowledge Search (RAG)
  knowledge_title: { en: "Knowledge Search", ar: "البحث المعرفي" },
  knowledge_hint: { en: "Semantic search across PHC reference projects and past work.", ar: "بحث دلالي في مشاريع PHC المرجعية والأعمال السابقة." },
  knowledge_placeholder: { en: "e.g. exterior wayfinding for a hospital in Riyadh…", ar: "مثال: لوحات إرشادية خارجية لمستشفى في الرياض…" },
  knowledge_search_btn: { en: "Search", ar: "بحث" },
  knowledge_reindex: { en: "Reindex Library", ar: "إعادة فهرسة المكتبة" },
  knowledge_no_results: { en: "No matches. Try a different query, or reindex the library.", ar: "لا نتائج. جرّب صياغة أخرى أو أعد فهرسة المكتبة." },
  knowledge_similarity: { en: "match", ar: "تطابق" },
  knowledge_reindexed: { en: "Reindexed", ar: "تمت الفهرسة" },
  knowledge_empty_hint: { en: "Enter a query to search past projects and knowledge.", ar: "اكتب استعلامًا للبحث في المشاريع والمعرفة السابقة." },
  knowledge_disclaimer: { en: "Retrieved from your internal reference library. Always verify with the source document.", ar: "مستخرج من مكتبتك المرجعية الداخلية. تحقق دائمًا من المصدر الأصلي." },
  knowledge_results_hint: { en: "Search returns evidence with a relevance score. Sources remain inspectable.", ar: "يعرض البحث نتائج مع درجة صلة. المصادر قابلة للفحص." },
  knowledge_results_count_one: { en: "result for", ar: "نتيجة لـ" },
  knowledge_results_count_many: { en: "results for", ar: "نتائج لـ" },

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

  // Sales funnel (dashboard)
  funnel_title: { en: "Sales Funnel", ar: "قِمع المبيعات" },
  funnel_new_rfq: { en: "New RFQ", ar: "طلبات عروض جديدة" },
  funnel_still_tendering: { en: "Still Tendering", ar: "مناقصات قيد الإجراء" },
  funnel_tender_negotiation: { en: "Tender Negotiation", ar: "تفاوض الترسية" },
  funnel_jih_awarded: { en: "JIH Awarded — Negotiation", ar: "ترسية على المقاول" },
  funnel_jih_final: { en: "JIH Final Negotiation", ar: "التفاوض النهائي" },

  // Actions (fixed vocabulary)
  action_review: { en: "Review", ar: "مراجعة" },
  action_approve: { en: "Approve", ar: "اعتماد" },
  action_accept: { en: "Accept", ar: "قبول" },
  action_reject: { en: "Reject", ar: "رفض" },
  action_return: { en: "Return for Revision", ar: "إعادة للتعديل" },
  action_assign: { en: "Assign Owner", ar: "تعيين المسؤول" },
  action_schedule: { en: "Schedule Follow-up", ar: "جدولة متابعة" },
  action_escalate: { en: "Escalate", ar: "تصعيد" },
  action_complete: { en: "Mark Complete", ar: "إتمام" },
  action_archive: { en: "Archive", ar: "أرشفة" },
  action_view_evidence: { en: "View Evidence", ar: "عرض الأدلة" },
  action_save: { en: "Save", ar: "حفظ" },

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
  // Single-record context. The approvals *list* string above was being reused
  // on an individual opportunity's detail page, where "No opportunities are
  // awaiting approval" reads as a statement about the whole pipeline rather
  // than about the record on screen (QA 2026-08-10 ISSUE-007).
  empty_approvals_record: {
    en: "This opportunity has no approval requests yet.",
    ar: "لا توجد طلبات اعتماد على هذه الفرصة حتى الآن.",
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
  label_phone: { en: "Phone", ar: "الهاتف" },
  password: { en: "Password", ar: "كلمة المرور" },
  full_name: { en: "Full name", ar: "الاسم الكامل" },
  sign_in: { en: "Sign in", ar: "تسجيل الدخول" },
  create_account: { en: "Create account", ar: "إنشاء حساب" },
  have_account: { en: "Already have an account? Sign in", ar: "لديك حساب؟ سجّل الدخول" },
  no_account: { en: "New here? Create an account", ar: "مستخدم جديد؟ أنشئ حساباً" },

  // Discussion
  section_discussion: { en: "Discussion", ar: "النقاش" },
  discussion_placeholder: { en: "Post an update…", ar: "اكتب تحديثًا…" },
  discussion_post: { en: "Post Update", ar: "نشر التحديث" },
  discussion_person_in_charge: { en: "Person in Charge", ar: "الشخص المسؤول" },
  discussion_pic_note: { en: "Note from Person in Charge", ar: "ملاحظة الشخص المسؤول" },
  discussion_empty: { en: "No updates yet — be the first to post one.", ar: "لا توجد تحديثات بعد — كن أول من ينشر تحديثًا." },
  discussion_forbidden: { en: "Discussion is limited to General Manager, Sales Manager, Development Manager, and System Administrator.", ar: "النقاش متاح فقط للمدير العام ومدير المبيعات ومدير التطوير ومدير النظام." },
  discussion_posted_toast: { en: "Update posted", ar: "تم نشر التحديث" },
  discussion_none: { en: "None", ar: "لا يوجد" },
  discussion_delete: { en: "Delete", ar: "حذف" },
  discussion_mention_person: { en: "Mention someone (optional)", ar: "منشن شخص (اختياري)" },
  discussion_mention_purpose: { en: "Purpose", ar: "الغرض" },
  discussion_mention_review: { en: "Review", ar: "مراجعة" },
  discussion_mention_approval: { en: "Approval", ar: "موافقة" },
  discussion_mention_endorsement: { en: "Endorsement", ar: "اعتماد" },

  // Assignment (simplified single card)
  section_assignment: { en: "Assignment", ar: "الإسناد" },
  assignment_client_contact: { en: "Client Contact", ar: "جهة اتصال العميل" },
  assignment_primary_person: { en: "Primary Person", ar: "الشخص الأساسي" },
  assignment_person_in_charge: { en: "Person in Charge", ar: "الشخص المسؤول" },
  assignment_pic_note: { en: "Note", ar: "ملاحظة" },
  assignment_set_pic: { en: "Set Person in Charge", ar: "تحديد الشخص المسؤول" },
  assignment_unassigned: { en: "Unassigned", ar: "غير مُعيَّن" },

  // Evidence file upload
  evidence_upload_button: { en: "Add File", ar: "إضافة ملف" },
  evidence_uploading: { en: "Uploading…", ar: "جارٍ الرفع…" },
  evidence_upload_success: { en: "File uploaded", ar: "تم رفع الملف" },
  evidence_upload_error_size: { en: "File is larger than 25 MB.", ar: "حجم الملف أكبر من 25 ميجابايت." },
  evidence_upload_error_type: { en: "This file type isn't allowed.", ar: "نوع هذا الملف غير مسموح به." },
  evidence_download: { en: "Download", ar: "تنزيل" },

  // Contract Stage (replaces the former "Log Outcome" concept)
  section_contract_stage: { en: "Contract Stage", ar: "مرحلة العقد" },
  contract_stage_hint: { en: "Current deal stage and its linked contract(s).", ar: "المرحلة الحالية للصفقة والعقد أو العقود المرتبطة بها." },
  contract_none: { en: "No contract linked yet.", ar: "لا يوجد عقد مرتبط بعد." },
  contract_create: { en: "Create Contract", ar: "إنشاء عقد" },
  contract_edit: { en: "Edit Contract", ar: "تعديل العقد" },
  contract_name: { en: "Contract Name", ar: "اسم العقد" },
  contract_reference: { en: "Contract Reference", ar: "مرجع العقد" },
  contract_client: { en: "Client", ar: "العميل" },
  contract_value: { en: "Contract Value", ar: "قيمة العقد" },
  contract_currency: { en: "Currency", ar: "العملة" },
  contract_start_date: { en: "Start Date", ar: "تاريخ البداية" },
  contract_end_date: { en: "End Date", ar: "تاريخ النهاية" },
  contract_responsible: { en: "Responsible Person", ar: "الشخص المسؤول" },
  contract_document: { en: "Contract File / Link", ar: "ملف / رابط العقد" },
  contract_notes: { en: "Notes", ar: "ملاحظات" },
  contract_stage_draft: { en: "Draft", ar: "مسودة" },
  contract_stage_sent_for_signature: { en: "Sent for Signature", ar: "أُرسل للتوقيع" },
  contract_stage_signed: { en: "Signed", ar: "موقّع" },
  contract_stage_active: { en: "Active", ar: "ساري" },
  contract_stage_completed: { en: "Completed", ar: "مكتمل" },
  contract_stage_terminated: { en: "Terminated", ar: "مُنهى" },
  contract_saved_toast: { en: "Contract saved", ar: "تم حفظ العقد" },

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
  section_client_details: { en: "Client Details", ar: "بيانات العميل" },
  label_contact_person: { en: "Contact Person", ar: "الشخص المسؤول" },
  label_contact_number: { en: "Contact Number", ar: "رقم التواصل" },
  label_company_name: { en: "Company Name", ar: "اسم الشركة" },
  label_jih_or_tender: { en: "JIH or Tender", ar: "JIH أو منافسة" },
  class_jih: { en: "JIH", ar: "JIH" },
  class_tender: { en: "Tender", ar: "منافسة" },
  class_other: { en: "Other", ar: "أخرى" },
  client_details_creates_rfq: {
    en: "Setting JIH or Tender here creates the submission record for this opportunity and assigns it the next sales code.",
    ar: "ضبط «JIH أو منافسة» هنا يُنشئ سجل التقديم لهذه الفرصة ويمنحه كود المبيعات التالي.",
  },
  section_qualification: { en: "Qualification & Signage Package", ar: "التأهيل وحزمة اللوحات" },
  section_stakeholders: { en: "Stakeholders", ar: "أصحاب القرار" },
  section_technical_notes: { en: "Technical Notes", ar: "ملاحظات فنية" },
  section_milestone_checklist: { en: "Milestone Checklist", ar: "قائمة مراحل الصفقة" },
  section_bafo: { en: "BAFO / Discount Approval", ar: "اعتماد BAFO / الخصم" },
  bafo_request_new: { en: "Request BAFO", ar: "طلب BAFO" },
  bafo_proposed_value: { en: "Proposed Value", ar: "القيمة المقترحة" },
  bafo_proposed_discount_pct: { en: "Proposed Discount %", ar: "نسبة الخصم المقترحة" },
  bafo_proposed_payment_terms: { en: "Proposed Payment Terms", ar: "شروط الدفع المقترحة" },
  bafo_justification: { en: "Justification", ar: "المبرر" },
  bafo_step_commercial_review: { en: "Commercial Review", ar: "المراجعة التجارية" },
  bafo_step_cost_approval: { en: "Cost Approval", ar: "اعتماد التكلفة" },
  bafo_step_finance_review: { en: "Finance Review", ar: "المراجعة المالية" },
  bafo_step_final_approval: { en: "Final Approval", ar: "الاعتماد النهائي" },
  bafo_status_pending: { en: "Pending", ar: "قيد الانتظار" },
  bafo_status_approved: { en: "Approved", ar: "مُعتمَد" },
  bafo_status_rejected: { en: "Rejected", ar: "مرفوض" },
  bafo_approve: { en: "Approve", ar: "اعتماد" },
  bafo_reject: { en: "Reject", ar: "رفض" },
  bafo_decision_notes: { en: "Notes (optional)", ar: "ملاحظات (اختياري)" },
  bafo_mark_sent_to_client: { en: "Mark Sent to Client", ar: "تمييز كمُرسَل للعميل" },
  bafo_sent_to_client_at: { en: "Sent to client", ar: "أُرسل للعميل" },
  bafo_no_requests: { en: "No BAFO requests yet.", ar: "لا توجد طلبات BAFO بعد." },
  milestone_rfq_received: { en: "RFQ Received", ar: "استُلم طلب عرض السعر" },
  milestone_quotation_sent: { en: "Quotation Sent", ar: "أُرسل عرض السعر" },
  milestone_meeting_with_management: { en: "Meeting w/ Management", ar: "اجتماع مع الإدارة" },
  milestone_bafo_request: { en: "BAFO Request", ar: "طلب BAFO" },
  milestone_discount_sent: { en: "Discount Sent", ar: "أُرسل خصم" },
  milestone_final_negotiation: { en: "Final Negotiation", ar: "تفاوض نهائي" },
  milestone_received_contract: { en: "Received Contract", ar: "استُلم العقد" },
  section_evidence: { en: "Evidence & Sources", ar: "الأدلة والمصادر" },
  section_follow_ups: { en: "Follow-up Timeline", ar: "الجدول الزمني للمتابعات" },
  section_approvals: { en: "Approvals & Decisions", ar: "الاعتمادات والقرارات" },
  section_reasoning: { en: "Agent Reasoning", ar: "منطق الوكيل" },
  section_scoring: { en: "Opportunity Score", ar: "تقييم الفرصة" },
  score_label: { en: "Score", ar: "النقاط" },
  score_tier_label: { en: "Tier", ar: "الفئة" },
  score_confidence_label: { en: "Confidence", ar: "الثقة" },
  score_missing_data_label: { en: "Missing Data", ar: "بيانات ناقصة" },
  score_reasons_label: { en: "Scoring Reasons", ar: "أسباب التقييم" },
  score_risk_flags_label: { en: "Risk Flags", ar: "أعلام المخاطر" },
  score_recommended_action_label: { en: "Recommended Next Action", ar: "الإجراء التالي الموصى به" },
  score_forecast_suggestion_label: { en: "Suggested Forecast", ar: "التوقع المقترح" },
  score_recalculate: { en: "Recalculate Score", ar: "إعادة احتساب النقاط" },
  score_override: { en: "Override Tier", ar: "تجاوز الفئة" },
  score_override_reason_label: { en: "Override Reason", ar: "سبب التجاوز" },
  score_not_qualified: { en: "Not Qualified", ar: "غير مؤهلة" },
  score_never_scored: { en: "Not scored yet", ar: "لم تُقيَّم بعد" },
  score_last_scored: { en: "Last scored", ar: "آخر تقييم" },
  score_overridden_badge: { en: "Manually Overridden", ar: "مُعدَّل يدويًا" },
  score_none: { en: "None", ar: "لا شيء" },

  label_project: { en: "Project", ar: "المشروع" },
  // Client feedback 2026-08-25: the Opportunity Review table's columns should
  // read PROJECT NAME · PROJECT CODE · REQUEST TYPE · DEADLINE · STATUS.
  label_project_name: { en: "Project Name", ar: "اسم المشروع" },
  label_project_code: { en: "Project Code", ar: "كود المشروع" },
  rev_edit_project_details: { en: "Edit project details", ar: "تعديل بيانات المشروع" },
  rev_edit_project_details_desc: {
    en: "Correct what the request got wrong before it goes to pricing.",
    ar: "صحّح ما ورد خطأً في الطلب قبل أن ينتقل إلى التسعير.",
  },
  rev_edit_saved: { en: "Project details updated.", ar: "حُدِّثت بيانات المشروع." },
  rev_edit_value_invalid: {
    en: "Estimated value must be a number, or left empty.",
    ar: "القيمة التقديرية يجب أن تكون رقمًا، أو تُترك فارغة.",
  },
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
  toast_ai_output_accepted: { en: "Output accepted", ar: "تم قبول المخرج" },
  toast_ai_output_rejected: { en: "Output rejected", ar: "تم رفض المخرج" },
  toast_return_ok: { en: "Returned for revision", ar: "أعيد للتعديل" },
  toast_schedule_ok: { en: "Follow-up scheduled", ar: "تمت جدولة المتابعة" },
  toast_assign_ok: { en: "Owner assigned", ar: "تم تعيين المسؤول" },
  toast_escalate_ok: { en: "Escalated to management", ar: "تم التصعيد للإدارة" },
  toast_complete_ok: { en: "Follow-up completed", ar: "تمت المتابعة" },
  toast_error: { en: "Action failed", ar: "تعذّر تنفيذ الإجراء" },
  toast_success: { en: "Success", ar: "تم بنجاح" },

  // Team & Permissions
  team_col_member: { en: "Member", ar: "العضو" },
  role_system_admin: { en: "System Admin", ar: "مدير النظام" },
  role_managing_director: { en: "Managing Director", ar: "العضو المنتدب" },
  role_general_manager: { en: "General Manager", ar: "المدير العام" },
  role_ceo: { en: "CEO", ar: "الرئيس التنفيذي" },
  role_sales_manager: { en: "Sales Manager", ar: "مدير المبيعات" },
  role_bd_manager: { en: "BD Manager", ar: "مدير التطوير" },
  role_sales_ops: { en: "Sales Ops", ar: "عمليات المبيعات" },
  role_finance_manager: { en: "Finance Manager", ar: "مدير مالي" },
  role_estimation_manager: { en: "Estimation Manager", ar: "مدير التقدير" },
  role_salesperson: { en: "Salesperson", ar: "مندوب مبيعات" },
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
  admin_section_pending: { en: "Pending Registrations", ar: "طلبات التسجيل المعلّقة" },
  admin_pending_empty: { en: "No pending registrations.", ar: "لا توجد طلبات تسجيل معلّقة." },
  admin_pending_approve: { en: "Approve", ar: "تفعيل" },
  admin_pending_reject: { en: "Reject", ar: "رفض" },
  admin_pending_role_label: { en: "Grant role", ar: "منح دور" },
  admin_pending_registered: { en: "Registered", ar: "سجّل في" },
  admin_user_suspend: { en: "Suspend", ar: "تعليق" },
  admin_user_activate: { en: "Activate", ar: "تفعيل" },
  admin_user_delete: { en: "Delete", ar: "حذف" },
  admin_user_deleted: { en: "Deleted", ar: "محذوف" },
  admin_confirm_suspend_title: { en: "Suspend account?", ar: "تعليق الحساب؟" },
  admin_confirm_suspend_desc: {
    en: "This blocks login immediately but keeps all data and can be reversed later. Suspend",
    ar: "سيمنع هذا تسجيل الدخول فورًا مع الاحتفاظ بكل البيانات، ويمكن التراجع عنه لاحقًا. تعليق",
  },
  admin_confirm_delete_title: { en: "Delete account?", ar: "حذف الحساب؟" },
  admin_confirm_delete_desc: {
    en: "This is a separate, more permanent action than Suspend — it blocks login and is not meant to be routinely reversed. No CRM records are removed. Delete",
    ar: "هذا إجراء منفصل وأكثر ديمومة من التعليق — يمنع تسجيل الدخول ولا يُقصَد التراجع عنه بشكل روتيني. لا تُحذف أي سجلات CRM. حذف",
  },
  admin_confirm_delete_owned_warning: {
    en: "This account still owns active records",
    ar: "لا يزال هذا الحساب مالكًا لسجلات نشطة",
  },
  admin_col_status: { en: "Status", ar: "الحالة" },
  toast_user_approved: { en: "Account approved", ar: "تم تفعيل الحساب" },
  toast_user_rejected: { en: "Account rejected", ar: "تم رفض الحساب" },
  toast_user_suspended: { en: "Account suspended", ar: "تم تعليق الحساب" },
  toast_user_activated: { en: "Account activated", ar: "تم تفعيل الحساب" },
  toast_user_deleted: { en: "Account deleted", ar: "تم حذف الحساب" },

  // Quotations
  empty_quotations: {
    en: "No quotations have been recorded yet.",
    ar: "لم يتم تسجيل أي عروض أسعار حتى الآن.",
  },
  action_new_quotation: { en: "New Quotation", ar: "عرض سعر جديد" },
  dialog_new_quotation_title: { en: "Create quotation", ar: "إنشاء عرض سعر" },
  dialog_new_quotation_desc: {
    en: "Register a new quotation linked to an opportunity. It starts as a draft.",
    ar: "تسجيل عرض سعر جديد مرتبط بفرصة. يبدأ كمسودة.",
  },
  field_quote_number: { en: "Quotation number", ar: "رقم العرض" },
  field_value: { en: "Value (SAR)", ar: "القيمة (ريال)" },
  field_issued_date: { en: "Issue date", ar: "تاريخ الإصدار" },
  field_valid_until: { en: "Valid until", ar: "صالح حتى" },
  field_opportunity: { en: "Opportunity", ar: "الفرصة" },
  label_version: { en: "Version", ar: "النسخة" },
  label_valid_until: { en: "Valid until", ar: "صالح حتى" },
  label_win_loss_reason: { en: "Win/Loss reason", ar: "سبب الفوز/الخسارة" },
  action_change_status: { en: "Change Status", ar: "تغيير الحالة" },
  dialog_quote_status_title: { en: "Update quotation status", ar: "تحديث حالة العرض" },
  dialog_quote_status_desc: {
    en: "Won or Lost requires a written reason — no deal closes without one.",
    ar: "حالة الفوز أو الخسارة تتطلب سبباً مكتوباً — لا تُغلق صفقة بدونه.",
  },
  field_new_status: { en: "New status", ar: "الحالة الجديدة" },
  toast_quotation_created: { en: "Quotation created", ar: "تم إنشاء عرض السعر" },
  toast_quotation_updated: { en: "Quotation updated", ar: "تم تحديث عرض السعر" },
  expiring_soon: { en: "Expiring soon", ar: "قرب الانتهاء" },
  expired: { en: "Expired", ar: "منتهي الصلاحية" },
  quote_status_draft: { en: "Draft", ar: "مسودة" },
  quote_status_under_internal_review: { en: "Under Internal Review", ar: "قيد المراجعة الداخلية" },
  quote_status_approved_for_submission: { en: "Approved for Submission", ar: "معتمد للإرسال" },
  quote_status_submitted: { en: "Submitted", ar: "مُرسل" },
  quote_status_follow_up: { en: "Follow-up", ar: "متابعة" },
  quote_status_negotiation: { en: "Negotiation", ar: "تفاوض" },
  quote_status_revised: { en: "Revised", ar: "منقّح" },
  quote_status_won: { en: "Won", ar: "فوز" },
  quote_status_lost: { en: "Lost", ar: "خسارة" },
  quote_status_expired: { en: "Expired", ar: "منتهي" },

  // BOQ
  empty_boqs: {
    en: "No BOQs have been registered yet.",
    ar: "لم يتم تسجيل أي BOQ حتى الآن.",
  },
  action_new_boq: { en: "New BOQ", ar: "BOQ جديد" },
  dialog_new_boq_title: { en: "Register BOQ", ar: "تسجيل BOQ" },
  dialog_new_boq_desc: {
    en: "Anything not received officially from the client is a Preliminary Estimated Scope, never a verified BOQ.",
    ar: "أي ملف غير مستلم رسمياً من العميل يُسجل كنطاق تقديري مبدئي، وليس BOQ معتمداً.",
  },
  field_boq_title: { en: "Title", ar: "العنوان" },
  field_boq_status: { en: "Verification status", ar: "حالة التحقق" },
  field_boq_source: { en: "Source", ar: "المصدر" },
  field_assumptions: { en: "Assumptions", ar: "الافتراضات" },
  field_missing_items: { en: "Missing items", ar: "العناصر الناقصة" },
  field_estimated_value: { en: "Estimated value (SAR)", ar: "القيمة التقديرية (ريال)" },
  boq_status_verified: { en: "Verified BOQ", ar: "BOQ معتمد" },
  boq_status_partially_verified: { en: "Partially Verified", ar: "معتمد جزئياً" },
  boq_status_estimated_scope: { en: "Preliminary Estimated Scope", ar: "نطاق تقديري مبدئي" },
  boq_status_missing: { en: "Missing BOQ", ar: "BOQ غير متوفر" },
  action_add_item: { en: "Add Item", ar: "إضافة بند" },
  dialog_add_item_title: { en: "Add BOQ item", ar: "إضافة بند BOQ" },
  field_sign_type: { en: "Sign type", ar: "نوع اللوحة" },
  field_size: { en: "Size", ar: "المقاس" },
  field_material: { en: "Material", ar: "المادة" },
  field_quantity: { en: "Quantity", ar: "الكمية" },
  field_location: { en: "Location", ar: "الموقع" },
  field_unit_rate: { en: "Unit rate (SAR)", ar: "سعر الوحدة (ريال)" },
  toast_boq_created: { en: "BOQ registered", ar: "تم تسجيل الـ BOQ" },
  toast_boq_item_added: { en: "Item added", ar: "تمت إضافة البند" },
  label_items: { en: "Items", ar: "البنود" },

  // Targets & Performance
  empty_targets: {
    en: "No targets have been set for this period yet.",
    ar: "لم يتم تحديد أهداف لهذه الفترة بعد.",
  },
  action_set_target: { en: "Set Target", ar: "تحديد هدف" },
  dialog_set_target_title: { en: "Set period target", ar: "تحديد هدف الفترة" },
  dialog_set_target_desc: {
    en: "Targets are multi-dimensional: sales, pipeline, quotations and activities — not sales value alone.",
    ar: "الأهداف متعددة الأبعاد: مبيعات، Pipeline، عروض أسعار، ونشاط — وليست قيمة المبيعات فقط.",
  },
  field_member: { en: "Team member", ar: "عضو الفريق" },
  field_period_start: { en: "Period start", ar: "بداية الفترة" },
  field_sales_target: { en: "Sales target (SAR, won only)", ar: "هدف المبيعات (ريال، عقود فقط)" },
  field_pipeline_target: { en: "Pipeline target (SAR)", ar: "هدف الـ Pipeline (ريال)" },
  field_quotation_target: { en: "Quotations target (count)", ar: "هدف عروض الأسعار (عدد)" },
  field_activity_target: { en: "Activities target (count)", ar: "هدف النشاط (عدد)" },
  field_conversion_target: { en: "Conversion target (%)", ar: "هدف نسبة التحويل (%)" },
  target_sales: { en: "Sales (Won)", ar: "المبيعات (فوز)" },
  target_pipeline: { en: "Open Pipeline", ar: "الفرص المفتوحة" },
  target_quotations: { en: "Quotations Submitted", ar: "عروض مُرسلة" },
  target_activities: { en: "Activities Logged", ar: "النشاط المسجل" },
  target_conversion: { en: "Conversion Rate", ar: "نسبة التحويل" },
  target_won: { en: "Won Value", ar: "قيمة الفوز" },
  target_remaining: { en: "Remaining to Target", ar: "المتبقي للهدف" },
  target_open_pipeline: { en: "Open Pipeline", ar: "الفرص المفتوحة" },
  target_followups_completed: { en: "Follow-ups Completed", ar: "المتابعات المكتملة" },
  target_rfqs_reviewed: { en: "RFQs Reviewed", ar: "طلبات عروض الأسعار المراجَعة" },
  target_tenders_followed: { en: "Tenders Followed", ar: "المناقصات المتابَعة" },
  target_quotations_sent: { en: "Quotations Sent", ar: "عروض الأسعار المُرسلة" },
  target_conversion_rate: { en: "Conversion Rate", ar: "نسبة التحويل" },
  label_target: { en: "Target", ar: "الهدف" },
  label_actual: { en: "Actual", ar: "الفعلي" },
  toast_target_saved: { en: "Target saved", ar: "تم حفظ الهدف" },
  targets_intro: {
    en: "Actuals are computed live from opportunities, quotations and follow-ups owned by each member this period.",
    ar: "الأرقام الفعلية تُحسب مباشرة من الفرص وعروض الأسعار والمتابعات المملوكة لكل عضو خلال الفترة.",
  },
  targets_tab_mine: { en: "My Performance", ar: "أدائي" },
  targets_tab_team: { en: "Team Performance", ar: "أداء الفريق" },
  targets_section_target: { en: "This Month's Target", ar: "هدف هذا الشهر" },
  targets_section_activity: { en: "Activity This Month", ar: "النشاط هذا الشهر" },
  mgr_team_target: { en: "Team Sales (Won)", ar: "مبيعات الفريق (فوز)" },
  mgr_pipeline_by_owner: { en: "Pipeline by Owner", ar: "الفرص المفتوحة حسب المالك" },
  mgr_overdue_by_owner: { en: "Overdue Actions by Owner", ar: "الإجراءات المتأخرة حسب المالك" },
  mgr_no_overdue: { en: "No overdue actions.", ar: "لا توجد إجراءات متأخرة." },
  mgr_tier_a: { en: "Open Tier A Opportunities", ar: "فرص المستوى A المفتوحة" },
  mgr_rfq_conversion: { en: "RFQ Conversion", ar: "تحويل طلبات عروض الأسعار" },
  mgr_tender_conversion: { en: "Tender Conversion", ar: "تحويل المناقصات" },
  mgr_quotation_win_rate: { en: "Quotation Win Rate", ar: "نسبة فوز عروض الأسعار" },
  mgr_forecast: { en: "Weighted Forecast", ar: "التوقع المرجّح" },
  mgr_target_by_salesperson: { en: "Target by Salesperson", ar: "الهدف لكل مندوب مبيعات" },

  // Reports
  report_pipeline_by_stage: { en: "Pipeline by Stage", ar: "الفرص حسب المرحلة" },
  report_quotation_funnel: { en: "Quotation Funnel", ar: "مسار عروض الأسعار" },
  report_win_loss: { en: "Win / Loss", ar: "الفوز / الخسارة" },
  report_won_value: { en: "Won Value", ar: "قيمة الفوز" },
  report_lost_value: { en: "Lost Value", ar: "قيمة الخسارة" },
  report_win_rate: { en: "Win Rate", ar: "نسبة الفوز" },
  report_open_quotes_value: { en: "Open Quotations Value", ar: "قيمة العروض المفتوحة" },
  report_lost_reasons: { en: "Recorded Loss Reasons", ar: "أسباب الخسارة المسجلة" },
  report_count: { en: "Count", ar: "العدد" },
  report_value: { en: "Value", ar: "القيمة" },
  empty_report: {
    en: "Not enough data yet — reports build themselves as the pipeline fills.",
    ar: "لا توجد بيانات كافية بعد — التقارير تُبنى تلقائياً مع امتلاء الـ Pipeline.",
  },

  // Opportunity list filters
  filter_search: { en: "Search project, client, contractor…", ar: "ابحث عن مشروع، عميل، مقاول…" },
  filter_all_stages: { en: "All stages", ar: "كل المراحل" },
  // Import batch lifecycle. archiveImportBatch/unarchiveImportBatch existed
  // with nothing calling them, so a batch that died mid-upload stayed in
  // Active permanently.
  di_archive: { en: "Archive batch", ar: "أرشفة الدفعة" },
  di_unarchive: { en: "Restore batch", ar: "استعادة الدفعة" },
  di_archived_tab: { en: "Archived", ar: "المؤرشَفة" },
  di_empty_archived: { en: "No archived batches.", ar: "لا دفعات مؤرشَفة." },
  di_archived_hint: {
    en: "Archived batches stay here and can be restored. Nothing is deleted.",
    ar: "الدفعات المؤرشَفة تبقى هنا ويمكن استعادتها. لا يُحذف شيء.",
  },
  // Stage GROUPS. A KPI drilldown filters by a set of stages ("open pipeline"),
  // not a single one, so these belong in the same dropdown as the stages
  // themselves — otherwise arriving from a number leaves the control blank.
  filter_stage_open: { en: "Open pipeline", ar: "خط الأنابيب المفتوح" },
  filter_stage_closed: { en: "Closed (won or lost)", ar: "مغلقة (ربح أو خسارة)" },
  filter_stage_late_stage: { en: "Late stage", ar: "المراحل المتأخرة" },
  filter_stage_awarded: { en: "Awarded", ar: "مُرسَاة" },
  kpi_target_sales: { en: "Target sales", ar: "المستهدف البيعي" },
  kpi_sales_achievement: { en: "Sales achievement", ar: "المتحقق من المبيعات" },
  kpi_need_to_close: { en: "Need to close", ar: "المتبقي للإغلاق" },
  kpi_sales_project_status: { en: "Sales project status", ar: "حالة المشاريع البيعية" },
  kpi_verbally_awarded: { en: "Verbally awarded", ar: "ترسية شفهية" },
  kpi_jih: { en: "JIH", ar: "JIH" },
  kpi_tenders: { en: "Tenders", ar: "المنافسات" },
  kpi_jih_pending: { en: "JIH pending", ar: "JIH قيد الانتظار" },
  kpi_tender_pending: { en: "Tender pending", ar: "منافسات قيد الانتظار" },
  kpi_pending_submission: { en: "Pending for submission", ar: "بانتظار التقديم" },
  fix_add_probability: { en: "Add win probability", ar: "أدخِل احتمالية الفوز" },
  fix_add_value: { en: "Add opportunity value", ar: "أدخِل قيمة الفرصة" },
  fix_set_target: { en: "Set a sales target", ar: "اضبط المستهدف البيعي" },
  mgmt_open_pipeline: { en: "Open pipeline", ar: "خط أنابيب مفتوح" },
  mgmt_late_stage: { en: "Late stage", ar: "مراحل متأخرة" },
  mgmt_pending_contract: { en: "Pending contract", ar: "بانتظار العقد" },
  mgmt_contracted: { en: "Contracted", ar: "متعاقَد عليه" },
  mgmt_won: { en: "Won", ar: "مُحقَّق" },
  kpi_forecast: { en: "Forecast", ar: "التنبؤ" },
  kpi_coverage: { en: "Pipeline coverage", ar: "تغطية خط الأنابيب" },
  rfqw_not_started: { en: "Not started", ar: "لم يبدأ" },
  rfqw_pricing: { en: "Pricing", ar: "قيد التسعير" },
  rfqw_awaiting_client: { en: "Awaiting client", ar: "بانتظار العميل" },
  rfqw_converted: { en: "Converted", ar: "محوَّل" },
  rfqw_lost: { en: "Lost", ar: "خاسر" },
  rfqw_on_hold: { en: "On hold", ar: "معلَّق" },

  // ---- Metric caveats (Phase 5.1 pre-D) ------------------------------------
  // Templates only. A slot is filled with a number the engine computed; nothing
  // here decides WHICH deals count — that rule lives in sales-kpis.ts alone.
  cav_no_target: { en: "No target has been set for this period", ar: "لم يُضبَط مستهدف لهذه الفترة" },
  cav_no_target_achievement: {
    en: "Cannot compute achievement without a target",
    ar: "لا يمكن حساب نسبة التحقيق بلا مستهدف",
  },
  cav_no_target_gap: { en: "Cannot compute a gap without a target", ar: "لا يمكن حساب الفجوة بلا مستهدف" },
  cav_probability_missing: {
    en: "{count} open deals have no probability and are excluded rather than assumed",
    ar: "{count} فرصة مفتوحة بلا احتمالية، واستُبعدت بدل أن تُفترَض",
  },
  cav_unvalued_contribute_zero: {
    en: "{count} of {total} have no value recorded and are not included in the total",
    ar: "{count} من {total} بلا قيمة مسجَّلة وغير مشمولة في الإجمالي",
  },
  cav_counted_not_summed: {
    en: "{count} of {total} carry no value and are counted but not summed",
    ar: "{count} من {total} بلا قيمة، تُعَدّ ولا تُجمَع",
  },
  cav_won_undated: { en: "{count} won deals have no recorded award date", ar: "{count} صفقة رابحة بلا تاريخ ترسية مسجَّل" },
  cav_won_undated_outside_period: {
    en: "{count} won deals have no recorded award date and sit outside this period",
    ar: "{count} صفقة رابحة بلا تاريخ ترسية مسجَّل وتقع خارج هذه الفترة",
  },
  cav_lost_undated: { en: "{count} lost deals have no recorded close date", ar: "{count} صفقة خاسرة بلا تاريخ إغلاق مسجَّل" },
  cav_predate_outcome_tracking: {
    en: "These pre-date outcome-date tracking; no date was invented for them",
    ar: "هذه تسبق تتبّع تواريخ النتائج، ولم يُختلَق لها تاريخ",
  },
  cav_nothing_closed: {
    en: "Nothing has closed in this period — a rate cannot be computed",
    ar: "لم يُغلَق شيء في هذه الفترة — لا يمكن حساب النسبة",
  },
  cav_closed_undated: {
    en: "{count} closed deals have no recorded date and are not in this rate",
    ar: "{count} صفقة مغلقة بلا تاريخ مسجَّل وليست ضمن هذه النسبة",
  },
  cav_unclassified_neither: {
    en: "{count} open opportunities are not yet classified as JIH or Tender, and are counted in neither figure",
    ar: "{count} فرصة مفتوحة غير مصنَّفة JIH أو منافسة، ولا تُحسب في أيٍّ من الرقمين",
  },
  cav_unclassified_do_not_sum: {
    en: "{count} of these are not classified as JIH or Tender, so the two figures below do not sum to this one",
    ar: "{count} منها غير مصنَّفة JIH أو منافسة، فالرقمان أدناه لا يجمعان إلى هذا الرقم",
  },

  // ---- Needs Attention reasons --------------------------------------------
  rsn_follow_up_overdue_one: { en: "One overdue follow-up, {days} days late", ar: "متابعة متأخرة واحدة، متأخرة {days} يومًا" },
  rsn_follow_up_overdue_many: {
    en: "{count} overdue follow-ups, oldest {days} days late",
    ar: "{count} متابعات متأخرة، أقدمها متأخرة {days} يومًا",
  },
  rsn_no_next_action: { en: "No next action set", ar: "لا إجراء تالٍ محدَّد" },
  rsn_no_next_action_date: { en: "Next action has no date", ar: "الإجراء التالي بلا تاريخ" },
  rsn_next_action_overdue: { en: "Next action {days} days past its date", ar: "الإجراء التالي متأخر {days} يومًا عن تاريخه" },
  rsn_inactive: { en: "No client contact for {days} days", ar: "لا تواصل مع العميل منذ {days} يومًا" },
  rsn_no_engagement_history: {
    en: "No client activity has ever been recorded — engagement history unavailable",
    ar: "لم يُسجَّل أي نشاط مع العميل — سجل التواصل غير متاح",
  },
  rsn_stalled: {
    en: "{days} days in {stage} against a {limit}-day {source}, with nothing scheduled",
    ar: "{days} يومًا في {stage} مقابل {limit} يومًا حسب {source}، بلا شيء مجدوَل",
  },
  rsn_expected_close_overdue: { en: "Expected close {date} has passed", ar: "تجاوز تاريخ الإغلاق المتوقَّع {date}" },
  rsn_closing_soon: { en: "Expected to close in {days} days", ar: "يُتوقَّع الإغلاق خلال {days} يومًا" },
  rsn_high_value_low_probability: {
    en: "High value at {pct}% ({source})",
    ar: "قيمة عالية عند {pct}% ({source})",
  },
  rsn_unscored: { en: "No win probability recorded", ar: "لا احتمالية فوز مسجَّلة" },
  rsn_no_decision_maker: { en: "No decision maker identified", ar: "لم يُحدَّد صانع القرار" },
  rsn_missing_value: { en: "No opportunity value recorded", ar: "لا قيمة مسجَّلة للفرصة" },
  rsn_missing_owner: { en: "No sales owner assigned", ar: "لا مالك مبيعات مُسنَد" },
  rsn_missing_company: { en: "No client or contractor recorded", ar: "لا عميل ولا مقاول مسجَّل" },

  // ---- AI Executive Brief (Phase 5.1 §11) ---------------------------------
  // Templates. {value} slots receive raw numbers and are formatted by the
  // presentation layer, so Arabic gets Arabic-Indic digits and ر.س.
  brf_stage_moves: { en: "{count} opportunities changed stage.", ar: "{count} فرصة غيّرت مرحلتها." },
  brf_won: { en: "{count} deals won, {value}.", ar: "{count} صفقة رابحة، {value}." },
  brf_lost: { en: "{count} lost, {value}.", ar: "{count} خاسرة، {value}." },
  brf_no_movement: {
    en: "No stage movement or closures recorded in this period.",
    ar: "لا حركة مراحل ولا إغلاقات مسجَّلة في هذه الفترة.",
  },
  brf_issue_expected_close_overdue: {
    en: "{count} opportunities past their expected close date.",
    ar: "{count} فرصة تجاوزت تاريخ إغلاقها المتوقَّع.",
  },
  brf_issue_no_recent_crm_activity: {
    en: "{count} opportunities with no CRM activity logged recently.",
    ar: "{count} فرصة بلا نشاط مسجَّل في النظام مؤخرًا.",
  },
  brf_issue_no_next_action: {
    en: "{count} opportunities with no next action set.",
    ar: "{count} فرصة بلا إجراء تالٍ محدَّد.",
  },
  brf_issue_high_value_low_probability: {
    en: "{count} opportunities high in value and low in probability.",
    ar: "{count} فرصة عالية القيمة ومنخفضة الاحتمالية.",
  },
  brf_nothing_flagged: {
    en: "Nothing is flagged by the health checks.",
    ar: "لا شيء تُشير إليه فحوص السلامة.",
  },
  brf_forecast: {
    en: "Weighted forecast {weighted} from {open} open pipeline.",
    ar: "تنبؤ مرجَّح {weighted} من خط أنابيب مفتوح {open}.",
  },
  brf_forecast_uncomputable: {
    en: "Weighted forecast cannot be computed — no open deal carries a probability.",
    ar: "تعذّر حساب التنبؤ المرجَّح — لا صفقة مفتوحة تحمل احتمالية.",
  },
  brf_late_stage_exposure: {
    en: "{value} sits at verbal award or contract stage — exposure, not revenue, and not counted toward target.",
    ar: "{value} في مرحلة الترسية الشفهية أو العقد — تعرُّض لا إيراد، ولا يُحتسب ضمن المستهدف.",
  },
  brf_gap_to_target: { en: "{value} remaining to target.", ar: "{value} متبقٍّ للوصول إلى المستهدف." },
  brf_target_met: { en: "Target met.", ar: "تحقّق المستهدف." },
  brf_focus_deal: { en: "{name} — {value}", ar: "{name} — {value}" },
  brf_no_valued_open: { en: "No valued open opportunities.", ar: "لا فرص مفتوحة ذات قيمة مسجَّلة." },
  brf_title: { en: "Executive brief", ar: "الموجز التنفيذي" },
  brf_what_changed: { en: "What changed", ar: "ما الذي تغيّر" },
  brf_needs_attention: { en: "Needs attention", ar: "يحتاج انتباهًا" },
  brf_forecast_heading: { en: "Forecast", ar: "التنبؤ" },
  brf_focus: { en: "Focus", ar: "التركيز" },
  brf_ai_unavailable: {
    en: "AI commentary unavailable — the facts below are unaffected.",
    ar: "تعليق الذكاء الاصطناعي غير متاح — الحقائق أدناه غير متأثرة.",
  },
  nav_calendar: { en: "Calendar", ar: "التقويم" },
  cal_follow_up: { en: "Follow-up", ar: "متابعة" },
  cal_rfq_due: { en: "RFQ deadline", ar: "موعد عرض السعر" },
  cal_next_action: { en: "Next action", ar: "إجراء تالٍ" },
  cal_overdue: { en: "Overdue", ar: "متأخر" },
  cal_today: { en: "Today", ar: "اليوم" },
  cal_upcoming: { en: "Upcoming", ar: "قادم" },
  cal_nothing: { en: "Nothing scheduled", ar: "لا شيء مجدول" },
  cal_new_followup: { en: "Schedule follow-up", ar: "جدولة متابعة" },
  brf_ai_empty: {
    en: "AI commentary returned nothing to add — the facts below are unaffected.",
    ar: "لم يُضِف تعليق الذكاء الاصطناعي شيئًا — الحقائق أدناه غير متأثرة.",
  },
  dq_title: { en: "Data quality", ar: "جودة البيانات" },
  dq_affected: {
    en: "{count} of {total} active opportunities have at least one gap",
    ar: "{count} من {total} فرصة نشطة بها ثغرة واحدة على الأقل",
  },
  dq_not_risk: {
    en: "These are gaps in what we know, not deals in danger — At Risk is counted separately.",
    ar: "هذه ثغرات فيما نعرفه، لا صفقات في خطر — «معرَّضة للخطر» تُحسب على حدة.",
  },
  ask_ai_title: { en: "Ask PHC AI", ar: "اسأل PHC AI" },
  ask_ai_intro: {
    en: "Ask about the pipeline you can see. Try one of these:",
    ar: "اسأل عن خط الأنابيب الذي تراه. جرّب أحد هذه:",
  },
  ask_ai_bounded_note: {
    en: "Answered from a fixed set of filters over records you can already open — no query was generated.",
    ar: "أُجيب من مجموعة مرشِّحات ثابتة على سجلات تستطيع فتحها أصلًا — لم يُولَّد أي استعلام.",
  },
  ask_ai_not_understood: {
    en: "That is not one of the questions this can answer yet.",
    ar: "هذا ليس من الأسئلة التي يمكن الإجابة عنها بعد.",
  },
  ask_ai_search_instead: { en: "Search records instead →", ar: "ابحث في السجلات بدلًا من ذلك →" },
  ask_ai_send: { en: "Ask", ar: "اسأل" },
  ask_ai_open: { en: "Ask PHC AI", ar: "اسأل PHC AI" },
  cmd_placeholder_ai: { en: "Search or ask PHC AI…", ar: "ابحث أو اسأل PHC AI…" },
  src_baseline: { en: "baseline", ar: "مرجع مقاس" },
  src_sla: { en: "SLA", ar: "اتفاقية مستوى خدمة" },
  kpi_achievement: { en: "Achievement", ar: "نسبة التحقيق" },
  kpi_gap: { en: "Gap", ar: "الفجوة" },
  filter_group_heading: { en: "Groups", ar: "مجموعات" },
  filter_stage_heading: { en: "Stages", ar: "المراحل" },
  // Active-filter chips.
  filter_chip_stage: { en: "Stage", ar: "المرحلة" },
  filter_chip_tier: { en: "Tier", ar: "الفئة" },
  filter_chip_owner: { en: "Owner: selected", ar: "المالك: محدَّد" },
  filter_chip_search: { en: "Search", ar: "بحث" },
  filter_chip_filtered_by: { en: "Filtered by", ar: "مُصفّى حسب" },
  filter_all_tiers: { en: "All tiers", ar: "كل التصنيفات" },
  filter_no_results: {
    en: "No opportunities match the current filters.",
    ar: "لا توجد فرص مطابقة للفلاتر الحالية.",
  },

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

  // Data Import Center
  nav_data_import: { en: "Data Import", ar: "استيراد البيانات" },
  import_title: { en: "Data Import Center", ar: "مركز استيراد البيانات" },
  import_desc: { en: "Upload, validate, and import data safely with full audit trail", ar: "رفع والتحقق واستيراد البيانات بأمان مع سجل تدقيق كامل" },
  import_tab_history: { en: "History", ar: "السجل" },
  import_tab_upload: { en: "Upload", ar: "الرفع" },
  import_tab_mapping: { en: "Mapping", ar: "الربط" },
  import_tab_validation: { en: "Validation", ar: "التحقق" },
  import_tab_duplicates: { en: "Duplicates", ar: "التكرارات" },
  import_tab_approval: { en: "Approval", ar: "الاعتماد" },
  import_tab_result: { en: "Result", ar: "النتيجة" },
  import_tab_analysis: { en: "Analysis", ar: "التحليل" },
  import_upload_prompt: { en: "Drop a .csv or .xlsx file here, or click to browse", ar: "اسحب ملف .csv أو .xlsx هنا، أو اضغط للتصفح" },
  import_upload_limit: { en: "Max 10 MB · Max 10,000 rows", ar: "الحد الأقصى 10 ميغابايت · 10,000 صف" },
  import_new_batch: { en: "New Import", ar: "استيراد جديد" },
  import_parse: { en: "Parse File", ar: "تحليل الملف" },
  import_parsing: { en: "Parsing…", ar: "جاري التحليل…" },
  import_validate: { en: "Validate", ar: "تحقق" },
  import_validating: { en: "Validating…", ar: "جاري التحقق…" },
  import_detect_dupes: { en: "Detect Duplicates", ar: "كشف التكرارات" },
  import_detecting: { en: "Detecting…", ar: "جاري الكشف…" },
  import_approve: { en: "Approve", ar: "اعتماد" },
  import_reject: { en: "Reject", ar: "رفض" },
  import_dry_run: { en: "Dry Run", ar: "تشغيل تجريبي" },
  import_running: { en: "Running…", ar: "جاري التشغيل…" },
  import_download_errors: { en: "Download Errors", ar: "تنزيل الأخطاء" },
  import_download_dupes: { en: "Download Duplicates", ar: "تنزيل التكرارات" },
  import_download_summary: { en: "Download Summary", ar: "تنزيل الملخص" },
  import_status_uploading: { en: "Uploading", ar: "جاري الرفع" },
  import_status_parsing: { en: "Parsing", ar: "جاري التحليل" },
  import_status_mapping: { en: "Mapping", ar: "الربط" },
  import_status_validating: { en: "Validating", ar: "جاري التحقق" },
  import_status_duplicate_review: { en: "Duplicate Review", ar: "مراجعة التكرارات" },
  import_status_pending_approval: { en: "Pending Approval", ar: "بانتظار الاعتماد" },
  import_status_approved: { en: "Approved", ar: "معتمد" },
  import_status_dry_run: { en: "Dry Run Complete", ar: "اكتمل التشغيل التجريبي" },
  import_status_committed: { en: "Committed", ar: "تم الاعتماد" },
  import_status_failed: { en: "Failed", ar: "فشل" },
  import_status_cancelled: { en: "Cancelled", ar: "ملغى" },
  import_source_col: { en: "Source Column", ar: "عمود المصدر" },
  import_target_col: { en: "Target Field", ar: "الحقل الهدف" },
  import_key_field: { en: "Key Field", ar: "حقل مفتاحي" },
  import_save_mapping: { en: "Save Mapping", ar: "حفظ الربط" },
  import_rows_total: { en: "Total Rows", ar: "إجمالي الصفوف" },
  import_rows_valid: { en: "Valid", ar: "صالح" },
  import_rows_errors: { en: "Errors", ar: "أخطاء" },
  import_rows_dupes: { en: "Duplicates", ar: "تكرارات" },
  import_resolution_skip: { en: "Skip", ar: "تخطي" },
  import_resolution_merge: { en: "Merge", ar: "دمج" },
  import_resolution_create: { en: "Create New", ar: "إنشاء جديد" },
  import_confidence: { en: "Confidence", ar: "الثقة" },
  import_match_type: { en: "Match Type", ar: "نوع التطابق" },
  import_blocked: { en: "You do not have access to the Data Import Center", ar: "ليس لديك صلاحية للوصول لمركز الاستيراد" },
  import_no_approve: { en: "Your role cannot approve or commit imports", ar: "دورك لا يسمح باعتماد أو تنفيذ الاستيراد" },
  import_dry_run_note: { en: "Dry-run mode: no production data will be modified", ar: "وضع تجريبي: لن يتم تعديل بيانات الإنتاج" },
  import_staging_only_warning: { en: "Staging preview only — no live CRM records are created until you commit.", ar: "معاينة مرحلية فقط — لن يتم إنشاء أي سجلات CRM حتى تقوم بالاعتماد النهائي." },
  import_commit_to_crm: { en: "Commit to CRM", ar: "اعتماد في نظام CRM" },
  import_commit_confirm: { en: "This will write records to the live CRM. This action cannot be undone. Continue?", ar: "سيتم كتابة السجلات في نظام CRM الحي. هذا الإجراء لا يمكن التراجع عنه. هل تريد المتابعة؟" },
  import_committed_records: { en: "Records created", ar: "السجلات التي تم إنشاؤها" },
  import_commit_failed_rows: { en: "Rows failed", ar: "الصفوف التي فشلت" },
  import_commit_view_crm: { en: "View in CRM", ar: "عرض في CRM" },
  import_would_create: { en: "Would Create", ar: "سيتم إنشاء" },
  import_would_skip: { en: "Would Skip", ar: "سيتم تخطي" },
  import_cancel: { en: "Cancel Import", ar: "إلغاء الاستيراد" },
  import_no_batches: { en: "No imports yet", ar: "لا يوجد استيرادات بعد" },
  import_file_rejected: { en: "File rejected", ar: "الملف مرفوض" },

  // Email via Outlook (Phase 1 — compose only, mailto handoff)
  email_via_outlook: { en: "Email via Outlook", ar: "بريد عبر Outlook" },
  email_open_in_outlook: { en: "Open in Outlook", ar: "فتح في Outlook" },
  email_copy_text: { en: "Copy email text", ar: "نسخ نص البريد" },
  email_copied: { en: "Email text copied", ar: "تم نسخ نص البريد" },
  email_to: { en: "To", ar: "إلى" },
  email_cc: { en: "CC", ar: "نسخة" },
  email_subject: { en: "Subject", ar: "الموضوع" },
  email_body: { en: "Body", ar: "المحتوى" },
  email_linked_record: { en: "Linked record", ar: "السجل المرتبط" },
  email_compose_desc: {
    en: "Review, then open the draft in your Outlook mail client. Nothing is sent from PHC.",
    ar: "راجع الرسالة ثم افتحها في Outlook. لا يتم الإرسال من داخل النظام.",
  },
  email_no_recipient: {
    en: "No recipient email found. Add a contact email or use Copy email text.",
    ar: "لا يوجد بريد للمستلم. أضف بريداً للتواصل أو انسخ نص البريد يدوياً.",
  },
  email_invalid_recipient: {
    en: "Recipient email doesn't look valid.",
    ar: "بريد المستلم يبدو غير صالح.",
  },
  email_mailto_truncated_hint: {
    en: "This message is long — some mail clients may truncate it. Use Copy email text for the full version.",
    ar: "الرسالة طويلة وقد يقتطعها بعض عملاء البريد. استخدم نسخ نص البريد للنسخة الكاملة.",
  },
  email_phase1_disclaimer: {
    en: "Compose only — you review and send from Outlook. PHC does not send emails automatically.",
    ar: "تجهيز فقط — تراجع وترسل من Outlook. لا يقوم النظام بإرسال أي بريد تلقائياً.",
  },
  email_tpl_opportunity_follow_up: { en: "Opportunity follow-up", ar: "متابعة الفرصة" },
  email_tpl_tender_clarification: { en: "Tender / RFQ clarification", ar: "توضيحات المناقصة / طلب العرض" },
  email_tpl_contractor_introduction: { en: "Contractor introduction", ar: "تعريف بالمقاول" },
  email_tpl_meeting_request: { en: "Meeting request", ar: "طلب اجتماع" },
  email_tpl_missing_information: { en: "Missing information", ar: "معلومات ناقصة" },
  email_tpl_quotation_follow_up: { en: "Quotation follow-up", ar: "متابعة عرض السعر" },

  // WhatsApp click-to-chat (Phase 1 — compose only, wa.me handoff)
  wa_button: { en: "WhatsApp", ar: "واتساب" },
  wa_compose_title: { en: "WhatsApp Message", ar: "رسالة واتساب" },
  wa_compose_desc: {
    en: "Review, then open WhatsApp with this message prefilled. Nothing is sent from PHC.",
    ar: "راجع الرسالة ثم افتحها في واتساب. لا يتم الإرسال من داخل النظام.",
  },
  wa_phone: { en: "Phone (with country code)", ar: "الجوال (مع رمز الدولة)" },
  wa_template: { en: "Template", ar: "القالب" },
  wa_message: { en: "Message", ar: "الرسالة" },
  wa_copy_text: { en: "Copy message", ar: "نسخ الرسالة" },
  wa_copied: { en: "Message copied", ar: "تم نسخ الرسالة" },
  wa_open: { en: "Open WhatsApp", ar: "فتح واتساب" },
  wa_no_recipient: {
    en: "No recipient phone found. Add a contact phone or enter one manually.",
    ar: "لا يوجد رقم للمستلم. أضف رقم جهة اتصال أو أدخله يدوياً.",
  },
  wa_invalid_recipient: { en: "Phone number doesn't look valid.", ar: "رقم الجوال يبدو غير صالح." },
  wa_normalized_saudi: {
    en: "Saudi local number converted to international WhatsApp format.",
    ar: "تم تحويل الرقم المحلي السعودي إلى الصيغة الدولية لواتساب.",
  },
  wa_phase1_disclaimer: {
    en: "Compose only — you review and send from WhatsApp. PHC does not send messages automatically.",
    ar: "تجهيز فقط — تراجع وترسل من واتساب. لا يقوم النظام بإرسال أي رسالة تلقائياً.",
  },

  // Communication Hub — shared actions/timeline
  comm_log_activity: { en: "Log Activity", ar: "تسجيل نشاط" },
  comm_add_followup: { en: "Add Follow-up", ar: "إضافة متابعة" },
  comm_timeline_empty: { en: "No communication logged yet.", ar: "لا يوجد تواصل مسجَّل بعد." },
  comm_mark_sent: { en: "Mark as Sent", ar: "وسم كمُرسَل" },
  comm_marked_sent: { en: "Marked as sent", ar: "تم الوسم كمُرسَل" },
  comm_status_draft: { en: "Draft", ar: "مسودة" },
  comm_status_logged: { en: "Logged", ar: "مسجَّل" },
  comm_status_sent: { en: "Sent", ar: "مُرسَل" },
  comm_history: { en: "Communication History", ar: "سجل التواصل" },

  // Phase 0 UX — EmptyState 2.0 contextual titles and descriptions
  empty_title_accounts: { en: "No accounts yet", ar: "لا توجد حسابات بعد" },
  empty_desc_accounts: { en: "Add your first target account to start building your CRM.", ar: "أضف أول حساب مستهدف لبدء بناء قاعدة علاقاتك." },
  empty_title_contacts: { en: "No contacts yet", ar: "لا توجد جهات اتصال بعد" },
  empty_desc_contacts: { en: "Add decision makers and influencers to your contact network.", ar: "أضف صانعي القرار والمؤثرين إلى شبكة علاقاتك." },
  empty_desc_opportunities: { en: "Opportunities appear here once they are added to the pipeline.", ar: "ستظهر الفرص هنا بعد إضافتها إلى خط الأنابيب." },
  empty_title_tenders: { en: "No tenders yet", ar: "لا توجد مناقصات بعد" },
  empty_desc_tenders: { en: "Track tenders, deadlines, and conversion readiness from here.", ar: "تتبع المناقصات والمواعيد وجاهزية التحويل من هنا." },
  empty_title_action_center: { en: "Queue is clear", ar: "القائمة فارغة" },
  empty_desc_action_center: { en: "No active actions — the team is up to date.", ar: "لا توجد إجراءات نشطة — الفريق محدَّث." },
  empty_title_no_results: { en: "No results", ar: "لا نتائج" },
  empty_desc_no_results: { en: "No records match the current filters.", ar: "لا توجد سجلات تطابق الفلاتر الحالية." },
  empty_clear_filters: { en: "Clear filters", ar: "مسح الفلاتر" },

  // Phase 0 UX — ActionDialog inline validation
  dialog_field_required: { en: "This field is required", ar: "هذا الحقل مطلوب" },
  intake_routes_itself: { en: "Set the project type and name and this goes straight to the right track — no extra steps.", ar: "حدِّد نوع المشروع واسمه ليذهب مباشرة لمساره الصحيح — بلا خطوات إضافية." },
  intake_routed_opportunity: { en: "Opportunity created — opening it now", ar: "أُنشئت الفرصة — جارٍ فتحها" },
  intake_routed_tender: { en: "Tender created on the monitoring board", ar: "أُنشئت المناقصة في لوحة المراقبة" },
  nav_new_intake: { en: "New Entry", ar: "إدخال جديد" },
  section_submission: { en: "Submission", ar: "التقديم" },
  label_pending_on: { en: "Waiting on", ar: "بانتظار" },
  label_submission_status: { en: "Submission", ar: "حالة التقديم" },
  sub_status_not_started: { en: "Not started", ar: "لم يبدأ" },
  sub_status_in_progress: { en: "In progress", ar: "قيد الإعداد" },
  sub_status_submitted: { en: "Submitted", ar: "قُدِّم" },
  rfq_link_existing_project: { en: "Link to existing project (optional)", ar: "ربط بمشروع قائم (اختياري)" },
  dialog_paste_link: { en: "Paste a link (e.g. the email)", ar: "الصق رابطًا (رابط الإيميل مثلًا)" },
  dialog_or_upload: { en: "or upload", ar: "أو ارفع ملفًا" },
  dialog_date_invalid: { en: "Enter a valid date (YYYY-MM-DD)", ar: "أدخل تاريخًا صحيحًا (سنة-شهر-يوم)" },
  dialog_date_too_early: { en: "That date is too far in the past", ar: "هذا التاريخ قديم أكثر من اللازم" },
  dialog_date_too_late: { en: "That date is too far in the future — check the year", ar: "هذا التاريخ بعيد أكثر من اللازم — تأكد من السنة" },
  dialog_create_new: { en: "+ Add new", ar: "+ إضافة جديد" },
  dialog_reject_ai_output_title: { en: "Reject AI output", ar: "رفض مخرج الذكاء الاصطناعي" },
  dialog_reject_ai_output_desc: {
    en: "This marks the output as rejected. It has no effect on any other record.",
    ar: "هذا يسجّل رفض المخرج فقط، ولا يؤثر على أي بيانات أخرى.",
  },

  // Phase 0 UX — urgency labels for color-only fixes
  urgency_overdue: { en: "Overdue", ar: "متأخر" },
  urgency_due_soon: { en: "Due soon", ar: "يستحق قريبًا" },

  // Workspace Foundation — navigation labels (new keys; old keys retained for compatibility)
  nav_my_day: { en: "My Day", ar: "يومي" },
  nav_notifications: { en: "Notifications", ar: "الإشعارات" },
  nav_pipeline_overview: { en: "Pipeline Overview", ar: "نظرة خط المبيعات" },
  nav_intake: { en: "Intake", ar: "الاستقبال" },
  nav_awards: { en: "Awards", ar: "الترسيات" },
  nav_conversion_queue: { en: "Conversion Queue", ar: "طابور التحويل" },

  // Workspace Foundation — nav groups
  navgroup_workspace: { en: "Workspace", ar: "مساحة العمل" },
  navgroup_reports: { en: "Reports & Analysis", ar: "التقارير والتحليل" },
  navgroup_resources: { en: "Resources", ar: "الموارد" },

  // Command Palette
  // Agent Activity / AI Agents / Data Import.
  // QA 2026-08-10 (ISSUE-005): these three pages rendered most of their chrome
  // as hardcoded English under Arabic headings — /agent-activity measured 196
  // Latin words against 97 Arabic. Translations below are curated, not machine
  // output. Agent run summaries stay untranslated on purpose: they are row data
  // written by the agents, not UI strings.
  aa_eyebrow_governance: { en: "Governance", ar: "الحوكمة" },
  aa_project_radar: { en: "Project Radar", ar: "رادار المشاريع" },
  aa_scan_pipeline: { en: "Scan Pipeline", ar: "افحص خط المبيعات" },
  aa_scanning: { en: "Running…", ar: "جارٍ التشغيل…" },
  aa_radar_hint: {
    en: 'Click "Scan Pipeline" to run the Project Radar agent.',
    ar: 'اضغط "افحص خط المبيعات" لتشغيل وكيل رادار المشاريع.',
  },
  aa_kpi_runs: { en: "Runs (recent 200)", ar: "التشغيلات (آخر 200)" },
  aa_kpi_completed: { en: "Completed", ar: "مكتملة" },
  aa_kpi_not_configured: { en: "Not configured", ar: "غير مُهيأة" },
  aa_kpi_errors: { en: "Errors", ar: "أخطاء" },
  aa_runs_last_7: { en: "Runs — last 7 days", ar: "التشغيلات — آخر 7 أيام" },
  aa_search_placeholder: { en: "Search agent, summary", ar: "ابحث في الوكلاء والملخصات" },
  aa_all_agents: { en: "All agents", ar: "كل الوكلاء" },
  aa_tab_batch_runs: { en: "Batch Runs", ar: "التشغيلات الدفعية" },
  aa_tab_ai_outputs: { en: "AI Outputs", ar: "مخرجات الذكاء" },
  aa_empty_outputs: { en: "No AI agent outputs yet.", ar: "لا توجد مخرجات للوكلاء حتى الآن." },
  aa_scanned_suffix: { en: "scanned", ar: "سجل مفحوص" },
  aa_recommendations_suffix: { en: "recommendations", ar: "توصية" },
  aa_status_all: { en: "All", ar: "الكل" },
  aa_status_running: { en: "Running", ar: "قيد التشغيل" },
  aa_status_completed: { en: "Completed", ar: "مكتملة" },
  aa_status_failed: { en: "Failed", ar: "فاشلة" },
  aa_status_not_configured: { en: "Not configured", ar: "غير مُهيأة" },

  ag_eyebrow_intelligence: { en: "Intelligence", ar: "الذكاء" },
  ag_title: { en: "AI Agents", ar: "وكلاء الذكاء" },
  ag_description: {
    en: "Real-data agents. Every recommendation shows its evidence; nothing is applied automatically.",
    ar: "وكلاء تعمل على بيانات حقيقية. كل توصية تعرض دليلها، ولا يُطبَّق شيء تلقائياً.",
  },
  ag_run_agents: { en: "Run agents", ar: "تشغيل الوكلاء" },
  ag_lead_scoring: { en: "Lead Scoring", ar: "تقييم العملاء المحتملين" },
  ag_duplicate_detection: { en: "Duplicate Detection", ar: "كشف التكرار" },
  ag_weekly_report: { en: "Weekly Report", ar: "التقرير الأسبوعي" },
  ag_recommendations: { en: "Recommendations", ar: "التوصيات" },
  ag_empty_recommendations: {
    en: "No pending recommendations. Run an agent to generate evidence-backed suggestions.",
    ar: "لا توجد توصيات معلّقة. شغّل وكيلاً لتوليد اقتراحات مدعومة بالأدلة.",
  },
  ag_recent_runs: { en: "Recent runs", ar: "آخر التشغيلات" },

  di_eyebrow_data: { en: "Data", ar: "البيانات" },
  di_title: { en: "Import Center", ar: "مركز الاستيراد" },
  di_description: {
    en: "Upload and map structured data files into PHC.",
    ar: "ارفع ملفات البيانات المنظّمة وطابق أعمدتها داخل PHC.",
  },
  di_new_import: { en: "New Import", ar: "استيراد جديد" },
  di_choose_file_first: { en: "Choose a file first", ar: "اختر ملفاً أولاً" },
  di_import_failed: { en: "Import failed", ar: "فشل الاستيراد" },
  di_empty_active: { en: "No active imports.", ar: "لا توجد عمليات استيراد نشطة." },
  di_empty_active_hint: {
    en: "Start one with New Import above.",
    ar: "ابدأ واحدة عبر «استيراد جديد» بالأعلى.",
  },
  di_empty_profiles: {
    en: "No recurring source profiles yet.",
    ar: "لا توجد ملفات مصادر متكررة حتى الآن.",
  },
  di_empty_profiles_hint: {
    en: "Source profiles are created automatically when the AI classifies a recurring upload pattern.",
    ar: "تُنشأ ملفات المصادر تلقائياً عندما يصنّف الذكاء نمط رفع متكرراً.",
  },
  di_empty_processed: { en: "No processed batches yet.", ar: "لا توجد دفعات معالَجة حتى الآن." },
  di_status_uploading: { en: "Uploading…", ar: "جارٍ الرفع…" },
  di_status_parsing: { en: "Parsing…", ar: "جارٍ التحليل…" },
  di_status_map_columns: { en: "Map Columns", ar: "مطابقة الأعمدة" },
  di_status_validating: { en: "Validating", ar: "قيد التحقق" },
  di_status_duplicate_review: { en: "Review Duplicates", ar: "مراجعة التكرارات" },
  di_status_pending_approval: { en: "Needs Approval", ar: "بانتظار الاعتماد" },
  di_status_approved: { en: "Approved", ar: "معتمَدة" },
  di_status_dry_run: { en: "Dry Run", ar: "تشغيل تجريبي" },
  di_status_committed: { en: "Committed", ar: "مُثبَّتة" },
  di_status_rolled_back: { en: "Rolled Back", ar: "متراجَع عنها" },
  di_status_failed: { en: "Failed", ar: "فاشلة" },
  di_status_cancelled: { en: "Cancelled", ar: "ملغاة" },

  // Phase 2 — Intake & Opportunity Review (PRD 2026-08-12 §11-19).
  ibx_request_type: { en: "Request Type", ar: "نوع الطلب" },
  ibx_request_type_jih: { en: "JIH — contractor already has the job", ar: "JIH — المقاول يملك المشروع" },
  ibx_request_type_tender_contractor: { en: "Tender — contractors bidding", ar: "مناقصة — مقاولون يتنافسون" },
  ibx_request_type_tender_government: { en: "Tender — government / owner, pre-award", ar: "مناقصة — جهة حكومية/مالك، قبل الترسية" },
  ibx_request_type_unknown: { en: "Unknown / insufficient information", ar: "غير محدد / معلومات غير كافية" },
  // Client feedback 2026-08-25: the Opportunity Review table should say "JIH"
  // or "Tender" and nothing more — "no need to expand the meaning, it's better
  // to simplify". The long labels above stay, because they are what the New
  // Intake dropdown offers, and there the distinction is the whole point:
  // shortened, tender_contractor and tender_government would both read
  // "Tender" and become unpickable.
  ibx_rtype_short_jih: { en: "JIH", ar: "JIH" },
  ibx_rtype_short_tender_contractor: { en: "Tender", ar: "مناقصة" },
  ibx_rtype_short_tender_government: { en: "Tender", ar: "مناقصة" },
  ibx_rtype_short_unknown: { en: "—", ar: "—" },
  ibx_owner_entity: { en: "Owner / government entity", ar: "المالك / الجهة الحكومية" },
  ibx_client_rfq_ref: { en: "Client RFQ reference", ar: "مرجع طلب العميل" },
  ibx_internal_rfq_ref: { en: "Internal RFQ reference", ar: "المرجع الداخلي" },
  ibx_has_boq: { en: "BOQ received", ar: "وصل جدول الكميات" },
  ibx_has_drawings: { en: "Drawings received", ar: "وصلت المخططات" },
  ibx_has_specs: { en: "Specifications received", ar: "وصلت المواصفات" },
  intake_sent_for_review: { en: "Request saved and sent for review.", ar: "حُفظ الطلب وأُرسل للمراجعة." },

  // Review gate
  rev_queue_title: { en: "Opportunity Review", ar: "مراجعة الفرص" },
  rev_queue_intro: {
    en: "Every new request is reviewed here before it can go to pricing.",
    ar: "كل طلب جديد يُراجَع هنا قبل أن ينتقل إلى التسعير.",
  },
  rev_state_pending_review: { en: "Pending review", ar: "بانتظار المراجعة" },
  rev_state_approved_for_pricing: { en: "Approved for pricing", ar: "معتمَد للتسعير" },
  rev_state_need_information: { en: "Needs information", ar: "بحاجة إلى معلومات" },
  rev_state_monitored: { en: "Monitored", ar: "تحت المراقبة" },
  rev_state_rejected: { en: "Rejected", ar: "مرفوض" },
  rev_approve: { en: "Approve for Pricing", ar: "اعتماد للتسعير" },
  rev_need_info: { en: "Need Information", ar: "طلب معلومات" },
  rev_monitor: { en: "Monitor", ar: "مراقبة" },
  rev_reject: { en: "Reject", ar: "رفض" },
  rev_resubmit: { en: "Resubmit for review", ar: "إعادة الإرسال للمراجعة" },
  rev_required_items: { en: "What is missing", ar: "ما الناقص" },
  rev_required_items_hint: { en: "One per line", ar: "بند في كل سطر" },
  rev_comment: { en: "Comment", ar: "ملاحظة" },
  rev_responsible: { en: "Responsible", ar: "المسؤول" },
  rev_due_date: { en: "Due date", ar: "تاريخ الاستحقاق" },
  rev_reject_reason: { en: "Reason for rejection", ar: "سبب الرفض" },
  rev_no_authority: {
    en: "Only a Sales Manager or BD Manager can decide a review.",
    ar: "المراجعة من صلاحية مدير المبيعات أو مدير التطوير فقط.",
  },
  rev_empty: { en: "No requests are waiting for review.", ar: "لا توجد طلبات بانتظار المراجعة." },
  rev_approved_routed_jih: { en: "Approved — routed to the opportunity pipeline.", ar: "اعتُمد — وُجّه إلى خط الفرص." },
  rev_approved_routed_tender: { en: "Approved — routed to the tender board.", ar: "اعتُمد — وُجّه إلى لوحة المناقصات." },
  rev_approved_no_route: { en: "Approved, but the request type is unknown — set it, then route.", ar: "اعتُمد، لكن نوع الطلب غير محدد — حدّده ثم وجّه." },
  rev_resubmitted: { en: "Sent back for review.", ar: "أُعيد إرساله للمراجعة." },
  rev_info_requested: { en: "Information requested.", ar: "طُلبت المعلومات." },
  rev_monitored_done: { en: "Moved to monitoring.", ar: "نُقل إلى المراقبة." },
  rev_rejected_done: { en: "Request rejected.", ar: "رُفض الطلب." },
  rev_resubmit_count: { en: "Resubmissions", ar: "مرات إعادة الإرسال" },
  rev_ai_recommendation: { en: "AI qualification note", ar: "ملاحظة تأهيل من الذكاء" },
  // Expandable detail on a review row. Approving for pricing creates an
  // opportunity and moves the file to Commercial, and the queue showed four
  // fields out of the fifty-five the record carries — has_boq among them was
  // even being fetched and then not rendered.
  rev_show_details: { en: "Show details", ar: "عرض التفاصيل" },
  rev_hide_details: { en: "Hide details", ar: "إخفاء التفاصيل" },
  rev_details_scope: { en: "Scope & value", ar: "النطاق والقيمة" },
  rev_details_docs: { en: "Documents received", ar: "الوثائق المستلمة" },
  rev_details_parties: { en: "Parties & contact", ar: "الأطراف وجهة الاتصال" },
  rev_details_origin: { en: "Origin", ar: "المصدر" },
  rev_details_none: { en: "Not recorded", ar: "غير مُسجَّل" },
  rev_details_no_docs: { en: "No documents recorded", ar: "لا وثائق مُسجَّلة" },
  ibx_notes: { en: "Notes", ar: "ملاحظات" },
  ibx_main_contractor: { en: "Main Contractor", ar: "المقاول الرئيسي" },
  ibx_email: { en: "Email", ar: "البريد الإلكتروني" },
  ibx_phone: { en: "Phone", ar: "الهاتف" },
  ibx_info_due: { en: "Information due", ar: "موعد استلام الناقص" },

  cmd_placeholder: { en: "Search or ask PHC AI…", ar: "ابحث أو اسأل PHC AI…" },
  cmd_no_results: { en: "No results found.", ar: "لا نتائج." },
  cmd_pages: { en: "Pages", ar: "الصفحات" },
  cmd_records: { en: "Records", ar: "السجلات" },
  cmd_pinned: { en: "Pinned", ar: "المثبتة" },
  cmd_recent: { en: "Recent", ar: "الأخيرة" },

  // Notification Center
  notif_title: { en: "Notifications", ar: "الإشعارات" },
  notif_empty: { en: "You're all caught up", ar: "لا إشعارات جديدة" },
  notif_empty_desc: { en: "Approvals, assignments, and alerts will appear here.", ar: "ستظهر هنا الاعتمادات والتكليفات والتنبيهات." },
  notif_mark_all_read: { en: "Mark all read", ar: "وسم الكل كمقروء" },
  notif_dismiss: { en: "Dismiss", ar: "إخفاء" },

  // Notification types (Phase 4). Keys are notif_type_<notification_type>.
  notif_type_intake_review_requested: { en: "Intake review", ar: "مراجعة طلب" },
  notif_type_intake_need_information: { en: "Information requested", ar: "معلومات مطلوبة" },
  notif_type_intake_resubmitted: { en: "Resubmitted", ar: "أُعيد الإرسال" },
  notif_type_intake_approved: { en: "Approved for pricing", ar: "معتمد للتسعير" },
  notif_type_intake_rejected: { en: "Request rejected", ar: "طلب مرفوض" },
  notif_type_intake_assigned: { en: "Request assigned", ar: "طلب مُسند إليك" },
  notif_type_approval_requested: { en: "Approval requested", ar: "طلب اعتماد" },
  notif_type_approval_approved: { en: "Approved", ar: "تم الاعتماد" },
  notif_type_approval_rejected: { en: "Returned", ar: "أُعيد الطلب" },
  notif_type_stage_changed: { en: "Stage changed", ar: "تغيّرت المرحلة" },
  notif_type_handoff_changed: { en: "Commercial handoff", ar: "التسليم التجاري" },
  notif_type_assigned: { en: "Assigned to you", ar: "مُسند إليك" },
  notif_type_item_overdue: { en: "Overdue", ar: "متأخر" },

  // ---- Action Center (Phase 4 unified queue) ----
  ac_scope_mine: { en: "Mine", ar: "مهامي" },
  ac_scope_team: { en: "Team", ar: "الفريق" },
  ac_scope_all: { en: "All", ar: "الكل" },
  ac_urgency_all: { en: "Any time", ar: "أي وقت" },
  ac_urgency_overdue: { en: "Overdue", ar: "متأخر" },
  ac_urgency_due_today: { en: "Due today", ar: "مستحق اليوم" },
  ac_urgency_upcoming: { en: "Upcoming", ar: "قادم" },
  ac_filter_priority: { en: "Priority", ar: "الأولوية" },
  ac_filter_entity: { en: "Record type", ar: "نوع السجل" },
  ac_filter_owner: { en: "Owner", ar: "المسؤول" },
  ac_source_flag: { en: "Queue", ar: "قائمة الإجراءات" },
  ac_source_task: { en: "Task", ar: "مهمة" },
  ac_source_follow_up: { en: "Follow-up", ar: "متابعة" },
  ac_source_approval: { en: "Approval", ar: "اعتماد" },
  ac_source_intake_review: { en: "Intake", ar: "طلب وارد" },
  ac_kpi_blocking: { en: "Blocking", ar: "معطِّل" },
  ac_kpi_due_today: { en: "Due today", ar: "مستحق اليوم" },
  ac_why: { en: "Why", ar: "السبب" },

  // ---- My Workspace — today panel ----
  ws_today_title: { en: "What needs you today", ar: "ما يحتاجك اليوم" },
  ws_today_desc: { en: "Your highest-priority work across every queue.", ar: "أعلى أعمالك أولوية من كل القوائم." },
  ws_today_empty: { en: "Nothing needs you right now", ar: "لا شيء يحتاجك الآن" },
  ws_today_all: { en: "Open Action Center", ar: "فتح مركز الإجراءات" },

  // Quick Actions menu
  nav_quick_actions: { en: "Quick Actions", ar: "الإجراءات السريعة" },
  qa_log_activity: { en: "Log Activity", ar: "تسجيل نشاط" },
  qa_new_follow_up: { en: "New Follow-up", ar: "متابعة جديدة" },
  qa_new_opportunity: { en: "New Opportunity", ar: "فرصة جديدة" },
  qa_new_entry: { en: "New Entry", ar: "إدخال جديد" },
  new_entry_title: { en: "New Entry", ar: "إدخال جديد" },
  new_entry_type: { en: "Record Type", ar: "نوع السجل" },
  new_entry_type_intake: { en: "Intake", ar: "استقبال أولي (Intake)" },
  new_entry_type_lead: { en: "Lead", ar: "عميل محتمل" },
  new_entry_type_rfq: { en: "RFQ", ar: "طلب عرض سعر (RFQ)" },
  new_entry_type_quotation: { en: "Quotation", ar: "عرض سعر" },
  new_entry_type_boq: { en: "BOQ", ar: "جدول كميات (BOQ)" },

  // Pinned records
  pin_add: { en: "Pin to sidebar", ar: "تثبيت في الشريط" },
  pin_remove: { en: "Unpin", ar: "إلغاء التثبيت" },
} satisfies Dict;

type Key = keyof typeof strings;
/** Public alias so callers can type maps of translation keys. */
export type StringKey = Key;

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
  dir: "ltr" | "rtl";
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Must start as "en" on every render path — SSR, and the client's first
  // hydration pass — since the server can never see localStorage. Reading
  // the stored preference here (even behind a `typeof window` guard, which
  // only protects the *server* render) made the client's very first
  // hydration render disagree with the server-rendered HTML for every
  // translated string on the page whenever a user had "ar" saved — a
  // whole-tree hydration mismatch (React error #418) that left parts of
  // the page unresponsive to clicks. The real preference is applied after
  // mount instead (below), which is a normal post-hydration re-render, not
  // a hydration mismatch.
  const [lang, setLangState] = useState<Lang>("en");
  const hydratedFromStorage = useRef(false);

  useEffect(() => {
    // The one-time storage read/correction only applies to the very first
    // effect run after mount. Running it on every `lang` change (e.g. from
    // the user clicking the language switch) would compare the just-set
    // value against the *old* localStorage entry and revert it right back,
    // since storage is only written in the branch below.
    if (!hydratedFromStorage.current) {
      hydratedFromStorage.current = true;
      const stored = localStorage.getItem("phc-lang") as Lang | null;
      if (stored && stored !== lang) {
        setLangState(stored);
        return; // wait for the corrected re-render before touching the DOM/storage below
      }
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    }
    localStorage.setItem("phc-lang", lang);
  }, [lang]);

  const value: Ctx = {
    lang,
    setLang: setLangState,
    dir: lang === "ar" ? "rtl" : "ltr",
    t: (k) => {
      const entry = (strings as Record<string, Record<string, string>>)[k as string];
      if (!entry) return k as string;
      return entry[lang] ?? entry.en ?? (k as string);
    },
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/**
 * Arabic, with Western digits and a Gregorian calendar — the one Arabic locale
 * tag this app formats with. Both extensions are load-bearing.
 *
 * **`-u-nu-latn` — the digits.** Plain `ar-SA` renders Arabic-Indic digits:
 * SAR 63,407,478 reaches the screen as ٦٣٬٤٠٧٬٤٧٨. That is correct Arabic
 * typography and wrong for this business. Every figure people here reconcile a
 * number against — the ERP, a supplier quotation, a bank statement, a BOQ line
 * — is written in Western digits, so a reader has to transliterate before they
 * can compare, and a number nobody can compare at a glance is a number nobody
 * checks.
 *
 * **`-ca-gregory` — the calendar, and this one is not cosmetic.** `ar-SA`'s
 * default calendar is an ICU default, and ICU builds disagree. Measured on the
 * same date, 2026-08-27:
 *
 *   Chrome (production, live)  →  ٢٧ أغسطس ٢٠٢٦     gregory
 *   Node                       →  ٢٧ أغسطس ٢٠٢٦     gregory
 *   Bun                        →  ١٤ ربيع الأول ١٤٤٨ هـ   islamic-umalqura
 *
 * This app server-renders. A date formatted on the Worker and re-formatted in
 * the browser must agree, and with an unpinned calendar that is left to two
 * independent ICU builds — a hydration mismatch at best, and at worst an Arabic
 * user reading a Hijri date off a record whose contract deadline is Gregorian,
 * while the English toggle of the same screen shows the real one. Pinning costs
 * nothing and removes the whole class.
 *
 * Everything else stays Arabic: month names, weekday names, currency names,
 * word order, direction. This is a display choice, not a translation one.
 *
 * Use `localeFor()` rather than a bare "ar" or "ar-SA" anywhere a locale tag is
 * passed to Intl or a `toLocale*` method. Tests pin all of it.
 */
export const AR_LOCALE = "ar-SA-u-nu-latn-ca-gregory";

/**
 * The locale tag to format with.
 *
 * `en` defaults to "en-US"; pass "en-GB" (or another tag) where a screen has
 * deliberately chosen day-first dates. The Arabic side is never overridable —
 * that is the point of having this function.
 */
export function localeFor(lang: Lang, en: string = "en-US") {
  return lang === "ar" ? AR_LOCALE : en;
}

export function formatNumber(n: number | null | undefined, lang: Lang, opts?: Intl.NumberFormatOptions) {
  if (n == null) return "—";
  return new Intl.NumberFormat(localeFor(lang), opts).format(n);
}

export function formatCurrency(n: number | null | undefined, lang: Lang, currency = "SAR") {
  if (n == null) return "—";
  return formatNumber(n, lang, { style: "currency", currency, maximumFractionDigits: 0 });
}
