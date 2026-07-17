import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, ListChecks, BellRing, ShieldCheck, Sparkles, FileText,
  Award, CheckCheck, Clock, Plus, ChevronDown, ChevronRight, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { ChartFrame } from "@/components/phc/ChartFrame";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonChart } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RecommendationCard } from "@/components/phc/RecommendationCard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useI18n, formatCurrency, formatNumber, type Lang } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { isSalesperson } from "@/lib/roles";
import { logActivity, type ActivityType } from "@/lib/activity-actions";
import { ACTIVE_FLAG_STATUSES } from "@/lib/workflow-actions";
import { acceptRecommendation, dismissRecommendation } from "@/lib/recommendation-actions";
import { completeFollowUp, rescheduleFollowUp } from "@/lib/opportunity-actions";
import { useRecentRecords } from "@/hooks/useRecentRecords";
import { RECORD_TYPE_ICONS } from "@/components/phc/CommandPalette";
import { humanize } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createRfqWithOpportunity, findContactByPhone } from "@/lib/rfq-actions";
import { daysUntil, daysSince, urgencyTone, urgencyLabel } from "@/lib/dashboard-helpers";

export const Route = createFileRoute("/_authenticated/my-workspace")({
  head: () => ({ meta: [{ title: "PHC Sales Dashboard — PHC" }, { name: "robots", content: "noindex" }] }),
  component: WorkspacePage,
});

const ACTIVITY_TYPES: ActivityType[] = ["call", "visit", "meeting", "note", "email_draft", "whatsapp_draft"];

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

const STAGE_ACTION: Record<string, { en: string; ar: string }> = {
  jih: { en: "Complete proposal / negotiation to reach BAFO", ar: "إتمام العرض أو التفاوض للوصول إلى BAFO" },
  jih_bafo: { en: "Finalize discount and obtain official award confirmation", ar: "إتمام الخصم والحصول على تأكيد الترسية الرسمي" },
  verbally_awarded: { en: "Obtain LOA / LOI / PO or official award document", ar: "الحصول على خطاب الترسية أو أمر الشراء" },
  contract_received: { en: "Review contract and resolve all commercial points", ar: "مراجعة العقد وحل جميع النقاط التجارية" },
  contract_signed: { en: "Complete handover and register as Awarded", ar: "إتمام التسليم وتسجيل الفرصة رسمياً" },
  won: { en: "Lock final awarded value and preserve award document", ar: "تأكيد القيمة النهائية وحفظ وثيقة الترسية" },
  rfq_received: { en: "Qualify opportunity and determine type (JIH or Tender)", ar: "تأهيل الفرصة وتحديد النوع" },
  under_negotiation: { en: "Close commercial negotiation and advance toward award", ar: "إغلاق التفاوض والمضي نحو الترسية" },
  tender_under_process: { en: "Confirm main contract result; consider JIH conversion", ar: "تأكيد نتيجة المناقصة والنظر في التحويل" },
  tender_bafo: { en: "Submit Tender BAFO and monitor main contract result", ar: "تقديم BAFO المناقصة ومتابعة نتيجة العقد الرئيسي" },
};

// ─── Pipeline diagram constants ──────────────────────────────────────────────

const STAGE_BOX_W = 108;
const ARROW_W = 22;

const PIPELINE_STAGES: Array<{
  key: string;
  label: { en: string; ar: string };
  isGoal?: boolean;
  note?: { en: string; ar: string };
}> = [
  { key: "tender",           label: { en: "Tender",                          ar: "مناقصة"                     } },
  { key: "tender_bafo",      label: { en: "Tender BAFO",                     ar: "BAFO مناقصة"                } },
  { key: "jih",              label: { en: "JIH",                             ar: "JIH"                        } },
  { key: "jih_bafo",         label: { en: "JIH BAFO",                        ar: "BAFO JIH"                   },
    note: { en: "Finalize discount & secure award confirmation", ar: "إتمام الخصم والحصول على تأكيد الترسية" } },
  { key: "verbally_awarded", label: { en: "Verbally Awarded",                ar: "ترسية شفهية"                },
    note: { en: "Get contractor LOA or SCA",                    ar: "الحصول على خطاب الترسية من المقاول"    } },
  { key: "contract_received",label: { en: "Contract Received / Final Neg.",  ar: "استلام العقد / التفاوض"     },
    note: { en: "Review, send comments & get final confirmation", ar: "مراجعة العقد وإرسال التعليقات والحصول على التأكيد النهائي" } },
  { key: "contract_signed",  label: { en: "Contract Signed",                 ar: "توقيع العقد"                } },
  { key: "won",              label: { en: "Awarded",                         ar: "ترسية نهائية"               }, isGoal: true },
];

// ─── Role router ─────────────────────────────────────────────────────────────

function WorkspacePage() {
  const { user, roles } = useAuth();
  const uid = user?.id ?? "";
  if (isSalesperson(roles)) return <SalespersonDashboard uid={uid} user={user} />;
  return <ExistingWorkspaceContent uid={uid} user={user} />;
}

// ─── Salesperson Dashboard ────────────────────────────────────────────────────

function SalespersonDashboard({ uid, user }: { uid: string; user: any }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  // Dialog state
  const [logOpen, setLogOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<{ id: string; oppId: string } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<{ id: string; oppId: string; currentDate: string } | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftFuId, setDraftFuId] = useState<string | null>(null);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqStep, setRfqStep] = useState<1 | 2>(1);
  const [rfqCreating, setRfqCreating] = useState(false);
  const [rfqDedupChecked, setRfqDedupChecked] = useState(false);
  const [rfqFoundContact, setRfqFoundContact] = useState<{ id: string; name: string; companyName: string } | null>(null);
  const [rfqForm, setRfqForm] = useState({ companyName: "", contactName: "", contactPhone: "", projectScope: "", responseDueDate: "", estimatedValue: "" });
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  function toggleStage(key: string) {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); return next; }
      if (next.size >= 2) { const first = next.values().next().value; if (first) next.delete(first); }
      next.add(key); return next;
    });
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: profile } = useQuery({
    queryKey: ["ws-profile", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle()).data,
  });

  const { data: annualTarget } = useQuery({
    queryKey: ["ws-annual-target", uid], enabled: !!uid,
    queryFn: async () => {
      const annYear = `${new Date().getFullYear()}-01-01`;
      const ann = await supabase.from("sales_targets").select("*").eq("user_id", uid).eq("period_type", "annual").eq("period_start", annYear).maybeSingle();
      if (ann.data) return ann.data;
      const mon = await supabase.from("sales_targets").select("*").eq("user_id", uid).eq("period_type", "monthly").order("period_start", { ascending: false }).limit(1).maybeSingle();
      return mon.data ?? null;
    },
  });

  const { data: awardedOpps = [], isLoading: loadingAwarded } = useQuery({
    queryKey: ["ws-awarded-full", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("opportunities").select("id, project_name, client, main_contractor, estimated_value_max, contract_value, currency, updated_at, sales_stage").eq("owner_id", uid).eq("stage", "won").gte("updated_at", yearStart()).order("updated_at", { ascending: false })).data ?? [],
  });

  const { data: stageOpps = [] } = useQuery({
    queryKey: ["ws-stage-opps", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("opportunities").select("id, project_name, client, main_contractor, sales_stage, estimated_value_max, contract_value, currency, verbal_award_date, expected_contract_date, contract_received_date, contract_reference_number, last_activity_at, next_action, updated_at").eq("owner_id", uid).in("sales_stage", ["verbally_awarded", "contract_received", "contract_signed"]).order("updated_at", { ascending: false })).data ?? [],
  });

  const { data: jihPipeline = [] } = useQuery({
    queryKey: ["ws-jih-pipeline", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("opportunities").select("id, project_name, sales_stage, estimated_value_max, currency, win_confidence, last_activity_at").eq("owner_id", uid).in("sales_stage", ["jih", "jih_bafo", "verbally_awarded", "contract_received", "contract_signed"]).order("updated_at", { ascending: false })).data ?? [],
  });

  const { data: activeTenders = [] } = useQuery({
    queryKey: ["ws-tenders-full", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("tenders").select("id, tender_name, tender_stage, estimated_project_value, expected_award_date, created_at").eq("tender_owner_id", uid).not("tender_stage", "in", "(converted_to_jih,tender_lost_or_archived)").order("expected_award_date", { ascending: true })).data ?? [],
  });

  const { data: urgentFUs = [] } = useQuery({
    queryKey: ["ws-urgent-fus", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("follow_ups").select("id, due_date, status, channel, notes, opportunity_id, opportunities(id, project_name, sales_stage, estimated_value_max, currency, main_contractor, last_activity_at, next_action)").eq("owner_id", uid).neq("status", "completed").neq("status", "cancelled").order("due_date", { ascending: true }).limit(25)).data ?? [],
  });

  const { data: urgentRfqs = [] } = useQuery({
    queryKey: ["ws-urgent-rfqs", uid], enabled: !!uid,
    queryFn: async () => {
      const sevenDaysOut = new Date(); sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
      return (await supabase.from("rfqs").select("id, rfq_number, response_due_date, estimated_value, status").eq("sales_owner_id", uid).eq("status", "open").not("response_due_date", "is", null).lte("response_due_date", sevenDaysOut.toISOString().slice(0, 10)).order("response_due_date", { ascending: true })).data ?? [];
    },
  });

  const { data: oldTenders = [] } = useQuery({
    queryKey: ["ws-tender-90d", uid], enabled: !!uid,
    queryFn: async () => {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
      return (await supabase.from("tenders").select("id, tender_name, tender_stage, estimated_project_value, created_at, expected_award_date").eq("tender_owner_id", uid).not("tender_stage", "in", "(converted_to_jih,tender_lost_or_archived)").lte("created_at", cutoff.toISOString()).order("created_at", { ascending: true })).data ?? [];
    },
  });

  const { data: myOpps = [] } = useQuery({
    queryKey: ["ws-myopps-min", uid], enabled: !!uid,
    queryFn: async () => (await supabase.from("opportunities").select("id, project_name").eq("owner_id", uid).not("stage", "in", "(won,lost,archived)").order("project_name")).data ?? [],
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const displayName = (profile as any)?.full_name ?? user?.email?.split("@")[0] ?? "—";
  const tgt = annualTarget;
  const salesTarget = tgt ? Number(tgt.sales_target) : 0;
  const awardedValue = (awardedOpps as any[]).reduce((s, o) => s + (Number(o.contract_value ?? o.estimated_value_max) || 0), 0);
  const achievementPct = salesTarget > 0 ? Math.round((awardedValue / salesTarget) * 100) : null;
  const remainingTarget = salesTarget > 0 ? Math.max(0, salesTarget - awardedValue) : null;
  const jihValue = (jihPipeline as any[]).reduce((s, o) => s + (o.estimated_value_max || 0), 0);
  const tenderValue = (activeTenders as any[]).reduce((s, t) => s + (t.estimated_project_value || 0), 0);
  const totalPipeline = jihValue + tenderValue;
  const jihSharePct = totalPipeline > 0 ? Math.round((jihValue / totalPipeline) * 100) : 0;
  const verballyAwardedOpps = (stageOpps as any[]).filter(o => o.sales_stage === "verbally_awarded");
  const contractOpps = (stageOpps as any[]).filter(o => o.sales_stage === "contract_received" || o.sales_stage === "contract_signed");

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleRfqPhoneBlur(phone: string) {
    if (!phone.trim()) return;
    const found = await findContactByPhone(phone);
    if (found) {
      const compName = (found as any).companies?.name ?? "";
      setRfqFoundContact({ id: found.id, name: found.name, companyName: compName });
      setRfqForm(f => ({ ...f, contactName: found.name, companyName: compName }));
    } else { setRfqFoundContact(null); }
    setRfqDedupChecked(true);
  }

  async function handleRfqSubmit() {
    if (!rfqForm.companyName || !rfqForm.projectScope || !rfqForm.responseDueDate) {
      toast.error(lang === "ar" ? "يرجى تعبئة الحقول المطلوبة" : "Fill required fields"); return;
    }
    setRfqCreating(true);
    try {
      const result = await createRfqWithOpportunity({
        companyName: rfqForm.companyName, contactName: rfqForm.contactName,
        contactPhone: rfqForm.contactPhone, existingContactId: rfqFoundContact?.id ?? null,
        projectScope: rfqForm.projectScope, responseDueDate: rfqForm.responseDueDate,
        estimatedValue: rfqForm.estimatedValue ? Number(rfqForm.estimatedValue) : null,
      });
      toast.success(t("ws_rfq_created"));
      setRfqOpen(false); setRfqStep(1);
      setRfqForm({ companyName: "", contactName: "", contactPhone: "", projectScope: "", responseDueDate: "", estimatedValue: "" });
      setRfqFoundContact(null); setRfqDedupChecked(false);
      qc.invalidateQueries({ queryKey: ["ws-urgent-rfqs", uid] });
      navigate({ to: "/opportunities/$id", params: { id: result.opportunityId } });
    } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
    finally { setRfqCreating(false); }
  }

  async function handleDraftFollowUp(followUpId: string, opportunityId: string, channel: string | null) {
    setDraftFuId(followUpId); setDraftLoading(true);
    try {
      const res = await supabase.functions.invoke("ai-orchestrator", { body: { agentKey: "smart_followup_draft", entityType: "opportunity", entityId: opportunityId, input: { follow_up_id: followUpId, channel: channel ?? "email" } } });
      if (res.error) throw new Error(String(res.error));
      const draft = res.data?.result?.draft_text ?? res.data?.result?.body ?? JSON.stringify(res.data?.result ?? {}, null, 2);
      setDraftContent(typeof draft === "string" ? draft : JSON.stringify(draft, null, 2));
      setDraftOpen(true);
    } catch (e: any) { toast.error((lang === "ar" ? "تعذّر إنشاء المسودة: " : "Draft failed: ") + e.message); }
    finally { setDraftLoading(false); setDraftFuId(null); }
  }

  if (loadingAwarded && !awardedOpps.length) return <SkeletonChart kpis={4} charts={3} />;

  // ── Render ────────────────────────────────────────────────────────────────

  const inputCls = "w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none";

  return (
    <div className="mx-auto max-w-7xl space-y-6">

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1 — Main Dashboard
      ═══════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">

        {/* Header: Hi [Name] + New RFQ */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "الصفحة الرئيسية" : "Main Page"} · {new Date().toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
            <div className="text-[22px] font-bold text-foreground">{lang === "ar" ? `مرحباً، ${displayName}` : `Hi, ${displayName}`}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRfqOpen(true); setRfqStep(1); }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-amber/90 px-4 text-[12px] font-semibold text-black transition-colors hover:bg-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Plus className="h-3.5 w-3.5" /> {t("ws_new_rfq")}
            </button>
            <button
              onClick={() => setLogOpen(true)}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t("ws_log_activity")}
            </button>
          </div>
        </div>

        {/* Row 1: Circular gauge + Target KPIs */}
        <div className="rounded-xl border border-border/60 bg-surface/40 p-5">
          <div className="flex flex-wrap items-center gap-6">
            {/* Donut chart */}
            <TargetDonut
              salesTarget={salesTarget}
              awardedValue={awardedValue}
              jihValue={jihValue}
              lang={lang}
              achievementPct={achievementPct}
            />
            {/* KPI boxes right of gauge */}
            <div className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                <TargetKpiBox
                  label={lang === "ar" ? "المبلغ المستهدف" : "Target Amount"}
                  value={salesTarget > 0 ? formatCurrency(salesTarget, lang, "SAR") : "—"}
                  sub={tgt?.period_type === "annual" ? (lang === "ar" ? "هدف سنوي" : "Annual target") : (lang === "ar" ? "هدف شهري" : "Monthly target")}
                />
                <TargetKpiBox
                  label={lang === "ar" ? "ترسيات رسمية" : "Awarded Contracts"}
                  value={formatCurrency(awardedValue, lang, "SAR")}
                  sub={`${awardedOpps.length} ${lang === "ar" ? "مشروع" : "projects"}`}
                  tone="positive"
                />
                {remainingTarget !== null && (
                  <TargetKpiBox
                    label={lang === "ar" ? "المتبقي من الهدف" : "Remaining Target"}
                    value={formatCurrency(remainingTarget, lang, "SAR")}
                    tone={remainingTarget < salesTarget * 0.3 ? "positive" : "attention"}
                  />
                )}
              </div>
              {/* Chart legend */}
              {salesTarget > 0 && (
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#4ade80]" />
                    {lang === "ar" ? "ترسيات رسمية" : "Awarded"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber" />
                    {lang === "ar" ? "JIH في الإنجاز" : "JIH Pipeline"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-structural/60" />
                    {lang === "ar" ? "فجوة الهدف" : "Target Gap"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Nav links + Summary of Leads */}
        <div className="grid gap-4 lg:grid-cols-2">

          {/* Navigation links panel */}
          <div className="rounded-xl border border-border/60 bg-surface/40 p-4 space-y-2">
            <StageDashLink
              label={lang === "ar" ? "عرض الترسيات الرسمية" : "View Awarded Contracts"}
              count={awardedOpps.length}
              to="/opportunities"
              tone="positive"
            />
            <StageDashLink
              label={lang === "ar" ? "عرض التفاوض النهائي" : "View Final Negotiation"}
              count={contractOpps.length}
              to="/opportunities"
              tone="attention"
            />
            <StageDashLink
              label={lang === "ar" ? "عرض الترسيات الشفهية" : "View Verbally Awarded"}
              count={verballyAwardedOpps.length}
              to="/opportunities"
              tone="neutral"
            />
          </div>

          {/* Summary of Leads panel */}
          <div className="rounded-xl border border-border/60 bg-surface/40 p-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-4">
              {lang === "ar" ? "ملخص الفرص" : "Summary of Leads"}
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "إجمالي JIH" : "Total JIH"}</div>
                  <div className="text-[11px] text-muted-foreground">{jihPipeline.length} {lang === "ar" ? "فرصة" : "opportunities"}</div>
                </div>
                <span className="num text-[18px] font-bold text-amber-light">{formatCurrency(jihValue, lang, "SAR")}</span>
              </div>
              <div className="h-px bg-border/30" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "إجمالي المناقصات" : "Total Tenders"}</div>
                  <div className="text-[11px] text-muted-foreground">{activeTenders.length} {lang === "ar" ? "مناقصة" : "tenders"}</div>
                </div>
                <span className="num text-[18px] font-bold text-foreground">{formatCurrency(tenderValue, lang, "SAR")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: Urgent Follow-ups + Urgent Quotation Submissions */}
        <div className="grid gap-4 lg:grid-cols-2">

          {/* Urgent Follow-ups table */}
          <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
            <div className="border-b border-border/40 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold text-foreground">{lang === "ar" ? "متابعات عاجلة" : "Urgent Follow Ups"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {(urgentFUs as any[]).filter(f => (daysUntil(f.due_date) ?? 1) <= 0).length} {lang === "ar" ? "متأخرة" : "overdue"} · {(urgentFUs as any[]).length} {lang === "ar" ? "إجمالي" : "total"}
                </div>
              </div>
            </div>
            {(urgentFUs as any[]).length === 0 ? (
              <div className="px-4 py-8"><EmptyState message={lang === "ar" ? "لا متابعات عاجلة" : "No urgent follow-ups"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "المشروع" : "Project Name"}</th>
                      <th className="px-4 py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "القيمة" : "Amount"}</th>
                      <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "الحالة" : "Status"}</th>
                      <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "إجراء" : "Action"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(urgentFUs as any[]).slice(0, 8).map(f => {
                      const opp = f.opportunities as any;
                      const days = daysUntil(f.due_date);
                      return (
                        <tr key={f.id} className="border-t border-border/20 hover:bg-surface-2/30">
                          <td className="px-4 py-2.5">
                            {f.opportunity_id ? (
                              <Link to="/opportunities/$id" params={{ id: f.opportunity_id }} className="block max-w-[140px] truncate font-medium text-foreground hover:underline">{opp?.project_name ?? "—"}</Link>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right num text-muted-foreground">{opp?.estimated_value_max ? formatCurrency(opp.estimated_value_max, lang, "SAR") : "—"}</td>
                          <td className="px-4 py-2.5"><StatusPill tone={urgencyTone(days)}>{urgencyLabel(days, lang)}</StatusPill></td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => setCompleteFor({ id: f.id, oppId: f.opportunity_id })} title={lang === "ar" ? "تمت" : "Complete"} className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><CheckCheck className="h-3 w-3" /></button>
                              <button onClick={() => setRescheduleFor({ id: f.id, oppId: f.opportunity_id, currentDate: f.due_date ?? "" })} title={lang === "ar" ? "إعادة جدولة" : "Reschedule"} className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-border/70 text-muted-foreground hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><CalendarClock className="h-3 w-3" /></button>
                              {f.opportunity_id && <button onClick={() => handleDraftFollowUp(f.id, f.opportunity_id, f.channel)} disabled={draftLoading && draftFuId === f.id} title="AI Draft" className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-border/70 text-muted-foreground hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><Sparkles className="h-3 w-3" /></button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Urgent Quotation Submissions table */}
          <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
            <div className="border-b border-border/40 px-4 py-3">
              <div className="text-[13px] font-semibold text-foreground">{lang === "ar" ? "تقديمات عروض أسعار عاجلة" : "Urgent Quotation Submissions"}</div>
              <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "خلال 7 أيام القادمة" : "Due within 7 days"}</div>
            </div>
            {(urgentRfqs as any[]).length === 0 ? (
              <div className="px-4 py-8"><EmptyState message={lang === "ar" ? "لا تقديمات عاجلة هذا الأسبوع" : "No urgent submissions this week"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "رقم الطلب" : "Project Name"}</th>
                      <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "الموعد النهائي" : "Deadline"}</th>
                      <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "الحالة" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(urgentRfqs as any[]).map(r => {
                      const days = daysUntil(r.response_due_date);
                      return (
                        <tr key={r.id} className="border-t border-border/20 hover:bg-surface-2/30">
                          <td className="px-4 py-2.5 font-medium text-foreground">{r.rfq_number || r.id.slice(0, 8)}</td>
                          <td className="px-4 py-2.5 num text-muted-foreground">{r.response_due_date || "—"}</td>
                          <td className="px-4 py-2.5"><StatusPill tone={urgencyTone(days)}>{urgencyLabel(days, lang)}</StatusPill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — Stage Details (3 side-by-side panels)
      ═══════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">

          {/* Panel A — Awarded Projects */}
          <div className="rounded-xl border border-won-border bg-won-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-won-border/60 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold text-won">{lang === "ar" ? "الترسيات الرسمية" : "Awarded Projects"}</div>
                <div className="text-[11px] text-muted-foreground">{formatCurrency(awardedValue, lang, "SAR")}</div>
              </div>
              <span className="rounded-full bg-won-surface/80 px-2 py-0.5 text-[11px] num text-won">{awardedOpps.length}</span>
            </div>
            {(awardedOpps as any[]).length === 0 ? (
              <div className="px-4 py-6"><EmptyState message={lang === "ar" ? "لا ترسيات هذا العام" : "No awarded contracts this year"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-won-border/40">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "المشروع" : "Project"}</th>
                      <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "القيمة" : "Value"}</th>
                      <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "الحالة" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(awardedOpps as any[]).slice(0, 6).map(o => (
                      <tr key={o.id} className="border-t border-won-border/40 hover:bg-won-surface">
                        <td className="px-3 py-2.5">
                          <Link to="/opportunities/$id" params={{ id: o.id }} className="block max-w-[120px] truncate font-medium text-foreground hover:underline">{o.project_name}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-right num text-[11px] text-won">{formatCurrency(o.contract_value ?? o.estimated_value_max, lang, o.currency || "SAR")}</td>
                        <td className="px-3 py-2.5"><StatusPill tone="positive">{lang === "ar" ? "رسمي" : "Won"}</StatusPill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel B — Final Negotiation */}
          <div className="rounded-xl border border-amber/20 bg-amber/5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-amber/15 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold text-amber-light">{lang === "ar" ? "التفاوض النهائي" : "Final Negotiation"}</div>
                <div className="text-[11px] text-muted-foreground">{formatCurrency(contractOpps.reduce((s: number, o: any) => s + (o.contract_value ?? o.estimated_value_max ?? 0), 0), lang, "SAR")}</div>
              </div>
              <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] num text-amber-light">{contractOpps.length}</span>
            </div>
            {contractOpps.length === 0 ? (
              <div className="px-4 py-6"><EmptyState message={lang === "ar" ? "لا عقود بانتظار المراجعة" : "No contracts pending"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-amber/10">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "المشروع" : "Project"}</th>
                      <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "القيمة" : "Value"}</th>
                      <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "المرحلة" : "Current Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractOpps.slice(0, 6).map((o: any) => (
                      <tr key={o.id} className="border-t border-amber/10 hover:bg-amber/5">
                        <td className="px-3 py-2.5">
                          <Link to="/opportunities/$id" params={{ id: o.id }} className="block max-w-[120px] truncate font-medium text-foreground hover:underline">{o.project_name}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-right num text-[11px]">{formatCurrency(o.contract_value ?? o.estimated_value_max, lang, o.currency || "SAR")}</td>
                        <td className="px-3 py-2.5"><StatusPill tone="attention">{t(`sstage_${o.sales_stage}` as never)}</StatusPill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel C — Verbally Awarded */}
          <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold text-foreground">{lang === "ar" ? "ترسية شفهية" : "Verbally Awarded"}</div>
                <div className="text-[11px] text-muted-foreground">{formatCurrency(verballyAwardedOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")}</div>
              </div>
              <span className="rounded-full bg-surface-2/60 px-2 py-0.5 text-[11px] num text-foreground">{verballyAwardedOpps.length}</span>
            </div>
            {verballyAwardedOpps.length === 0 ? (
              <div className="px-4 py-6"><EmptyState message={lang === "ar" ? "لا ترسيات شفهية" : "No verbal awards"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "المشروع" : "Project"}</th>
                      <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "القيمة" : "Value"}</th>
                      <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "أيام انتظار" : "Waiting"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verballyAwardedOpps.slice(0, 6).map((o: any) => {
                      const waitDays = daysSince(o.verbal_award_date);
                      return (
                        <tr key={o.id} className="border-t border-border/20 hover:bg-surface-2/30">
                          <td className="px-3 py-2.5">
                            <Link to="/opportunities/$id" params={{ id: o.id }} className="block max-w-[120px] truncate font-medium text-foreground hover:underline">{o.project_name}</Link>
                          </td>
                          <td className="px-3 py-2.5 text-right num text-[11px]">{formatCurrency(o.estimated_value_max, lang, o.currency || "SAR")}</td>
                          <td className="px-3 py-2.5">
                            {waitDays !== null
                              ? <StatusPill tone={waitDays > 30 ? "danger" : waitDays > 14 ? "attention" : "neutral"}>{waitDays}{lang === "ar" ? "ي" : "d"}</StatusPill>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* View All CTA buttons */}
        <div className="flex items-center justify-center gap-3 pt-1">
          <Link
            to="/opportunities"
            search={{} as any}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber/40 bg-amber/5 px-5 text-[12px] font-medium text-amber-light transition-colors hover:bg-amber/10"
          >
            {lang === "ar" ? "عرض كل الفرص (JIH)" : "View All JIH"} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/tenders"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            {lang === "ar" ? "عرض كل المناقصات" : "View All Tenders"} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* 90-day tenders alert (conditional) */}
      {(oldTenders as any[]).length > 0 && (
        <section className="rounded-xl border border-amber/25 bg-amber/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-light" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-amber-light">
                {oldTenders.length} {lang === "ar" ? "مناقصة تجاوزت 90 يومًا دون مراجعة" : "tenders older than 90 days without review"}
              </div>
              <p className="mt-0.5 text-[12px] text-amber-light/80">
                {lang === "ar" ? "يرجى تأكيد نتيجة المناقصة واتخاذ أحد الإجراءات: تحويل إلى JIH، وضع علامة خاملة، أو إغلاق." : "Confirm the main contract result and take action: convert to JIH, mark dormant, or close."}
              </p>
              <Link to="/tenders" className="mt-2 inline-flex items-center gap-1 text-[12px] text-amber-light hover:underline">
                {lang === "ar" ? "مراجعة المناقصات" : "Review Tenders"} <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      <ActionDialog open={logOpen} onOpenChange={setLogOpen} title={t("ws_log_activity")} submitLabel={t("crm_add")}
        fields={[
          { key: "type", type: "select", label: t("crm_filter_all_types"), required: true, defaultValue: "call", options: ACTIVITY_TYPES.map(a => ({ value: a, label: t(`activity_type_${a}` as never) })) },
          { key: "opportunityId", type: "select", label: t("crm_linked_opportunities"), options: [{ value: "", label: "—" }, ...(myOpps as any[]).map(o => ({ value: o.id, label: o.project_name }))] },
          { key: "summary", type: "text", label: t("activity_summary") },
          { key: "draftContent", type: "textarea", label: t("activity_draft_body") },
        ]}
        onSubmit={async v => {
          try { await logActivity({ type: v.type as ActivityType, opportunityId: v.opportunityId || null, summary: v.summary || undefined, draftContent: v.draftContent || undefined }); toast.success(t("crm_saved")); }
          catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog open={!!completeFor} onOpenChange={v => !v && setCompleteFor(null)} title={t("dialog_complete_title")} description={t("dialog_complete_desc")} submitLabel={t("action_complete")}
        fields={[{ key: "outcome", type: "textarea", label: t("field_outcome"), required: true }]}
        onSubmit={async v => {
          try { await completeFollowUp({ followUpId: completeFor!.id, opportunityId: completeFor!.oppId, outcome: v.outcome }); toast.success(t("toast_complete_ok" as never)); qc.invalidateQueries({ queryKey: ["ws-urgent-fus", uid] }); }
          catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog open={!!rescheduleFor} onOpenChange={v => !v && setRescheduleFor(null)} title={lang === "ar" ? "إعادة جدولة المتابعة" : "Reschedule Follow-up"} submitLabel={lang === "ar" ? "إعادة الجدولة" : "Reschedule"}
        fields={[{ key: "dueDate", type: "date", label: lang === "ar" ? "التاريخ الجديد" : "New date", required: true, defaultValue: rescheduleFor?.currentDate ?? "" }, { key: "notes", type: "textarea", label: lang === "ar" ? "ملاحظات" : "Notes (optional)" }]}
        onSubmit={async v => {
          try { await rescheduleFollowUp({ followUpId: rescheduleFor!.id, opportunityId: rescheduleFor!.oppId, dueDate: v.dueDate, notes: v.notes || undefined }); toast.success(lang === "ar" ? "تمت إعادة الجدولة" : "Rescheduled"); qc.invalidateQueries({ queryKey: ["ws-urgent-fus", uid] }); }
          catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <AlertDialog open={draftOpen} onOpenChange={setDraftOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{lang === "ar" ? "مسودة المتابعة" : "Follow-up Draft"}</AlertDialogTitle>
            <AlertDialogDescription>{lang === "ar" ? "مسودة مقترحة من الذكاء الاصطناعي — راجعها قبل الإرسال." : "AI-suggested draft — review before sending."}</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea value={draftContent} onChange={e => setDraftContent(e.target.value)} rows={10} className="mt-2 w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground focus:border-border-strong focus:outline-none" />
          <AlertDialogFooter>
            <AlertDialogCancel>{lang === "ar" ? "إغلاق" : "Close"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (draftContent) navigator.clipboard.writeText(draftContent).then(() => toast.success(lang === "ar" ? "تم النسخ" : "Copied")).catch(() => {}); setDraftOpen(false); }}>{lang === "ar" ? "نسخ" : "Copy"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RFQ Quick-Create Dialog — Steps 1 & 2 */}
      <Dialog open={rfqOpen} onOpenChange={v => { if (!rfqCreating) { setRfqOpen(v); if (!v) { setRfqStep(1); setRfqFoundContact(null); setRfqDedupChecked(false); } } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("ws_new_rfq")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-5 py-2">
            {/* Step 1 — Opportunity Details */}
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("ws_rfq_step1")}</div>
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_contact_phone")}</Label>
                <input type="tel" value={rfqForm.contactPhone} onChange={e => { setRfqForm(f => ({ ...f, contactPhone: e.target.value })); setRfqDedupChecked(false); setRfqFoundContact(null); }} onBlur={e => handleRfqPhoneBlur(e.target.value)} placeholder="+966…" className={inputCls} />
                {rfqDedupChecked && rfqFoundContact && <p className="text-[11px] text-won">✓ {t("ws_dedup_found")} {rfqFoundContact.name} ({rfqFoundContact.companyName})</p>}
                {rfqDedupChecked && !rfqFoundContact && <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "جهة اتصال جديدة" : "New contact"}</p>}
              </div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_company")} *</Label><input type="text" value={rfqForm.companyName} onChange={e => setRfqForm(f => ({ ...f, companyName: e.target.value }))} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_project")} *</Label><textarea value={rfqForm.projectScope} onChange={e => setRfqForm(f => ({ ...f, projectScope: e.target.value }))} rows={2} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_value")}</Label><input type="number" value={rfqForm.estimatedValue} onChange={e => setRfqForm(f => ({ ...f, estimatedValue: e.target.value }))} className={inputCls} /></div>
            </div>
            {/* Step 2 — Contact Details */}
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("ws_rfq_step2")}</div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_contact")}</Label><input type="text" value={rfqForm.contactName} onChange={e => setRfqForm(f => ({ ...f, contactName: e.target.value }))} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_due")} *</Label><input type="date" value={rfqForm.responseDueDate} onChange={e => setRfqForm(f => ({ ...f, responseDueDate: e.target.value }))} className={inputCls} /></div>
              <div className="mt-auto rounded-md border border-dashed border-border/50 bg-surface-2/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                {lang === "ar" ? "سيتم إضافة جهة الاتصال تلقائيًا إلى قاعدة بيانات جهات الاتصال." : "Contact will be automatically added to the Contacts Database."}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setRfqOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
                <Button size="sm" onClick={handleRfqSubmit} disabled={rfqCreating || !rfqForm.companyName || !rfqForm.projectScope || !rfqForm.responseDueDate}>
                  {rfqCreating ? (lang === "ar" ? "جارٍ الإنشاء…" : "Creating…") : (lang === "ar" ? "إنشاء الطلب" : "Create RFQ")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Existing Workspace (manager / other roles) ───────────────────────────────

function ExistingWorkspaceContent({ uid, user }: { uid: string; user: any }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [logOpen, setLogOpen] = useState(false);
  const [tab, setTab] = useState("today");
  const [completeFor, setCompleteFor] = useState<{ id: string; oppId: string } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<{ id: string; oppId: string; currentDate: string } | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftContent, setDraftContent] = useState<string>("");
  const [draftFuId, setDraftFuId] = useState<string | null>(null);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqStep, setRfqStep] = useState<1 | 2>(1);
  const [rfqCreating, setRfqCreating] = useState(false);
  const [rfqDedupChecked, setRfqDedupChecked] = useState(false);
  const [rfqFoundContact, setRfqFoundContact] = useState<{ id: string; name: string; companyName: string } | null>(null);
  const [rfqForm, setRfqForm] = useState({ companyName: "", contactName: "", contactPhone: "", projectScope: "", responseDueDate: "", estimatedValue: "" });
  const { recent } = useRecentRecords();

  const { data, isLoading } = useQuery({
    queryKey: ["workspace", uid], enabled: !!uid,
    queryFn: async () => {
      const [target, accounts, opps, followups, tasks, activities, approvals] = await Promise.all([
        supabase.from("sales_targets").select("*").eq("user_id", uid).eq("period_start", monthStart()).maybeSingle(),
        supabase.from("companies").select("id, name, company_type, account_status").eq("account_owner_id", uid).order("updated_at", { ascending: false }),
        supabase.from("opportunities").select("id, project_name, stage, tier, pipeline_step, estimated_value_max, currency, owner_id").eq("owner_id", uid).not("stage", "in", "(won,lost,archived)").order("updated_at", { ascending: false }),
        supabase.from("follow_ups").select("id, opportunity_id, due_date, status, channel, cadence_tier, notes").eq("owner_id", uid).neq("status", "completed").order("due_date", { ascending: true }),
        supabase.from("tasks").select("id, title, due_date, status").eq("owner_id", uid).neq("status", "done").order("due_date", { ascending: true }),
        supabase.from("activities").select("id, activity_type, summary, occurred_at, related_opportunity_id").eq("owner_id", uid).order("occurred_at", { ascending: false }).limit(12),
        supabase.from("approvals").select("*").eq("status", "pending"),
      ]);
      return { target: target.data, accounts: accounts.data ?? [], opps: opps.data ?? [], followups: followups.data ?? [], tasks: tasks.data ?? [], activities: activities.data ?? [], approvals: approvals.data ?? [] };
    },
  });

  const { data: myOpps = [] } = useQuery({ queryKey: ["ws-opps-min", uid], enabled: !!uid, queryFn: async () => (await supabase.from("opportunities").select("id, project_name").eq("owner_id", uid).order("project_name")).data ?? [] });
  const { data: recs = [] } = useQuery({ queryKey: ["ws-recs", uid], enabled: !!uid, queryFn: async () => (await supabase.from("recommendations").select("*").eq("suggested_owner_id", uid).eq("status", "pending").order("created_at", { ascending: false })).data ?? [] });
  const myOppIds = useMemo(() => (data?.opps ?? []).map((o: any) => o.id), [data]);
  const { data: flags = [] } = useQuery({ queryKey: ["ws-flags", uid, myOppIds.length], enabled: !!uid && myOppIds.length > 0, queryFn: async () => (await supabase.from("opportunity_flags").select("*").in("status", ACTIVE_FLAG_STATUSES).eq("linked_record_type", "opportunity").in("linked_record_id", myOppIds).order("created_at", { ascending: false })).data ?? [] });
  const { data: myRfqs = [] } = useQuery({ queryKey: ["ws-rfqs", uid], enabled: !!uid, queryFn: async () => (await supabase.from("rfqs").select("id, rfq_number, status, estimated_value, response_due_date").eq("sales_owner_id", uid).eq("status", "open").order("response_due_date", { ascending: true })).data ?? [] });
  const { data: myTenders = [] } = useQuery({ queryKey: ["ws-tenders", uid], enabled: !!uid, queryFn: async () => (await supabase.from("tenders").select("id, tender_name, tender_stage, tender_priority_classification, estimated_project_value, expected_award_date").eq("tender_owner_id", uid).not("tender_stage", "in", "(converted_to_jih,tender_lost_or_archived)").order("expected_award_date", { ascending: true })).data ?? [] });
  const { data: awardedOpps = [] } = useQuery({ queryKey: ["ws-awarded", uid], enabled: !!uid, queryFn: async () => (await supabase.from("opportunities").select("id, project_name, estimated_value_max, currency, sales_stage, updated_at").eq("owner_id", uid).eq("stage", "won").gte("updated_at", yearStart()).order("updated_at", { ascending: false })).data ?? [] });
  const { data: urgentQuotations = [] } = useQuery({
    queryKey: ["ws-urgent-quotations", uid], enabled: !!uid,
    queryFn: async () => { const sevenDaysOut = new Date(); sevenDaysOut.setDate(sevenDaysOut.getDate() + 7); return (await supabase.from("quotations").select("id, related_opportunity_id, status, valid_until, total_value, currency").eq("owner_id", uid).in("status", ["approved_for_submission", "submitted", "follow_up"]).lte("valid_until", sevenDaysOut.toISOString().slice(0, 10)).order("valid_until", { ascending: true })).data ?? []; },
  });
  const { data: jihOpps = [] } = useQuery({ queryKey: ["ws-jih", uid], enabled: !!uid, queryFn: async () => (await supabase.from("opportunities").select("id, project_name, sales_stage, estimated_value_max, currency, win_confidence").eq("owner_id", uid).in("sales_stage", ["jih", "jih_bafo"]).order("updated_at", { ascending: false })).data ?? [] });

  if (isLoading || !data) return <SkeletonChart kpis={4} charts={2} />;

  const pipelineValue = data.opps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0);
  const tg = data.target;
  const awardedValue = (awardedOpps as any[]).reduce((s, o) => s + (o.estimated_value_max ?? 0), 0);
  const achievementPct = tg?.sales_target ? Math.round((awardedValue / tg.sales_target) * 100) : null;
  const overdueFU = data.followups.filter((f: any) => f.status === "overdue" || (f.due_date && f.due_date < today));
  const todayFU = data.followups.filter((f: any) => f.due_date === today);
  const upcomingFU = data.followups.filter((f: any) => f.due_date && f.due_date > today);
  const overdueTasks = data.tasks.filter((tk: any) => tk.due_date && tk.due_date < today);
  const todayTasks = data.tasks.filter((tk: any) => tk.due_date === today);
  const upcomingTasks = data.tasks.filter((tk: any) => !tk.due_date || tk.due_date > today);
  const myApprovals = data.approvals.filter((a: any) => a.assigned_approver === uid || a.requested_by === uid);
  const tierAOpps = data.opps.filter((o: any) => o.tier === "A");
  const missingDataFlags = (flags as any[]).filter(f => f.flag_kind === "action_required");
  const oppName = (id: string | null) => (id ? data.opps.find((o: any) => o.id === id)?.project_name ?? "—" : "—");

  const handleDraftFollowUp = async (followUpId: string, opportunityId: string, channel: string | null) => {
    setDraftFuId(followUpId); setDraftLoading(true);
    try {
      const res = await supabase.functions.invoke("ai-orchestrator", { body: { agentKey: "smart_followup_draft", entityType: "opportunity", entityId: opportunityId, input: { follow_up_id: followUpId, channel: channel ?? "email" } } });
      if (res.error) throw new Error(String(res.error));
      const draft = res.data?.result?.draft_text ?? res.data?.result?.body ?? JSON.stringify(res.data?.result ?? {}, null, 2);
      setDraftContent(typeof draft === "string" ? draft : JSON.stringify(draft, null, 2));
      setDraftOpen(true);
    } catch (e: any) { toast.error((lang === "ar" ? "تعذّر إنشاء المسودة: " : "Draft failed: ") + e.message); }
    finally { setDraftLoading(false); setDraftFuId(null); }
  };

  async function handleRfqPhoneBlur(phone: string) {
    if (!phone.trim()) return;
    const found = await findContactByPhone(phone);
    if (found) { const compName = (found as any).companies?.name ?? ""; setRfqFoundContact({ id: found.id, name: found.name, companyName: compName }); setRfqForm(f => ({ ...f, contactName: found.name, companyName: compName })); } else { setRfqFoundContact(null); }
    setRfqDedupChecked(true);
  }

  async function handleRfqSubmit() {
    if (!rfqForm.companyName || !rfqForm.projectScope || !rfqForm.responseDueDate) { toast.error(lang === "ar" ? "يرجى تعبئة الحقول المطلوبة" : "Fill required fields"); return; }
    setRfqCreating(true);
    try {
      const result = await createRfqWithOpportunity({ companyName: rfqForm.companyName, contactName: rfqForm.contactName, contactPhone: rfqForm.contactPhone, existingContactId: rfqFoundContact?.id ?? null, projectScope: rfqForm.projectScope, responseDueDate: rfqForm.responseDueDate, estimatedValue: rfqForm.estimatedValue ? Number(rfqForm.estimatedValue) : null });
      toast.success(t("ws_rfq_created")); setRfqOpen(false); setRfqStep(1);
      setRfqForm({ companyName: "", contactName: "", contactPhone: "", projectScope: "", responseDueDate: "", estimatedValue: "" }); setRfqFoundContact(null); setRfqDedupChecked(false);
      qc.invalidateQueries({ queryKey: ["workspace", uid] }); qc.invalidateQueries({ queryKey: ["ws-rfqs", uid] });
      navigate({ to: "/opportunities/$id", params: { id: result.opportunityId } });
    } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
    finally { setRfqCreating(false); }
  }

  const inputCls = "w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none";

  const jihValue = (jihOpps as any[]).reduce((s, o) => s + (o.estimated_value_max ?? 0), 0);
  const tenderValue = (myTenders as any[]).reduce((s, t) => s + ((t as any).estimated_project_value ?? 0), 0);
  const salesTarget = tg ? Number(tg.sales_target) : 0;
  const remainingTarget = salesTarget > 0 ? Math.max(0, salesTarget - awardedValue) : null;
  const displayName = user?.email?.split("@")[0] ?? "—";

  return (
    <div className="mx-auto max-w-7xl space-y-6">

      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground">
            {lang === "ar" ? "الصفحة الرئيسية" : "Main Page"} · {new Date().toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <div className="text-[22px] font-bold text-foreground">
            {lang === "ar" ? `مرحباً، ${displayName}` : `Hi, ${displayName}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setRfqOpen(true); setRfqStep(1); }}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-amber/90 px-4 text-[12px] font-semibold text-black transition-colors hover:bg-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Plus className="h-3.5 w-3.5" /> {t("ws_new_rfq")}
          </button>
          <button
            onClick={() => setLogOpen(true)}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("ws_log_activity")}
          </button>
        </div>
      </section>

      {/* Target card — donut + KPIs */}
      <section className="rounded-xl border border-border/60 bg-surface/40 p-5">
        <div className="flex flex-wrap items-center gap-6">
          <TargetDonut
            salesTarget={salesTarget}
            awardedValue={awardedValue}
            jihValue={jihValue}
            lang={lang}
            achievementPct={achievementPct}
          />
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap gap-4">
              <TargetKpiBox
                label={lang === "ar" ? "المبلغ المستهدف" : "Target Amount"}
                value={salesTarget > 0 ? formatCurrency(salesTarget, lang, "SAR") : "—"}
                sub={tg?.period_type === "annual" ? (lang === "ar" ? "هدف سنوي" : "Annual target") : (lang === "ar" ? "هدف شهري" : "Monthly target")}
              />
              <TargetKpiBox
                label={lang === "ar" ? "ترسيات رسمية" : "Awarded Contracts"}
                value={formatCurrency(awardedValue, lang, "SAR")}
                sub={`${awardedOpps.length} ${lang === "ar" ? "مشروع" : "projects"}`}
                tone="positive"
              />
              {remainingTarget !== null && (
                <TargetKpiBox
                  label={lang === "ar" ? "المتبقي من الهدف" : "Remaining Target"}
                  value={formatCurrency(remainingTarget, lang, "SAR")}
                  tone={remainingTarget < salesTarget * 0.3 ? "positive" : "attention"}
                />
              )}
            </div>
            {salesTarget > 0 && (
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#4ade80]" />{lang === "ar" ? "ترسيات رسمية" : "Awarded"}</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber" />{lang === "ar" ? "JIH في الإنجاز" : "JIH Pipeline"}</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-structural/60" />{lang === "ar" ? "فجوة الهدف" : "Target Gap"}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Nav links + Summary of Leads */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-surface/40 p-4 space-y-2">
          <StageDashLink label={lang === "ar" ? "نظرة خط المبيعات" : "Pipeline Overview"} count={data.opps.length} to="/pipeline-overview" tone="neutral" />
          <StageDashLink label={lang === "ar" ? "قرارات بانتظار الموافقة" : "Pending Approvals"} count={myApprovals.length} to="/approvals" tone="attention" />
          <StageDashLink label={lang === "ar" ? "مناقصاتي النشطة" : "Active Tenders"} count={myTenders.length} to="/tenders" tone="neutral" />
          <StageDashLink label={lang === "ar" ? "بنود تتطلب إجراء" : "Action Required"} count={missingDataFlags.length} to="/opportunities" tone="neutral" />
        </div>
        <div className="rounded-xl border border-border/60 bg-surface/40 p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-4">
            {lang === "ar" ? "ملخص الفرص" : "Summary of Leads"}
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "إجمالي JIH" : "Total JIH"}</div>
                <div className="text-[11px] text-muted-foreground">{jihOpps.length} {lang === "ar" ? "فرصة" : "opportunities"}</div>
              </div>
              <span className="num text-[18px] font-bold text-amber-light">{formatCurrency(jihValue, lang, "SAR")}</span>
            </div>
            <div className="h-px bg-border/30" />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "إجمالي المناقصات" : "Total Tenders"}</div>
                <div className="text-[11px] text-muted-foreground">{myTenders.length} {lang === "ar" ? "مناقصة" : "tenders"}</div>
              </div>
              <span className="num text-[18px] font-bold text-foreground">{formatCurrency(tenderValue, lang, "SAR")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Urgent Follow-ups + Urgent Quotations */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Urgent Follow-ups */}
        <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
          <div className="border-b border-border/40 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold text-foreground">{lang === "ar" ? "متابعات عاجلة" : "Urgent Follow Ups"}</div>
              <div className="text-[11px] text-muted-foreground">
                {overdueFU.length} {lang === "ar" ? "متأخرة" : "overdue"} · {[...overdueFU, ...todayFU].length} {lang === "ar" ? "إجمالي" : "total"}
              </div>
            </div>
          </div>
          {[...overdueFU, ...todayFU].length === 0 ? (
            <div className="px-4 py-8"><EmptyState message={lang === "ar" ? "لا متابعات عاجلة" : "No urgent follow-ups"} compact /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "المشروع" : "Project Name"}</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "الحالة" : "Status"}</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "إجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...overdueFU, ...todayFU].slice(0, 8).map((f: any) => {
                    const days = daysUntil(f.due_date);
                    return (
                      <tr key={f.id} className="border-t border-border/20 hover:bg-surface-2/30">
                        <td className="px-4 py-2.5">
                          {f.opportunity_id ? (
                            <Link to="/opportunities/$id" params={{ id: f.opportunity_id }} className="block max-w-[160px] truncate font-medium text-foreground hover:underline">{oppName(f.opportunity_id)}</Link>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5"><StatusPill tone={urgencyTone(days)}>{urgencyLabel(days, lang)}</StatusPill></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => setCompleteFor({ id: f.id, oppId: f.opportunity_id })} title={lang === "ar" ? "تمت" : "Complete"} className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><CheckCheck className="h-3 w-3" /></button>
                            <button onClick={() => setRescheduleFor({ id: f.id, oppId: f.opportunity_id, currentDate: f.due_date ?? "" })} title={lang === "ar" ? "إعادة جدولة" : "Reschedule"} className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-border/70 text-muted-foreground hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><CalendarClock className="h-3 w-3" /></button>
                            {f.opportunity_id && <button onClick={() => handleDraftFollowUp(f.id, f.opportunity_id, f.channel)} disabled={draftLoading && draftFuId === f.id} title="AI Draft" className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-border/70 text-muted-foreground hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><Sparkles className="h-3 w-3" /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Urgent Quotations */}
        <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
          <div className="border-b border-border/40 px-4 py-3">
            <div className="text-[13px] font-semibold text-foreground">{lang === "ar" ? "عروض أسعار عاجلة" : "Urgent Quotations"}</div>
            <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "خلال 7 أيام القادمة" : "Due within 7 days"}</div>
          </div>
          {(urgentQuotations as any[]).length === 0 ? (
            <div className="px-4 py-8"><EmptyState message={lang === "ar" ? "لا عروض أسعار عاجلة" : "No urgent quotations this week"} compact /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "المشروع" : "Project"}</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "الموعد النهائي" : "Due"}</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "الحالة" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(urgentQuotations as any[]).map((q: any) => {
                    const days = daysUntil(q.valid_until);
                    return (
                      <tr key={q.id} className="border-t border-border/20 hover:bg-surface-2/30">
                        <td className="px-4 py-2.5 font-medium text-foreground">{q.related_opportunity_id ? oppName(q.related_opportunity_id) : "—"}</td>
                        <td className="px-4 py-2.5 num text-muted-foreground">{q.valid_until || "—"}</td>
                        <td className="px-4 py-2.5"><StatusPill tone={urgencyTone(days)}>{urgencyLabel(days, lang)}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 3 panels: Tier A Opps | Pending Approvals | Action Required */}
      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">

          {/* Panel A — Tier A Opportunities */}
          <div className="rounded-xl border border-won-border bg-won-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-won-border/60 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold text-won">{lang === "ar" ? "فرص الفئة A" : "Tier A Opportunities"}</div>
                <div className="text-[11px] text-muted-foreground">{formatCurrency(tierAOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")}</div>
              </div>
              <span className="rounded-full bg-won-surface/80 px-2 py-0.5 text-[11px] num text-won">{tierAOpps.length}</span>
            </div>
            {tierAOpps.length === 0 ? (
              <div className="px-4 py-6"><EmptyState message={lang === "ar" ? "لا فرص فئة A" : "No Tier A opportunities"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-won-border/40">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "المشروع" : "Project"}</th>
                      <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "القيمة" : "Value"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tierAOpps as any[]).slice(0, 6).map((o: any) => (
                      <tr key={o.id} className="border-t border-won-border/40 hover:bg-won-surface">
                        <td className="px-3 py-2.5">
                          <Link to="/opportunities/$id" params={{ id: o.id }} className="block max-w-[140px] truncate font-medium text-foreground hover:underline">{o.project_name}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-right num text-[11px] text-won">{formatCurrency(o.estimated_value_max, lang, o.currency || "SAR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel B — Pending Approvals */}
          <div className="rounded-xl border border-amber/20 bg-amber/5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-amber/15 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold text-amber-light">{lang === "ar" ? "قرارات بانتظار الموافقة" : "Pending Approvals"}</div>
                <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "تحتاج قرارك" : "Awaiting your decision"}</div>
              </div>
              <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] num text-amber-light">{myApprovals.length}</span>
            </div>
            {myApprovals.length === 0 ? (
              <div className="px-4 py-6"><EmptyState message={lang === "ar" ? "لا قرارات معلقة" : "No pending approvals"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-amber/10">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "المشروع" : "Project"}</th>
                      <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "النوع" : "Type"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(myApprovals as any[]).slice(0, 6).map((a: any) => (
                      <tr key={a.id} className="border-t border-amber/10 hover:bg-amber/5">
                        <td className="px-3 py-2.5">
                          {a.related_opportunity_id
                            ? <Link to="/opportunities/$id" params={{ id: a.related_opportunity_id }} className="block max-w-[140px] truncate font-medium text-foreground hover:underline">{oppName(a.related_opportunity_id)}</Link>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2.5"><StatusPill tone="attention">{humanize(a.approval_type)}</StatusPill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel C — Action Required */}
          <div className="rounded-xl border border-border/60 bg-surface/40 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold text-foreground">{lang === "ar" ? "بنود تتطلب إجراء" : "Action Required"}</div>
                <div className="text-[11px] text-muted-foreground">{lang === "ar" ? "بيانات ناقصة أو مخاطر" : "Missing data or risks"}</div>
              </div>
              <span className="rounded-full bg-surface-2/60 px-2 py-0.5 text-[11px] num text-foreground">{missingDataFlags.length}</span>
            </div>
            {missingDataFlags.length === 0 ? (
              <div className="px-4 py-6"><EmptyState message={lang === "ar" ? "لا بنود تتطلب إجراء" : "No action required"} compact /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "السبب" : "Reason"}</th>
                      <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground">{lang === "ar" ? "الأولوية" : "Priority"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(missingDataFlags as any[]).slice(0, 6).map((f: any) => (
                      <tr key={f.id} className="border-t border-border/20 hover:bg-surface-2/30">
                        <td className="px-3 py-2.5 max-w-[140px] truncate text-foreground">{f.reason ?? humanize(f.flag_kind)}</td>
                        <td className="px-3 py-2.5"><StatusPill tone={f.flag_kind === "risk" ? "danger" : "attention"}>{humanize(f.priority ?? f.flag_kind)}</StatusPill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* View All buttons */}
        <div className="flex items-center justify-center gap-3 pt-1">
          <Link to="/opportunities" search={{} as any} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-won-border bg-won-surface px-5 text-[12px] font-medium text-won transition-colors hover:bg-won-surface/80">
            {lang === "ar" ? "عرض كل الفرص" : "View All Opportunities"} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          <Link to="/tenders" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
            {lang === "ar" ? "عرض كل المناقصات" : "View All Tenders"} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      <ActionDialog open={logOpen} onOpenChange={setLogOpen} title={t("ws_log_activity")} submitLabel={t("crm_add")}
        fields={[
          { key: "type", type: "select", label: t("crm_filter_all_types"), required: true, defaultValue: "call", options: ACTIVITY_TYPES.map(a => ({ value: a, label: t(`activity_type_${a}` as never) })) },
          { key: "opportunityId", type: "select", label: t("crm_linked_opportunities"), options: [{ value: "", label: "—" }, ...(myOpps as any[]).map(o => ({ value: o.id, label: o.project_name }))] },
          { key: "summary", type: "text", label: t("activity_summary") },
          { key: "draftContent", type: "textarea", label: t("activity_draft_body") },
        ]}
        onSubmit={async v => {
          try { await logActivity({ type: v.type as ActivityType, opportunityId: v.opportunityId || null, summary: v.summary || undefined, draftContent: v.draftContent || undefined }); toast.success(t("crm_saved")); qc.invalidateQueries({ queryKey: ["workspace", uid] }); }
          catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog open={!!completeFor} onOpenChange={v => !v && setCompleteFor(null)} title={t("dialog_complete_title")} description={t("dialog_complete_desc")} submitLabel={t("action_complete")}
        fields={[{ key: "outcome", type: "textarea", label: t("field_outcome"), required: true }]}
        onSubmit={async v => {
          try { await completeFollowUp({ followUpId: completeFor!.id, opportunityId: completeFor!.oppId, outcome: v.outcome }); toast.success(t("toast_complete_ok" as never)); qc.invalidateQueries({ queryKey: ["workspace", uid] }); qc.invalidateQueries({ queryKey: ["all-followups"] }); }
          catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog open={!!rescheduleFor} onOpenChange={v => !v && setRescheduleFor(null)} title={lang === "ar" ? "إعادة جدولة المتابعة" : "Reschedule Follow-up"} submitLabel={lang === "ar" ? "إعادة الجدولة" : "Reschedule"}
        fields={[{ key: "dueDate", type: "date", label: lang === "ar" ? "التاريخ الجديد" : "New date", required: true, defaultValue: rescheduleFor?.currentDate ?? "" }, { key: "notes", type: "textarea", label: lang === "ar" ? "ملاحظات" : "Notes (optional)" }]}
        onSubmit={async v => {
          try { await rescheduleFollowUp({ followUpId: rescheduleFor!.id, opportunityId: rescheduleFor!.oppId, dueDate: v.dueDate, notes: v.notes || undefined }); toast.success(lang === "ar" ? "تمت إعادة الجدولة" : "Rescheduled"); qc.invalidateQueries({ queryKey: ["workspace", uid] }); qc.invalidateQueries({ queryKey: ["all-followups"] }); }
          catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <AlertDialog open={draftOpen} onOpenChange={setDraftOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{lang === "ar" ? "مسودة المتابعة" : "Follow-up Draft"}</AlertDialogTitle>
            <AlertDialogDescription>{lang === "ar" ? "مسودة مقترحة من الذكاء الاصطناعي — راجعها قبل الإرسال." : "AI-suggested draft — review before sending."}</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea value={draftContent} onChange={e => setDraftContent(e.target.value)} rows={10} className="mt-2 w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground focus:border-border-strong focus:outline-none" />
          <AlertDialogFooter>
            <AlertDialogCancel>{lang === "ar" ? "إغلاق" : "Close"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (draftContent) navigator.clipboard.writeText(draftContent).then(() => toast.success(lang === "ar" ? "تم النسخ" : "Copied")).catch(() => {}); setDraftOpen(false); }}>{lang === "ar" ? "نسخ" : "Copy"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RFQ Quick-Create Dialog — 2-column layout */}
      <Dialog open={rfqOpen} onOpenChange={v => { if (!rfqCreating) { setRfqOpen(v); if (!v) { setRfqStep(1); setRfqFoundContact(null); setRfqDedupChecked(false); } } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("ws_new_rfq")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-5 py-2">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("ws_rfq_step1")}</div>
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_contact_phone")}</Label>
                <input type="tel" value={rfqForm.contactPhone} onChange={e => { setRfqForm(f => ({ ...f, contactPhone: e.target.value })); setRfqDedupChecked(false); setRfqFoundContact(null); }} onBlur={e => handleRfqPhoneBlur(e.target.value)} placeholder="+966…" className={inputCls} />
                {rfqDedupChecked && rfqFoundContact && <p className="text-[11px] text-won">✓ {t("ws_dedup_found")} {rfqFoundContact.name} ({rfqFoundContact.companyName})</p>}
                {rfqDedupChecked && !rfqFoundContact && <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "جهة اتصال جديدة" : "New contact"}</p>}
              </div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_company")} *</Label><input type="text" value={rfqForm.companyName} onChange={e => setRfqForm(f => ({ ...f, companyName: e.target.value }))} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_project")} *</Label><textarea value={rfqForm.projectScope} onChange={e => setRfqForm(f => ({ ...f, projectScope: e.target.value }))} rows={2} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_value")}</Label><input type="number" value={rfqForm.estimatedValue} onChange={e => setRfqForm(f => ({ ...f, estimatedValue: e.target.value }))} className={inputCls} /></div>
            </div>
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("ws_rfq_step2")}</div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_contact")}</Label><input type="text" value={rfqForm.contactName} onChange={e => setRfqForm(f => ({ ...f, contactName: e.target.value }))} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_due")} *</Label><input type="date" value={rfqForm.responseDueDate} onChange={e => setRfqForm(f => ({ ...f, responseDueDate: e.target.value }))} className={inputCls} /></div>
              <div className="mt-auto rounded-md border border-dashed border-border/50 bg-surface-2/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                {lang === "ar" ? "سيتم إضافة جهة الاتصال تلقائيًا إلى قاعدة بيانات جهات الاتصال." : "Contact will be automatically added to the Contacts Database."}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setRfqOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
                <Button size="sm" onClick={handleRfqSubmit} disabled={rfqCreating || !rfqForm.companyName || !rfqForm.projectScope || !rfqForm.responseDueDate}>
                  {rfqCreating ? (lang === "ar" ? "جارٍ الإنشاء…" : "Creating…") : (lang === "ar" ? "إنشاء الطلب" : "Create RFQ")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────────────────

// ─── Target Donut chart ───────────────────────────────────────────────────────

function TargetDonut({
  salesTarget,
  awardedValue,
  jihValue,
  lang,
  achievementPct,
}: {
  salesTarget: number;
  awardedValue: number;
  jihValue: number;
  lang: "ar" | "en";
  achievementPct: number | null;
}) {
  const noTarget = salesTarget <= 0;

  // Clamp values so slices never exceed the total ring
  const awarded = noTarget ? 1 : Math.min(awardedValue, salesTarget);
  const jihSlice = noTarget ? 0 : Math.min(jihValue, Math.max(0, salesTarget - awarded));
  const gap = noTarget ? 0 : Math.max(0, salesTarget - awarded - jihSlice);

  const data = noTarget
    ? [{ v: 1, key: "empty" }]
    : [
        { v: awarded,   key: "awarded" },
        { v: jihSlice,  key: "jih" },
        { v: gap,       key: "gap" },
      ].filter(d => d.v > 0);

  // OKLCH-derived hex approximations kept close to the design tokens
  const COLORS: Record<string, string> = {
    awarded: "#4ade80", // --won ≈ oklch(0.72 0.12 155)
    jih:     "#f59e0b", // --amber
    gap:     "rgba(255,255,255,0.07)",
    empty:   "rgba(255,255,255,0.07)",
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US", {
      notation: "compact", maximumFractionDigits: 1,
    }).format(n);

  return (
    <div className="relative shrink-0" style={{ width: 156, height: 156 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="v"
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={70}
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            paddingAngle={data.length > 1 ? 2 : 0}
          >
            {data.map(d => (
              <Cell key={d.key} fill={COLORS[d.key] ?? COLORS.gap} />
            ))}
          </Pie>
          {!noTarget && (
            <RechartsTooltip
              content={({ payload }) => {
                const item = payload?.[0];
                if (!item) return null;
                const labels: Record<string, string> = {
                  awarded: lang === "ar" ? "ترسيات رسمية" : "Awarded",
                  jih: lang === "ar" ? "JIH في الإنجاز" : "JIH Pipeline",
                  gap: lang === "ar" ? "فجوة الهدف" : "Target Gap",
                };
                return (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] shadow-elevated">
                    <div className="font-medium text-foreground">{labels[(item.payload as any).key] ?? ""}</div>
                    <div className="num mt-0.5 text-muted-foreground">SAR {fmt(item.value as number)}</div>
                  </div>
                );
              }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      {/* Center label */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[24px] font-bold leading-none text-foreground">
          {achievementPct !== null ? `${achievementPct}%` : "—"}
        </span>
        <span className="mt-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          {lang === "ar" ? "تم الإنجاز" : "achieved"}
        </span>
      </div>
    </div>
  );
}

function RadialProgress({ pct, size = 128 }: { pct: number; size?: number }) {
  const r = (size - 20) / 2;
  const cx = size / 2; const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = circumference * (1 - clamped / 100);
  const color = clamped >= 80 ? "#34d399" : clamped >= 50 ? "#f59e0b" : "#f87171";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={10} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.4s ease" }} />
    </svg>
  );
}

function TargetKpiBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "attention" }) {
  const cls = tone === "positive" ? "border-won/20 bg-won/[0.05]" : tone === "attention" ? "border-amber/20 bg-amber/5" : "border-border/60 bg-surface-2/30";
  const valCls = tone === "positive" ? "text-won" : tone === "attention" ? "text-amber-light" : "text-foreground";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`num mt-2 text-xl font-bold ${valCls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function StageToggleRow({ id, label, count, value, lang, tone, isOpen, onToggle, children }: {
  id: string; label: string; count: number; value: number; lang: Lang; tone: "positive" | "attention" | "neutral"; isOpen: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const border = tone === "positive" ? "border-won/25 bg-won/[0.05] text-won" : tone === "attention" ? "border-amber/25 bg-amber/5 text-amber-light" : "border-border/60 bg-surface-2/20 text-foreground";
  return (
    <div className={`rounded-lg border overflow-hidden ${border}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[13px] font-semibold">{label}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] num">{count}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="num text-[13px] font-medium">{formatCurrency(value, lang, "SAR")}</span>
          {isOpen ? <ChevronDown className="h-4 w-4 opacity-60" /> : <ChevronRight className="h-4 w-4 opacity-60" />}
        </div>
      </button>
      {isOpen && <div className="border-t border-white/10 bg-background/50 px-5 py-4">{children}</div>}
    </div>
  );
}

function StageTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr>{headers.map(h => <th key={h} className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground last:pr-0">{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function TabItem({ value, icon, label, count }: { value: string; icon: React.ReactNode; label: string; count: number }) {
  return (
    <TabsTrigger value={value} className="h-8 gap-2 rounded-md px-3 text-[12px] font-medium data-[state=active]:bg-surface-2 data-[state=active]:text-foreground data-[state=active]:shadow-none">
      {icon}<span>{label}</span>
      <span className="num rounded-full bg-surface-2 px-1.5 py-0 text-[10px] text-muted-foreground" data-tabular="true">{count}</span>
    </TabsTrigger>
  );
}

function TargetMetric({ label, target, actual, lang, isCount = false }: { label: string; target: number | null | undefined; actual: number | undefined; lang: Lang; isCount?: boolean }) {
  const { t } = useI18n();
  const format = (n: number) => (isCount ? formatNumber(n, lang) : formatCurrency(n, lang, "SAR"));
  return (
    <div className="rounded-lg border border-border/60 bg-surface-2/30 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="num mt-1.5 text-[18px] font-semibold text-foreground" data-tabular="true">{target != null ? format(target) : "—"}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{actual != null ? `${format(actual)} ${t("ws_of")} ${lang === "ar" ? "الهدف" : "target"}` : t("ws_actual_not_tracked")}</div>
    </div>
  );
}

// ─── Pipeline diagram sub-components ─────────────────────────────────────────

function PipelineStageBox({
  stage,
  lang,
  isLast,
}: {
  stage: (typeof PIPELINE_STAGES)[number];
  lang: "ar" | "en";
  isLast: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <div
        className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2.5 text-center ${
          stage.isGoal
            ? "border-amber bg-amber/15 text-amber-light shadow-[0_0_14px_rgba(251,191,36,0.12)]"
            : "border-border/60 bg-surface-2/40 text-foreground"
        }`}
        style={{ width: STAGE_BOX_W, minHeight: 52 }}
      >
        {stage.isGoal && (
          <span className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-amber-light">
            ★ FINAL GOAL
          </span>
        )}
        <span className="text-[10px] font-semibold leading-tight">{stage.label[lang]}</span>
      </div>
      {!isLast && (
        <div
          className="flex shrink-0 items-center justify-center text-muted-foreground/40"
          style={{ width: ARROW_W }}
        >
          <ChevronRight className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function StageDashLink({
  label,
  count,
  to,
  tone,
}: {
  label: string;
  count: number;
  to: string;
  tone: "positive" | "attention" | "neutral";
}) {
  const borderCls =
    tone === "positive"
      ? "border-won-border hover:border-won-border/60 hover:bg-won-surface"
      : tone === "attention"
        ? "border-amber/20 hover:border-amber/40 hover:bg-amber/5"
        : "border-border/30 hover:border-border-strong hover:bg-surface-2/40";
  const countCls =
    tone === "positive"
      ? "bg-won-surface/80 text-won"
      : tone === "attention"
        ? "bg-amber/15 text-amber-light"
        : "bg-surface-2/60 text-foreground";
  return (
    <Link
      to={to as any}
      className={`flex items-center justify-between rounded-lg border px-4 py-3 text-[13px] font-medium text-foreground transition-colors ${borderCls}`}
    >
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] num ${countCls}`}>{count}</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </Link>
  );
}

type ListItem = { key: string; primary: string; secondary?: string; tone?: "attention" | "neutral" | "muted" | "danger" | "positive"; label?: string; right?: string; href?: { to: "/opportunities/$id"; params: { id: string } } };

function List({ items, empty }: { items: ListItem[]; empty: string }) {
  if (items.length === 0) return <div className="px-5 py-8"><EmptyState message={empty} /></div>;
  return (
    <ul>{items.map(it => {
      const inner = (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t border-border/60 px-5 py-3 first:border-t-0">
          <div className="min-w-0"><div className="truncate text-[13px] font-medium text-foreground">{it.primary}</div>{it.secondary ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{it.secondary}</div> : null}</div>
          <div className="flex shrink-0 items-center gap-2">{it.label ? <StatusPill tone={(it.tone as any) ?? "muted"}>{it.label}</StatusPill> : null}{it.right ? <span className="num text-[11px] text-muted-foreground" data-tabular="true">{it.right}</span> : null}</div>
        </div>
      );
      return <li key={it.key} className="transition-colors hover:bg-surface-2/40">{it.href ? <Link to={it.href.to} params={it.href.params} className="block">{inner}</Link> : inner}</li>;
    })}</ul>
  );
}
