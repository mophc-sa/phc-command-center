import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
  nav_quotations: { en: "Quotations", ar: "عروض الأسعار" },
  nav_boq: { en: "BOQ Center", ar: "مركز الـ BOQ" },
  nav_targets: { en: "Targets & Performance", ar: "الأهداف والأداء" },
  nav_reports: { en: "Reports", ar: "التقارير" },
  nav_agent_activity: { en: "Agent Activity", ar: "نشاط الوكيل" },
  nav_team: { en: "Team & Permissions", ar: "الفريق والصلاحيات" },
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
  nav_award_queue: { en: "Award & Contract Queue", ar: "طابور الترسية والعقود" },
  nav_action_center: { en: "Action Required", ar: "الإجراءات المطلوبة" },
  nav_tender_conversion: { en: "Tender Conversion", ar: "تحويل المناقصات" },
  nav_lead_tender_inbox: { en: "Lead & Tender Inbox", ar: "صندوق العملاء والمناقصات" },

  // Sidebar / nav groups
  navgroup_overview: { en: "Overview", ar: "نظرة عامة" },
  navgroup_crm: { en: "CRM", ar: "إدارة العلاقات" },
  navgroup_pipeline: { en: "Pipeline", ar: "خط المبيعات" },
  navgroup_execution: { en: "Execution", ar: "التنفيذ" },
  navgroup_intelligence: { en: "Intelligence & Resources", ar: "المعلومات والموارد" },
  navgroup_admin: { en: "Admin", ar: "الإدارة" },

  // Sales stages (RFQ/JIH flow)
  sstage_rfq_received: { en: "RFQ Received", ar: "استلام طلب عرض سعر" },
  sstage_jih: { en: "Job In Hand", ar: "فرصة قائمة" },
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

  // Workflow generic
  wf_new_rfq: { en: "New RFQ", ar: "طلب عرض سعر جديد" },
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
  ibx_scope: { en: "Scope", ar: "النطاق" },
  ibx_estimated_value: { en: "Estimated Value", ar: "القيمة التقديرية" },
  ibx_deadline: { en: "Deadline", ar: "الموعد النهائي" },
  ibx_evidence_url: { en: "Evidence URL / Attachment", ar: "رابط الدليل / المرفق" },
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
  crm_phone: { en: "Phone", ar: "الجوال" },
  crm_email: { en: "Email", ar: "البريد" },
  crm_company: { en: "Company", ar: "الشركة" },
  crm_project_stage: { en: "Project Stage", ar: "مرحلة المشروع" },
  crm_completion: { en: "Completion", ar: "نسبة الإنجاز" },
  crm_signage_package: { en: "Signage Package", ar: "بكج اللوحات" },
  crm_expected_boq: { en: "Expected BOQ", ar: "BOQ المتوقع" },
  crm_main_contractor: { en: "Main Contractor", ar: "المقاول الرئيسي" },
  crm_total_value: { en: "Total Value", ar: "القيمة الإجمالية" },
  crm_no_accounts: { en: "No accounts yet. Add your first target account.", ar: "لا توجد حسابات بعد. أضف أول حساب مستهدف." },
  crm_no_contacts: { en: "No contacts yet.", ar: "لا توجد جهات اتصال بعد." },
  crm_no_projects: { en: "No projects yet.", ar: "لا توجد مشاريع بعد." },
  crm_internal_notes: { en: "Internal Notes", ar: "ملاحظات داخلية" },
  crm_linked_projects: { en: "Linked Projects", ar: "المشاريع المرتبطة" },
  crm_linked_contacts: { en: "Contacts", ar: "جهات الاتصال" },
  crm_linked_opportunities: { en: "Opportunities", ar: "الفرص" },
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

  // Contact authority
  authority_decision_maker: { en: "Decision Maker", ar: "صاحب القرار" },
  authority_influencer: { en: "Influencer", ar: "مؤثّر" },
  authority_technical_contact: { en: "Technical Contact", ar: "جهة فنية" },
  authority_unknown_authority: { en: "Unknown Authority", ar: "غير محدد" },
  location_site_office: { en: "Site Office", ar: "مكتب الموقع" },
  location_head_office: { en: "Head Office", ar: "المكتب الرئيسي" },
  location_unknown: { en: "Unknown", ar: "غير معروف" },

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
  label_phone: { en: "Phone", ar: "الهاتف" },
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
  toast_success: { en: "Success", ar: "تم بنجاح" },

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
  role_system_admin: { en: "System Admin", ar: "مدير النظام" },
  role_managing_director: { en: "Managing Director", ar: "العضو المنتدب" },
  role_general_manager: { en: "General Manager", ar: "المدير العام" },
  role_ceo: { en: "CEO", ar: "الرئيس التنفيذي" },
  role_sales_manager: { en: "Sales Manager", ar: "مدير المبيعات" },
  role_bd_manager: { en: "BD Manager", ar: "مدير التطوير" },
  role_sales_ops: { en: "Sales Ops", ar: "عمليات المبيعات" },
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
  target_sales: { en: "Sales (Won)", ar: "المبيعات (فوز)" },
  target_pipeline: { en: "Open Pipeline", ar: "الفرص المفتوحة" },
  target_quotations: { en: "Quotations Submitted", ar: "عروض مُرسلة" },
  target_activities: { en: "Activities Logged", ar: "النشاط المسجل" },
  label_target: { en: "Target", ar: "الهدف" },
  label_actual: { en: "Actual", ar: "الفعلي" },
  toast_target_saved: { en: "Target saved", ar: "تم حفظ الهدف" },
  targets_intro: {
    en: "Actuals are computed live from opportunities, quotations and follow-ups owned by each member this period.",
    ar: "الأرقام الفعلية تُحسب مباشرة من الفرص وعروض الأسعار والمتابعات المملوكة لكل عضو خلال الفترة.",
  },

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

export function formatNumber(n: number | null | undefined, lang: Lang, opts?: Intl.NumberFormatOptions) {
  if (n == null) return "—";
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  return new Intl.NumberFormat(locale, opts).format(n);
}

export function formatCurrency(n: number | null | undefined, lang: Lang, currency = "SAR") {
  if (n == null) return "—";
  return formatNumber(n, lang, { style: "currency", currency, maximumFractionDigits: 0 });
}
