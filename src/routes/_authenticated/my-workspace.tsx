import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
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
    <div className="mx-auto max-w-7xl space-y-5">

      {/* Page Header */}
      <PageHeader
        eyebrow={lang === "ar" ? "لوحة المبيعات" : "PHC Sales Dashboard"}
        title={lang === "ar" ? "مركز قيادة المبيعات والتطوير" : "Sales & Business Development Command Center"}
        description={`${lang === "ar" ? "مرحباً،" : "Welcome,"} ${displayName} · ${new Date().toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRfqOpen(true); setRfqStep(1); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber/90 px-4 text-[12px] font-semibold text-black transition-colors hover:bg-amber"
            >
              <Plus className="h-3.5 w-3.5" /> {t("ws_new_rfq")}
            </button>
            <button
              onClick={() => setLogOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t("ws_log_activity")}
            </button>
          </div>
        }
      />

      {/* §6.1 — Annual Target Card */}
      <section>
        <ChartFrame
          title={lang === "ar" ? "هدف العام" : "Annual Target"}
          subtitle={tgt ? (tgt.period_type === "annual" ? (lang === "ar" ? "هدف سنوي" : "Annual target") : (lang === "ar" ? "هدف شهري — لا يوجد هدف سنوي محدد" : "Monthly target — no annual target set")) : (lang === "ar" ? "لا يوجد هدف محدد" : "No target set")}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[140px_1fr_1fr_1fr_1fr]">
            {/* Radial */}
            <div className="flex flex-col items-center justify-center gap-1">
              <div className="relative">
                <RadialProgress pct={achievementPct ?? 0} size={128} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="num text-[22px] font-bold text-foreground">{achievementPct !== null ? `${achievementPct}%` : "—"}</span>
                  <span className="text-[10px] text-muted-foreground">{lang === "ar" ? "إنجاز" : "achieved"}</span>
                </div>
              </div>
            </div>
            {/* KPIs */}
            <TargetKpiBox label={lang === "ar" ? "الهدف السنوي" : "Annual Target"} value={salesTarget > 0 ? formatCurrency(salesTarget, lang, "SAR") : "—"} />
            <TargetKpiBox label={lang === "ar" ? "الترسيات الرسمية" : "Officially Awarded"} value={formatCurrency(awardedValue, lang, "SAR")} sub={`${awardedOpps.length} ${lang === "ar" ? "مشروع" : "projects"}`} tone="positive" />
            <TargetKpiBox label={lang === "ar" ? "المتبقي من الهدف" : "Remaining Target"} value={remainingTarget !== null ? formatCurrency(remainingTarget, lang, "SAR") : "—"} tone={remainingTarget !== null && remainingTarget < salesTarget * 0.3 ? "positive" : undefined} />
            <TargetKpiBox label={lang === "ar" ? "نسبة الإنجاز" : "Achievement %"} value={achievementPct !== null ? `${achievementPct}%` : "—"} tone={achievementPct !== null ? (achievementPct >= 80 ? "positive" : "attention") : undefined} />
          </div>
        </ChartFrame>
      </section>

      {/* §6.2 — Commercial Summary */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={lang === "ar" ? "الهدف" : "Target"} value={salesTarget > 0 ? formatCurrency(salesTarget, lang, "SAR") : "—"} hint={tgt?.period_type === "annual" ? (lang === "ar" ? "سنوي" : "Annual") : (lang === "ar" ? "شهري" : "Monthly")} />
        <KpiCard label={lang === "ar" ? "ترسيات رسمية" : "Awarded Contracts"} value={formatCurrency(awardedValue, lang, "SAR")} hint={`${awardedOpps.length} ${lang === "ar" ? "مشروع" : "projects"}`} trend={achievementPct !== null ? (achievementPct >= 80 ? "up" : achievementPct >= 50 ? "flat" : "down") : undefined} />
        <KpiCard label={t("ws_jih_summary")} value={formatCurrency(jihValue, lang, "SAR")} hint={`${jihPipeline.length} ${lang === "ar" ? "فرصة" : "opportunities"}`} />
        <KpiCard label={lang === "ar" ? "مناقصات نشطة" : "Active Tenders"} value={formatCurrency(tenderValue, lang, "SAR")} hint={`${activeTenders.length} ${lang === "ar" ? "مناقصة" : "tenders"}`} />
      </section>

      {/* §6.3 — Priority Stage Toggles */}
      <section className="space-y-2">
        {/* Awarded */}
        <StageToggleRow id="awarded" label={lang === "ar" ? "الترسيات الرسمية" : "Awarded Contracts"} count={awardedOpps.length} value={awardedValue} lang={lang} tone="positive" isOpen={expandedStages.has("awarded")} onToggle={() => toggleStage("awarded")}>
          {(awardedOpps as any[]).length === 0 ? <EmptyState message={lang === "ar" ? "لا ترسيات مسجلة هذا العام" : "No awarded contracts this year"} compact /> : (
            <StageTable headers={[lang === "ar" ? "المشروع" : "Project", lang === "ar" ? "العميل" : "Client", lang === "ar" ? "المقاول" : "Contractor", lang === "ar" ? "القيمة" : "Value", lang === "ar" ? "تاريخ الترسية" : "Award Date"]}>
              {(awardedOpps as any[]).map(o => (
                <tr key={o.id} className="border-t border-border/30 hover:bg-surface-2/30">
                  <td className="py-2 pr-4"><Link to="/opportunities/$id" params={{ id: o.id }} className="font-medium text-foreground hover:underline">{o.project_name}</Link></td>
                  <td className="py-2 pr-4 text-muted-foreground">{o.client || "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{o.main_contractor || "—"}</td>
                  <td className="py-2 pr-4 text-right num text-emerald-200">{formatCurrency(o.contract_value ?? o.estimated_value_max, lang, o.currency || "SAR")}</td>
                  <td className="py-2 text-muted-foreground num">{o.updated_at?.slice(0, 10) || "—"}</td>
                </tr>
              ))}
            </StageTable>
          )}
        </StageToggleRow>

        {/* Contract Received / Final Negotiation */}
        <StageToggleRow id="contract" label={lang === "ar" ? "استلام العقد / التفاوض النهائي" : "Contract Received / Final Negotiation"} count={contractOpps.length} value={contractOpps.reduce((s: number, o: any) => s + (o.contract_value ?? o.estimated_value_max ?? 0), 0)} lang={lang} tone="attention" isOpen={expandedStages.has("contract")} onToggle={() => toggleStage("contract")}>
          {contractOpps.length === 0 ? <EmptyState message={lang === "ar" ? "لا عقود بانتظار المراجعة" : "No contracts pending review"} compact /> : (
            <StageTable headers={[lang === "ar" ? "المشروع" : "Project", lang === "ar" ? "المقاول" : "Contractor", lang === "ar" ? "القيمة" : "Value", lang === "ar" ? "تاريخ الاستلام" : "Received", lang === "ar" ? "المرحلة" : "Stage", lang === "ar" ? "الإجراء التالي" : "Next Action"]}>
              {contractOpps.map((o: any) => (
                <tr key={o.id} className="border-t border-border/30 hover:bg-surface-2/30">
                  <td className="py-2 pr-4"><Link to="/opportunities/$id" params={{ id: o.id }} className="font-medium text-foreground hover:underline">{o.project_name}</Link></td>
                  <td className="py-2 pr-4 text-muted-foreground">{o.main_contractor || "—"}</td>
                  <td className="py-2 pr-4 text-right num">{formatCurrency(o.contract_value ?? o.estimated_value_max, lang, o.currency || "SAR")}</td>
                  <td className="py-2 pr-4 text-muted-foreground num">{o.contract_received_date || "—"}</td>
                  <td className="py-2 pr-4"><StatusPill tone="attention">{t(`sstage_${o.sales_stage}` as never)}</StatusPill></td>
                  <td className="py-2 max-w-[180px] truncate text-[11px] text-muted-foreground">{STAGE_ACTION[o.sales_stage]?.[lang] ?? "—"}</td>
                </tr>
              ))}
            </StageTable>
          )}
        </StageToggleRow>

        {/* Verbally Awarded */}
        <StageToggleRow id="verbal" label={lang === "ar" ? "ترسية شفهية" : "Verbally Awarded"} count={verballyAwardedOpps.length} value={verballyAwardedOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0)} lang={lang} tone="attention" isOpen={expandedStages.has("verbal")} onToggle={() => toggleStage("verbal")}>
          {verballyAwardedOpps.length === 0 ? <EmptyState message={lang === "ar" ? "لا ترسيات شفهية" : "No verbal awards"} compact /> : (
            <StageTable headers={[lang === "ar" ? "المشروع" : "Project", lang === "ar" ? "المقاول" : "Contractor", lang === "ar" ? "القيمة المؤكدة" : "Confirmed Value", lang === "ar" ? "تاريخ التأكيد" : "Verbal Date", lang === "ar" ? "أيام الانتظار" : "Days Waiting", lang === "ar" ? "المستند المتوقع" : "Expected Document"]}>
              {verballyAwardedOpps.map((o: any) => {
                const waitDays = daysSince(o.verbal_award_date);
                return (
                  <tr key={o.id} className="border-t border-border/30 hover:bg-surface-2/30">
                    <td className="py-2 pr-4"><Link to="/opportunities/$id" params={{ id: o.id }} className="font-medium text-foreground hover:underline">{o.project_name}</Link></td>
                    <td className="py-2 pr-4 text-muted-foreground">{o.main_contractor || "—"}</td>
                    <td className="py-2 pr-4 num">{formatCurrency(o.estimated_value_max, lang, o.currency || "SAR")}</td>
                    <td className="py-2 pr-4 text-muted-foreground num">{o.verbal_award_date || "—"}</td>
                    <td className="py-2 pr-4">
                      {waitDays !== null ? <StatusPill tone={waitDays > 30 ? "danger" : waitDays > 14 ? "attention" : "neutral"}>{waitDays}{lang === "ar" ? " يوم" : "d"}</StatusPill> : "—"}
                    </td>
                    <td className="py-2 text-[11px] text-muted-foreground">{o.expected_contract_date || (lang === "ar" ? "غير محدد" : "Not set")}</td>
                  </tr>
                );
              })}
            </StageTable>
          )}
        </StageToggleRow>
      </section>

      {/* §6.4 — Pipeline Summary */}
      <section>
        <ChartFrame title={lang === "ar" ? "ملخص الفرص النشطة" : "Active Pipeline Summary"}>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-amber-300/80">{lang === "ar" ? "فرص قائمة (JIH)" : "JIH Opportunities"}</div>
              <div className="num mt-2 text-2xl font-bold text-foreground">{formatCurrency(jihValue, lang, "SAR")}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{jihPipeline.length} {lang === "ar" ? "فرصة" : "opps"} · {jihSharePct}% {lang === "ar" ? "من الإجمالي" : "of total"}</div>
              <Link to="/opportunities" search={{} as any} className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-light hover:underline">{lang === "ar" ? "عرض كل الفرص" : "View all JIH"} →</Link>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "مناقصات نشطة" : "Active Tenders"}</div>
              <div className="num mt-2 text-2xl font-bold text-foreground">{formatCurrency(tenderValue, lang, "SAR")}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{activeTenders.length} {lang === "ar" ? "مناقصة" : "tenders"} · {100 - jihSharePct}% {lang === "ar" ? "من الإجمالي" : "of total"}</div>
              <Link to="/tenders" className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-light hover:underline">{lang === "ar" ? "عرض كل المناقصات" : "View all tenders"} →</Link>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "إجمالي الفرص النشطة" : "Total Active Pipeline"}</div>
              <div className="num mt-2 text-2xl font-bold text-foreground">{formatCurrency(totalPipeline, lang, "SAR")}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{jihPipeline.length + activeTenders.length} {lang === "ar" ? "إجمالي" : "total"}</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/20">
                <div className="h-full rounded-full bg-amber/60 transition-all" style={{ width: `${jihSharePct}%` }} />
              </div>
              <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber/60 inline-block" />JIH {jihSharePct}%</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-border inline-block" />{lang === "ar" ? "مناقصات" : "Tender"} {100 - jihSharePct}%</span>
              </div>
            </div>
          </div>
        </ChartFrame>
      </section>

      {/* §6.5 — Urgent Follow-ups */}
      <section>
        <ChartFrame
          title={lang === "ar" ? "متابعات عاجلة" : "Urgent Follow-ups"}
          subtitle={`${(urgentFUs as any[]).filter(f => daysUntil(f.due_date) !== null && daysUntil(f.due_date)! <= 0).length} ${lang === "ar" ? "متأخرة" : "overdue"} · ${(urgentFUs as any[]).length} ${lang === "ar" ? "إجمالي" : "total"}`}
          padded={false}
        >
          {(urgentFUs as any[]).length === 0 ? (
            <div className="px-5 py-8"><EmptyState message={lang === "ar" ? "لا متابعات عاجلة" : "No urgent follow-ups"} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/40 text-left">
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "المشروع" : "Project"}</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "المرحلة" : "Stage"}</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "القيمة" : "Value"}</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "آخر تحديث" : "Last Update"}</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "موعد المتابعة" : "Due"}</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground hidden lg:table-cell">{lang === "ar" ? "الإجراء المطلوب" : "Required Action"}</th>
                    <th className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{lang === "ar" ? "إجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(urgentFUs as any[]).slice(0, 15).map(f => {
                    const opp = f.opportunities as any;
                    const days = daysUntil(f.due_date);
                    const since = daysSince(opp?.last_activity_at);
                    return (
                      <tr key={f.id} className="border-t border-border/30 hover:bg-surface-2/30">
                        <td className="px-4 py-2.5">
                          {f.opportunity_id ? (
                            <Link to="/opportunities/$id" params={{ id: f.opportunity_id }} className="font-medium text-foreground hover:underline">{opp?.project_name ?? "—"}</Link>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {opp?.sales_stage ? <StatusPill tone="neutral">{t(`sstage_${opp.sales_stage}` as never)}</StatusPill> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right num text-muted-foreground">{opp?.estimated_value_max ? formatCurrency(opp.estimated_value_max, lang, opp.currency || "SAR") : "—"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{since !== null ? `${since}d ${lang === "ar" ? "مضت" : "ago"}` : "—"}</td>
                        <td className="px-4 py-2.5"><StatusPill tone={urgencyTone(days)}>{urgencyLabel(days, lang)}</StatusPill></td>
                        <td className="px-4 py-2.5 hidden lg:table-cell max-w-[180px] truncate text-[11px] text-muted-foreground">{STAGE_ACTION[opp?.sales_stage]?.[lang] ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => setCompleteFor({ id: f.id, oppId: f.opportunity_id })} title={lang === "ar" ? "تمت" : "Complete"} className="grid h-6 w-6 place-items-center rounded border border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20"><CheckCheck className="h-3 w-3" /></button>
                            <button onClick={() => setRescheduleFor({ id: f.id, oppId: f.opportunity_id, currentDate: f.due_date ?? "" })} title={lang === "ar" ? "إعادة جدولة" : "Reschedule"} className="grid h-6 w-6 place-items-center rounded border border-border/70 text-muted-foreground hover:border-border-strong hover:text-foreground"><CalendarClock className="h-3 w-3" /></button>
                            {f.opportunity_id && <button onClick={() => handleDraftFollowUp(f.id, f.opportunity_id, f.channel)} disabled={draftLoading && draftFuId === f.id} title="AI Draft" className="grid h-6 w-6 place-items-center rounded border border-border/70 text-muted-foreground hover:text-foreground disabled:opacity-40"><Sparkles className="h-3 w-3" /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ChartFrame>
      </section>

      {/* §6.6 — Urgent Quotation Submissions */}
      <section>
        <ChartFrame
          title={lang === "ar" ? "تقديمات عروض أسعار عاجلة" : "Urgent Quotation Submissions"}
          subtitle={lang === "ar" ? "استناداً إلى الموعد النهائي لتقديم طلب العرض" : "Based on RFQ response due date"}
          padded={false}
        >
          {(urgentRfqs as any[]).length === 0 ? (
            <div className="px-5 py-8"><EmptyState message={lang === "ar" ? "لا تقديمات عاجلة هذا الأسبوع" : "No urgent submissions this week"} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/40 text-left">
                    {[lang === "ar" ? "رقم الطلب" : "RFQ #", lang === "ar" ? "الموعد النهائي" : "Deadline", lang === "ar" ? "الوقت المتبقي" : "Time Left", lang === "ar" ? "القيمة التقديرية" : "Est. Value", lang === "ar" ? "الحالة" : "Status"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(urgentRfqs as any[]).map(r => {
                    const days = daysUntil(r.response_due_date);
                    return (
                      <tr key={r.id} className="border-t border-border/30 hover:bg-surface-2/30">
                        <td className="px-4 py-2.5 font-medium text-foreground">{r.rfq_number || r.id.slice(0, 8)}</td>
                        <td className="px-4 py-2.5 num text-muted-foreground">{r.response_due_date || "—"}</td>
                        <td className="px-4 py-2.5"><StatusPill tone={urgencyTone(days)}>{urgencyLabel(days, lang)}</StatusPill></td>
                        <td className="px-4 py-2.5 num text-right text-muted-foreground">{r.estimated_value ? formatCurrency(r.estimated_value, lang, "SAR") : "—"}</td>
                        <td className="px-4 py-2.5"><StatusPill tone="neutral">{humanize(r.status)}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ChartFrame>
      </section>

      {/* §6.7 — Tenders Requiring Conversion Review (90-day) */}
      {(oldTenders as any[]).length > 0 && (
        <section>
          <ChartFrame
            title={lang === "ar" ? "مناقصات تستوجب المراجعة" : "Tenders Requiring Conversion Review"}
            subtitle={`${oldTenders.length} ${lang === "ar" ? "مناقصة تجاوزت 90 يومًا دون مراجعة" : "tenders older than 90 days without review"}`}
            padded={false}
          >
            <div className="mx-4 mb-4 mt-3 flex items-start gap-2 rounded-md border border-amber/30 bg-amber/5 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-light" />
              <p className="text-[12px] text-amber-light/80">{lang === "ar" ? "هذه المناقصات تجاوزت 90 يومًا. يرجى تأكيد نتيجة المناقصة واتخاذ أحد الإجراءات: تحويل إلى JIH، وضع علامة خاملة، أو إغلاق." : "These tenders have passed the 90-day threshold. Confirm the main contract result and take action: convert to JIH, mark dormant, or close."}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/40 text-left">
                    {[lang === "ar" ? "المناقصة" : "Tender", lang === "ar" ? "المرحلة" : "Stage", lang === "ar" ? "العمر" : "Age", lang === "ar" ? "القيمة" : "Value", lang === "ar" ? "الترسية المتوقعة" : "Expected Award", lang === "ar" ? "مراجعة" : "Review"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(oldTenders as any[]).map(tn => {
                    const age = daysSince(tn.created_at) ?? 0;
                    return (
                      <tr key={tn.id} className="border-t border-border/30 hover:bg-surface-2/30">
                        <td className="px-4 py-2.5 font-medium text-foreground">{tn.tender_name}</td>
                        <td className="px-4 py-2.5"><StatusPill tone="attention">{t(`tstage_${tn.tender_stage}` as never)}</StatusPill></td>
                        <td className="px-4 py-2.5"><StatusPill tone={age > 180 ? "danger" : "attention"}>{age}{lang === "ar" ? " يوم" : "d"}</StatusPill></td>
                        <td className="px-4 py-2.5 num text-right text-muted-foreground">{tn.estimated_project_value ? formatCurrency(tn.estimated_project_value, lang, "SAR") : "—"}</td>
                        <td className="px-4 py-2.5 num text-muted-foreground">{tn.expected_award_date || "—"}</td>
                        <td className="px-4 py-2.5">
                          <Link to="/tenders" className="text-[11px] text-amber-light hover:underline">{lang === "ar" ? "مراجعة" : "Review"} →</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartFrame>
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

      {/* RFQ Quick-Create Dialog */}
      <Dialog open={rfqOpen} onOpenChange={v => { if (!rfqCreating) { setRfqOpen(v); if (!v) { setRfqStep(1); setRfqFoundContact(null); setRfqDedupChecked(false); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("ws_new_rfq")} — {rfqStep === 1 ? t("ws_rfq_step1") : t("ws_rfq_step2")}</DialogTitle></DialogHeader>
          {rfqStep === 1 && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_contact_phone")}</Label>
                <input type="tel" value={rfqForm.contactPhone} onChange={e => { setRfqForm(f => ({ ...f, contactPhone: e.target.value })); setRfqDedupChecked(false); setRfqFoundContact(null); }} onBlur={e => handleRfqPhoneBlur(e.target.value)} placeholder="+966..." className={inputCls} />
                {rfqDedupChecked && rfqFoundContact && <p className="text-[11px] text-emerald-400">✓ {t("ws_dedup_found")} {rfqFoundContact.name} ({rfqFoundContact.companyName})</p>}
                {rfqDedupChecked && !rfqFoundContact && <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "جهة اتصال جديدة" : "New contact"}</p>}
              </div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_contact")}</Label><input type="text" value={rfqForm.contactName} onChange={e => setRfqForm(f => ({ ...f, contactName: e.target.value }))} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_company")} *</Label><input type="text" value={rfqForm.companyName} onChange={e => setRfqForm(f => ({ ...f, companyName: e.target.value }))} className={inputCls} /></div>
              <div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" onClick={() => setRfqOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button><Button size="sm" onClick={() => setRfqStep(2)} disabled={!rfqForm.companyName}>{lang === "ar" ? "التالي" : "Next"} →</Button></div>
            </div>
          )}
          {rfqStep === 2 && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_project")} *</Label><textarea value={rfqForm.projectScope} onChange={e => setRfqForm(f => ({ ...f, projectScope: e.target.value }))} rows={2} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_due")} *</Label><input type="date" value={rfqForm.responseDueDate} onChange={e => setRfqForm(f => ({ ...f, responseDueDate: e.target.value }))} className={inputCls} /></div>
              <div className="space-y-1"><Label className="text-xs">{t("ws_rfq_value")}</Label><input type="number" value={rfqForm.estimatedValue} onChange={e => setRfqForm(f => ({ ...f, estimatedValue: e.target.value }))} className={inputCls} /></div>
              <div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" onClick={() => setRfqStep(1)}>← {lang === "ar" ? "السابق" : "Back"}</Button><Button size="sm" onClick={handleRfqSubmit} disabled={rfqCreating || !rfqForm.projectScope || !rfqForm.responseDueDate}>{rfqCreating ? (lang === "ar" ? "جارٍ الإنشاء…" : "Creating…") : (lang === "ar" ? "إنشاء الطلب" : "Create RFQ")}</Button></div>
            </div>
          )}
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

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow={lang === "ar" ? "مساحة العمل" : "Workspace"} title={t("nav_my_day")} description={user?.email ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => { setRfqOpen(true); setRfqStep(1); }} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"><Plus className="h-3.5 w-3.5" /> {t("ws_new_rfq")}</button>
            <button onClick={() => setLogOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3.5 text-[12px] font-medium text-amber-light transition-colors hover:bg-amber/20"><Sparkles className="h-3.5 w-3.5" /> {t("ws_log_activity")}</button>
          </div>
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("ws_awarded_value")} value={formatCurrency(awardedValue, lang, "SAR")} hint={tg?.sales_target ? `${lang === "ar" ? "من هدف" : "of target"} ${formatCurrency(tg.sales_target, lang, "SAR")}` : (lang === "ar" ? "لا هدف محدد" : "No target set")} trend={achievementPct !== null ? (achievementPct >= 80 ? "up" : achievementPct >= 50 ? "flat" : "down") : undefined} />
        <KpiCard label={t("ws_achievement_pct")} value={achievementPct !== null ? `${achievementPct}%` : "—"} hint={lang === "ar" ? "إنجاز المبيعات" : "Sales achievement"} trend={achievementPct !== null ? (achievementPct >= 80 ? "up" : achievementPct >= 50 ? "flat" : "down") : undefined} />
        <KpiCard label={lang === "ar" ? "متأخرات اليوم" : "Overdue today"} value={formatNumber(overdueFU.length + overdueTasks.length, lang)} hint={lang === "ar" ? "متابعات ومهام" : "Follow-ups & tasks"} trend={overdueFU.length + overdueTasks.length > 0 ? "down" : "flat"} />
        <KpiCard label={lang === "ar" ? "بانتظار قرارك" : "Awaiting your decision"} value={formatNumber(myApprovals.length, lang)} hint={t("metric_awaiting_approval" as never)} />
      </section>
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label={t("ws_today_followups")} value={formatNumber(todayFU.length, lang)} hint={lang === "ar" ? "مستحقة اليوم" : "Due today"} />
        <KpiCard label={t("ws_overdue_followups")} value={formatNumber(overdueFU.length, lang)} hint={lang === "ar" ? "تحتاج متابعة فورية" : "Needs immediate follow-up"} trend={overdueFU.length > 0 ? "down" : "flat"} />
        <KpiCard label={t("ws_tier_a_opportunities")} value={formatNumber(tierAOpps.length, lang)} hint={formatCurrency(tierAOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} />
        <KpiCard label={t("ws_my_rfqs")} value={formatNumber(myRfqs.length, lang)} hint={t("ws_rfqs_open")} />
        <KpiCard label={t("ws_my_tenders")} value={formatNumber(myTenders.length, lang)} hint={t("ws_tenders_active")} />
        <KpiCard label={t("ws_missing_data")} value={formatNumber(missingDataFlags.length, lang)} hint={lang === "ar" ? "بانتظار استكمال البيانات" : "Awaiting data completion"} trend={missingDataFlags.length > 0 ? "down" : "flat"} />
        <KpiCard label={t("ws_jih_summary")} value={formatNumber(jihOpps.length, lang)} hint={formatCurrency((jihOpps as any[]).reduce((s, o) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} />
        <KpiCard label={t("ws_urgent_quotations")} value={formatNumber(urgentQuotations.length, lang)} hint={lang === "ar" ? "تستحق هذا الأسبوع" : "Due this week"} trend={urgentQuotations.length > 0 ? "down" : "flat"} />
      </section>
      <section className="mt-3">
        <ChartFrame title={t("ws_target_snapshot")} subtitle={tg ? undefined : t("ws_no_target")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <TargetMetric label={t("ws_target_sales")} target={tg?.sales_target} actual={undefined} lang={lang} />
            <TargetMetric label={t("ws_target_pipeline")} target={tg?.pipeline_target} actual={pipelineValue} lang={lang} />
            <TargetMetric label={t("ws_target_quotations")} target={tg?.quotation_target} actual={undefined} lang={lang} isCount />
            <TargetMetric label={t("ws_target_activities")} target={tg?.activity_target} actual={data.activities.length} lang={lang} isCount />
            <TargetMetric label={t("ws_target_reactivation")} target={tg?.reactivation_target} actual={undefined} lang={lang} isCount />
          </div>
        </ChartFrame>
      </section>
      {recs.length > 0 && (
        <section className="mt-6">
          <ChartFrame title={t("rec_title")} subtitle={t("rec_disclaimer")}>
            <div className="grid gap-3 md:grid-cols-2">
              {(recs as any[]).map(r => (
                <RecommendationCard key={r.id} rec={r}
                  onAccept={async () => { try { await acceptRecommendation(r); toast.success(t("rec_accept")); qc.invalidateQueries({ queryKey: ["ws-recs", uid] }); qc.invalidateQueries({ queryKey: ["approvals"] }); } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); } }}
                  onDismiss={async () => { try { await dismissRecommendation(r.id); qc.invalidateQueries({ queryKey: ["ws-recs", uid] }); } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); } }}
                />
              ))}
            </div>
          </ChartFrame>
        </section>
      )}
      <section className="mt-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto rounded-lg border border-border/70 bg-surface/60 p-1">
            <TabItem value="today" icon={<CalendarClock className="h-3.5 w-3.5" />} label={lang === "ar" ? "اليوم" : "Today"} count={overdueFU.length + todayFU.length + overdueTasks.length + todayTasks.length} />
            <TabItem value="tasks" icon={<ListChecks className="h-3.5 w-3.5" />} label={lang === "ar" ? "مهامي" : "My Tasks"} count={data.tasks.length} />
            <TabItem value="followups" icon={<CalendarClock className="h-3.5 w-3.5" />} label={t("nav_follow_ups")} count={data.followups.length} />
            <TabItem value="action" icon={<BellRing className="h-3.5 w-3.5" />} label={t("nav_action_center")} count={flags.length} />
            <TabItem value="approvals" icon={<ShieldCheck className="h-3.5 w-3.5" />} label={t("nav_approvals")} count={myApprovals.length} />
            <TabItem value="rfqs" icon={<FileText className="h-3.5 w-3.5" />} label={t("ws_my_rfqs")} count={myRfqs.length} />
            <TabItem value="tenders" icon={<Award className="h-3.5 w-3.5" />} label={t("ws_my_tenders")} count={myTenders.length} />
            <TabItem value="jih" icon={<Award className="h-3.5 w-3.5" />} label={t("ws_jih_summary")} count={jihOpps.length} />
            <TabItem value="quotations" icon={<FileText className="h-3.5 w-3.5" />} label={t("ws_urgent_quotations")} count={urgentQuotations.length} />
          </TabsList>
          <TabsContent value="today" className="mt-0 grid gap-3 lg:grid-cols-2">
            <ChartFrame title={lang === "ar" ? "متابعات اليوم" : "Follow-ups today"} subtitle={`${formatNumber(overdueFU.length, lang)} ${lang === "ar" ? "متأخرة" : "overdue"} · ${formatNumber(todayFU.length, lang)} ${lang === "ar" ? "اليوم" : "today"}`} padded={false}>
              {[...overdueFU, ...todayFU].length === 0 ? <div className="px-5 py-8"><EmptyState message={t("ws_none")} /></div> : (
                <ul>{[...overdueFU, ...todayFU].slice(0, 8).map((f: any) => {
                  const isOverdue = f.status === "overdue" || (f.due_date && f.due_date < today);
                  return (
                    <li key={f.id} className="border-t border-border/60 first:border-t-0">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-5 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5"><StatusPill tone={isOverdue ? "attention" : "neutral"}>{isOverdue ? (lang === "ar" ? "متأخر" : "Overdue") : (lang === "ar" ? "اليوم" : "Today")}</StatusPill><span className="text-[11px] text-muted-foreground">{humanize(f.channel)}</span></div>
                          {f.opportunity_id ? <Link to="/opportunities/$id" params={{ id: f.opportunity_id }} className="mt-1 block truncate text-[13px] font-medium text-foreground hover:underline">{oppName(f.opportunity_id)}</Link> : <div className="mt-1 truncate text-[13px] font-medium text-foreground">{oppName(f.opportunity_id)}</div>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="num text-[11px] text-muted-foreground tabular-nums">{f.due_date ?? "—"}</span>
                          <button onClick={() => setRescheduleFor({ id: f.id, oppId: f.opportunity_id, currentDate: f.due_date ?? "" })} className="grid h-6 w-6 place-items-center rounded border border-border/70 text-muted-foreground hover:border-border-strong hover:text-foreground"><CalendarClock className="h-3 w-3" /></button>
                          <button onClick={() => setCompleteFor({ id: f.id, oppId: f.opportunity_id })} className="grid h-6 w-6 place-items-center rounded border border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20"><CheckCheck className="h-3 w-3" /></button>
                        </div>
                      </div>
                    </li>
                  );
                })}</ul>
              )}
            </ChartFrame>
            <ChartFrame title={lang === "ar" ? "مهام اليوم" : "Tasks today"} subtitle={`${formatNumber(overdueTasks.length, lang)} ${lang === "ar" ? "متأخرة" : "overdue"} · ${formatNumber(todayTasks.length, lang)} ${lang === "ar" ? "اليوم" : "today"}`} padded={false}>
              <List empty={t("ws_none")} items={[...overdueTasks, ...todayTasks].slice(0, 8).map((tk: any) => ({ key: tk.id, primary: tk.title, secondary: humanize(tk.status), tone: tk.due_date && tk.due_date < today ? "attention" : "neutral" as any, label: tk.due_date && tk.due_date < today ? (lang === "ar" ? "متأخر" : "Overdue") : (lang === "ar" ? "اليوم" : "Today"), right: tk.due_date ?? "—" }))} />
            </ChartFrame>
            <ChartFrame title={t("ws_open_opportunities")} subtitle={`${formatNumber(data.opps.length, lang)} ${lang === "ar" ? "فرصة" : "open"}`} padded={false}>
              <List empty={t("ws_none")} items={data.opps.slice(0, 8).map((o: any) => ({ key: o.id, primary: o.project_name, secondary: humanize(o.pipeline_step ?? o.stage), tone: "muted" as any, label: humanize(o.pipeline_step ?? o.stage), right: formatCurrency(o.estimated_value_max, lang, o.currency), href: { to: "/opportunities/$id" as const, params: { id: o.id } } }))} />
            </ChartFrame>
            <ChartFrame title={t("ws_recent_activity")} subtitle={String(data.activities.length)} padded={false}>
              <List empty={t("ws_none")} items={data.activities.slice(0, 8).map((a: any) => ({ key: a.id, primary: a.summary ?? "—", secondary: t(`activity_type_${a.activity_type}` as never), tone: "muted" as any, label: t(`activity_type_${a.activity_type}` as never), right: new Date(a.occurred_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" }) }))} />
            </ChartFrame>
            {recent.length > 0 && (
              <ChartFrame title={lang === "ar" ? "سجلات زرتها مؤخرًا" : "Recently Visited"} subtitle={String(recent.length)} padded={false}>
                <ul>{recent.map(r => { const Icon = RECORD_TYPE_ICONS[r.type as keyof typeof RECORD_TYPE_ICONS] ?? Clock; return (<li key={r.to} className="transition-colors hover:bg-surface-2/40"><Link to={r.to as any} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60 px-5 py-3 first:border-t-0"><Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate text-[13px] font-medium text-foreground">{r.label}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{r.type}</div></div><span className="text-[11px] text-muted-foreground">{new Date(r.visitedAt).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" })}</span></Link></li>); })}</ul>
              </ChartFrame>
            )}
          </TabsContent>
          <TabsContent value="tasks" className="mt-0">
            <ChartFrame title={lang === "ar" ? "كل المهام" : "All my tasks"} subtitle={formatNumber(data.tasks.length, lang)} padded={false}>
              <List empty={t("ws_none")} items={[...overdueTasks, ...todayTasks, ...upcomingTasks].map((tk: any) => ({ key: tk.id, primary: tk.title, secondary: humanize(tk.status), tone: tk.due_date && tk.due_date < today ? "attention" : "neutral" as any, label: tk.due_date && tk.due_date < today ? (lang === "ar" ? "متأخر" : "Overdue") : humanize(tk.status), right: tk.due_date ?? "—" }))} />
            </ChartFrame>
          </TabsContent>
          <TabsContent value="followups" className="mt-0">
            <ChartFrame title={t("nav_follow_ups")} subtitle={formatNumber(data.followups.length, lang)} padded={false}>
              {[...overdueFU, ...todayFU, ...upcomingFU].length === 0 ? <EmptyState message={t("empty_follow_ups")} /> : (
                <ol className="divide-y divide-border/40">
                  {[...overdueFU, ...todayFU, ...upcomingFU].map((f: any) => {
                    const isOverdue = f.status === "overdue" || (f.due_date && f.due_date < today);
                    return (
                      <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><StatusPill tone={isOverdue ? "attention" : "neutral"}>{isOverdue ? (lang === "ar" ? "متأخر" : "Overdue") : humanize(f.status)}</StatusPill><span className="truncate text-sm font-medium text-foreground">{oppName(f.opportunity_id)}</span></div><div className="mt-0.5 text-xs text-muted-foreground">{humanize(f.channel)} · {t("label_tier")} {f.cadence_tier ?? "—"}{f.notes ? ` · ${f.notes}` : ""}</div></div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground num">{f.due_date ?? "—"}</span>
                          {f.opportunity_id && <button type="button" onClick={() => handleDraftFollowUp(f.id, f.opportunity_id, f.channel)} disabled={draftLoading && draftFuId === f.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground disabled:opacity-50"><Sparkles className="h-3 w-3" />{lang === "ar" ? "مسودة" : "Draft"}</button>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </ChartFrame>
          </TabsContent>
          <TabsContent value="action" className="mt-0">
            <ChartFrame title={t("nav_action_center")} subtitle={`${formatNumber(flags.length, lang)} ${lang === "ar" ? "بند" : "flagged"}`} padded={false}>
              <List empty={t("wf_no_records")} items={(flags as any[]).map(f => ({ key: f.id, primary: f.reason ?? humanize(f.action_type ?? f.flag_kind), secondary: `${humanize(f.linked_record_type)} · ${f.priority ?? ""}`, tone: f.flag_kind === "risk" ? "danger" : "attention" as any, label: humanize(f.action_type ?? f.risk_flag ?? f.flag_kind), right: f.due_date ?? "—" }))} />
            </ChartFrame>
          </TabsContent>
          <TabsContent value="approvals" className="mt-0">
            <ChartFrame title={t("nav_approvals")} subtitle={`${formatNumber(myApprovals.length, lang)} ${lang === "ar" ? "قرار" : "pending"}`} padded={false}>
              <List empty={t("empty_approvals")} items={myApprovals.map((a: any) => ({ key: a.id, primary: oppName(a.related_opportunity_id), secondary: humanize(a.approval_type), tone: "attention" as any, label: humanize(a.status), right: new Date(a.created_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" }), href: a.related_opportunity_id ? { to: "/opportunities/$id" as const, params: { id: a.related_opportunity_id } } : undefined }))} />
            </ChartFrame>
          </TabsContent>
          <TabsContent value="rfqs" className="mt-0">
            <ChartFrame title={t("ws_my_rfqs")} subtitle={`${formatNumber(myRfqs.length, lang)} ${t("ws_rfqs_open")}`} padded={false}>
              <List empty={t("ws_none")} items={(myRfqs as any[]).map(r => ({ key: r.id, primary: r.rfq_number || "—", secondary: humanize(r.status), tone: r.response_due_date && r.response_due_date < today ? "attention" : "neutral" as any, label: r.response_due_date && r.response_due_date < today ? (lang === "ar" ? "متأخر" : "Overdue") : humanize(r.status), right: formatCurrency(r.estimated_value, lang, "SAR") }))} />
            </ChartFrame>
          </TabsContent>
          <TabsContent value="tenders" className="mt-0">
            <ChartFrame title={t("ws_my_tenders")} subtitle={`${formatNumber(myTenders.length, lang)} ${t("ws_tenders_active")}`} padded={false}>
              <List empty={t("ws_none")} items={(myTenders as any[]).map(tn => ({ key: tn.id, primary: tn.tender_name, secondary: `${t(`tstage_${tn.tender_stage}` as never)}${tn.tender_priority_classification ? ` · ${t("label_tier")} ${tn.tender_priority_classification}` : ""}`, tone: "muted" as any, label: tn.tender_priority_classification ?? humanize(tn.tender_stage), right: formatCurrency(tn.estimated_project_value, lang, "SAR") }))} />
            </ChartFrame>
          </TabsContent>
          <TabsContent value="jih" className="mt-0">
            <ChartFrame title={t("ws_jih_summary")} subtitle={formatCurrency((jihOpps as any[]).reduce((s, o) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} padded={false}>
              <List empty={t("ws_none")} items={(jihOpps as any[]).map(o => ({ key: o.id, primary: o.project_name, secondary: t(`sstage_${o.sales_stage}` as never), tone: o.win_confidence === "sure_win" ? "positive" : o.win_confidence === "strong" ? "attention" : "neutral" as any, label: t(`sstage_${o.sales_stage}` as never), right: formatCurrency(o.estimated_value_max, lang, o.currency), href: { to: "/opportunities/$id" as const, params: { id: o.id } } }))} />
            </ChartFrame>
          </TabsContent>
          <TabsContent value="quotations" className="mt-0">
            <ChartFrame title={t("ws_urgent_quotations")} subtitle={`${formatNumber(urgentQuotations.length, lang)} ${lang === "ar" ? "عرض" : "quotations"}`} padded={false}>
              <List empty={t("ws_none")} items={(urgentQuotations as any[]).map(q => ({ key: q.id, primary: q.related_opportunity_id ? oppName(q.related_opportunity_id) : "—", secondary: humanize(q.status), tone: q.valid_until && q.valid_until <= today ? "danger" : "attention" as any, label: t("ws_quotation_due"), right: q.valid_until ?? "—" }))} />
            </ChartFrame>
          </TabsContent>
        </Tabs>
      </section>
      <ActionDialog open={logOpen} onOpenChange={setLogOpen} title={t("ws_log_activity")} submitLabel={t("crm_add")} fields={[{ key: "type", type: "select", label: t("crm_filter_all_types"), required: true, defaultValue: "call", options: ACTIVITY_TYPES.map(a => ({ value: a, label: t(`activity_type_${a}` as never) })) }, { key: "opportunityId", type: "select", label: t("crm_linked_opportunities"), options: [{ value: "", label: "—" }, ...(myOpps as any[]).map(o => ({ value: o.id, label: o.project_name }))] }, { key: "summary", type: "text", label: t("activity_summary") }, { key: "draftContent", type: "textarea", label: t("activity_draft_body") }]} onSubmit={async v => { try { await logActivity({ type: v.type as ActivityType, opportunityId: v.opportunityId || null, summary: v.summary || undefined, draftContent: v.draftContent || undefined }); toast.success(t("crm_saved")); qc.invalidateQueries({ queryKey: ["workspace", uid] }); } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); } }} />
      <ActionDialog open={!!completeFor} onOpenChange={v => !v && setCompleteFor(null)} title={t("dialog_complete_title")} description={t("dialog_complete_desc")} submitLabel={t("action_complete")} fields={[{ key: "outcome", type: "textarea", label: t("field_outcome"), required: true }]} onSubmit={async v => { try { await completeFollowUp({ followUpId: completeFor!.id, opportunityId: completeFor!.oppId, outcome: v.outcome }); toast.success(t("toast_complete_ok" as never)); qc.invalidateQueries({ queryKey: ["workspace", uid] }); qc.invalidateQueries({ queryKey: ["all-followups"] }); } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); } }} />
      <AlertDialog open={draftOpen} onOpenChange={setDraftOpen}>
        <AlertDialogContent className="max-w-lg"><AlertDialogHeader><AlertDialogTitle>{lang === "ar" ? "مسودة المتابعة" : "Follow-up Draft"}</AlertDialogTitle><AlertDialogDescription>{lang === "ar" ? "مسودة مقترحة من الذكاء الاصطناعي — راجعها قبل الإرسال." : "AI-suggested draft — review before sending."}</AlertDialogDescription></AlertDialogHeader>
          <textarea value={draftContent} onChange={e => setDraftContent(e.target.value)} rows={10} className="mt-2 w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground focus:border-border-strong focus:outline-none" />
          <AlertDialogFooter><AlertDialogCancel>{lang === "ar" ? "إغلاق" : "Close"}</AlertDialogCancel><AlertDialogAction onClick={() => { if (draftContent) navigator.clipboard.writeText(draftContent).then(() => toast.success(lang === "ar" ? "تم النسخ" : "Copied to clipboard")).catch(() => {}); setDraftOpen(false); }}>{lang === "ar" ? "نسخ" : "Copy"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActionDialog open={!!rescheduleFor} onOpenChange={v => !v && setRescheduleFor(null)} title={lang === "ar" ? "إعادة جدولة المتابعة" : "Reschedule Follow-up"} description={lang === "ar" ? "اختر تاريخاً جديداً للمتابعة." : "Pick a new due date for this follow-up."} submitLabel={lang === "ar" ? "إعادة الجدولة" : "Reschedule"} fields={[{ key: "dueDate", type: "date", label: lang === "ar" ? "التاريخ الجديد" : "New date", required: true, defaultValue: rescheduleFor?.currentDate ?? "" }, { key: "notes", type: "textarea", label: lang === "ar" ? "ملاحظات (اختياري)" : "Notes (optional)" }]} onSubmit={async v => { try { await rescheduleFollowUp({ followUpId: rescheduleFor!.id, opportunityId: rescheduleFor!.oppId, dueDate: v.dueDate, notes: v.notes || undefined }); toast.success(lang === "ar" ? "تمت إعادة الجدولة." : "Follow-up rescheduled."); qc.invalidateQueries({ queryKey: ["workspace", uid] }); qc.invalidateQueries({ queryKey: ["all-followups"] }); } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); } }} />
      <Dialog open={rfqOpen} onOpenChange={v => { if (!rfqCreating) { setRfqOpen(v); if (!v) { setRfqStep(1); setRfqFoundContact(null); setRfqDedupChecked(false); } } }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t("ws_new_rfq")} — {rfqStep === 1 ? t("ws_rfq_step1") : t("ws_rfq_step2")}</DialogTitle></DialogHeader>
          {rfqStep === 1 && (<div className="space-y-3 py-2"><div className="space-y-1"><Label className="text-xs">{t("ws_rfq_contact_phone")}</Label><input type="tel" value={rfqForm.contactPhone} onChange={e => { setRfqForm(f => ({ ...f, contactPhone: e.target.value })); setRfqDedupChecked(false); setRfqFoundContact(null); }} onBlur={e => handleRfqPhoneBlur(e.target.value)} placeholder="+966..." className={inputCls} />{rfqDedupChecked && rfqFoundContact && <p className="text-[11px] text-emerald-400">✓ {t("ws_dedup_found")} {rfqFoundContact.name} ({rfqFoundContact.companyName})</p>}{rfqDedupChecked && !rfqFoundContact && <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "جهة اتصال جديدة" : "New contact"}</p>}</div><div className="space-y-1"><Label className="text-xs">{t("ws_rfq_contact")} *</Label><input type="text" value={rfqForm.contactName} onChange={e => setRfqForm(f => ({ ...f, contactName: e.target.value }))} className={inputCls} /></div><div className="space-y-1"><Label className="text-xs">{t("ws_rfq_company")} *</Label><input type="text" value={rfqForm.companyName} onChange={e => setRfqForm(f => ({ ...f, companyName: e.target.value }))} className={inputCls} /></div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" onClick={() => setRfqOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button><Button size="sm" onClick={() => setRfqStep(2)} disabled={!rfqForm.companyName}>{lang === "ar" ? "التالي" : "Next"} →</Button></div></div>)}
          {rfqStep === 2 && (<div className="space-y-3 py-2"><div className="space-y-1"><Label className="text-xs">{t("ws_rfq_project")} *</Label><textarea value={rfqForm.projectScope} onChange={e => setRfqForm(f => ({ ...f, projectScope: e.target.value }))} rows={2} className={inputCls} /></div><div className="space-y-1"><Label className="text-xs">{t("ws_rfq_due")} *</Label><input type="date" value={rfqForm.responseDueDate} onChange={e => setRfqForm(f => ({ ...f, responseDueDate: e.target.value }))} className={inputCls} /></div><div className="space-y-1"><Label className="text-xs">{t("ws_rfq_value")}</Label><input type="number" value={rfqForm.estimatedValue} onChange={e => setRfqForm(f => ({ ...f, estimatedValue: e.target.value }))} className={inputCls} /></div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" onClick={() => setRfqStep(1)}>← {lang === "ar" ? "السابق" : "Back"}</Button><Button size="sm" onClick={handleRfqSubmit} disabled={rfqCreating || !rfqForm.projectScope || !rfqForm.responseDueDate}>{rfqCreating ? (lang === "ar" ? "جارٍ الإنشاء…" : "Creating…") : (lang === "ar" ? "إنشاء الطلب" : "Create RFQ")}</Button></div></div>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────────────────

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
  const cls = tone === "positive" ? "border-emerald-500/20 bg-emerald-500/5" : tone === "attention" ? "border-amber/20 bg-amber/5" : "border-border/60 bg-surface-2/30";
  const valCls = tone === "positive" ? "text-emerald-200" : tone === "attention" ? "text-amber-light" : "text-foreground";
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
  const border = tone === "positive" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-200" : tone === "attention" ? "border-amber/25 bg-amber/5 text-amber-light" : "border-border/60 bg-surface-2/20 text-foreground";
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
