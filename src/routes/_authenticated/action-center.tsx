import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert, PlayCircle, Sparkles, PlayIcon, CheckIcon, XIcon, ArrowUpCircle, PauseCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import {
  startAction,
  completeAction,
  dismissAction,
  escalateAction,
  blockAction,
  runAutomations,
  QUEUE_ACTION_TYPES,
  ACTIVE_FLAG_STATUSES,
  type QueueActionType,
  type FlagStatus,
} from "@/lib/workflow-actions";
import { canManageSalesPipeline } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/action-center")({
  head: () => ({ meta: [{ title: "Sales Action Queue — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ActionCenter,
});

type FlagRow = {
  id: string;
  linked_record_type: string;
  linked_record_id: string;
  flag_kind: "action_required" | "risk";
  action_type: string | null;
  risk_flag: string | null;
  queue_action_type: QueueActionType | null;
  recommended_action: string | null;
  ai_generated: boolean;
  action_owner_id: string | null;
  due_date: string | null;
  priority: "A" | "B" | "C" | null;
  reason: string | null;
  status: FlagStatus;
  created_at: string;
};

const RELATED_ROUTE: Record<string, string> = {
  opportunity: "/opportunities",
  rfq: "/rfq-jih",
  tender: "/tenders",
  approval: "/approvals",
  quotation: "/quotations",
};

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function priorityRank(p: string | null | undefined): number {
  if (p === "A") return 0;
  if (p === "B") return 1;
  return 2;
}

function statusTone(s: FlagStatus): "neutral" | "attention" | "positive" | "muted" | "danger" {
  if (s === "completed" || s === "resolved") return "positive";
  if (s === "in_progress") return "attention";
  if (s === "escalated" || s === "blocked") return "danger";
  if (s === "dismissed") return "muted";
  return "neutral";
}

const STATUS_KEY: Record<string, string> = {
  open: "acst_open",
  in_progress: "acst_in_progress",
  completed: "acst_completed",
  resolved: "acst_resolved",
  dismissed: "acst_dismissed",
  escalated: "acst_escalated",
  blocked: "acst_blocked",
};

const TYPE_KEY: Record<string, string> = {
  follow_up_due: "acty_follow_up_due",
  follow_up_overdue: "acty_follow_up_overdue",
  missing_data: "acty_missing_data",
  rfq_review_needed: "acty_rfq_review_needed",
  tender_review_needed: "acty_tender_review_needed",
  approval_needed: "acty_approval_needed",
  quotation_follow_up: "acty_quotation_follow_up",
  no_next_action: "acty_no_next_action",
  inactive_tier_a_opportunity: "acty_inactive_tier_a_opportunity",
  contract_evidence_missing: "acty_contract_evidence_missing",
};

const RECORD_TYPE_KEY: Record<string, string> = {
  opportunity: "acrt_opportunity",
  rfq: "acrt_rfq",
  tender: "acrt_tender",
  approval: "acrt_approval",
  quotation: "acrt_quotation",
};

function ActionCenter() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "completed" | "dismissed" | "all">("active");
  const [typeFilter, setTypeFilter] = useState<"all" | QueueActionType>("all");
  const [dialog, setDialog] = useState<{ kind: "complete" | "dismiss" | "escalate" | "block"; flag: FlagRow } | null>(null);
  const isManager = canManageSalesPipeline(roles);
  const today = new Date().toISOString().slice(0, 10);

  const { data: flags = [], isLoading } = useQuery({
    queryKey: ["action-queue", tab],
    queryFn: async () => {
      let q = supabase.from("opportunity_flags").select("*").order("created_at", { ascending: false });
      if (tab === "active") q = q.in("status", ACTIVE_FLAG_STATUSES);
      else if (tab === "completed") q = q.in("status", ["completed", "resolved"]);
      else if (tab === "dismissed") q = q.eq("status", "dismissed");
      const { data } = await q;
      return (data ?? []) as unknown as FlagRow[];
    },
  });

  const ids = useMemo(() => {
    const byType: Record<string, string[]> = { opportunity: [], rfq: [], tender: [], approval: [], quotation: [] };
    for (const f of flags) {
      if (byType[f.linked_record_type]) byType[f.linked_record_type].push(f.linked_record_id);
    }
    return byType;
  }, [flags]);

  const ownerIds = useMemo(() => [...new Set(flags.map((f) => f.action_owner_id).filter(Boolean) as string[])], [flags]);

  const { data: relatedRecords } = useQuery({
    queryKey: ["action-queue-related", ids.opportunity.length, ids.rfq.length, ids.tender.length, ids.approval.length, ids.quotation.length],
    enabled: flags.length > 0,
    queryFn: async () => {
      const [opps, rfqs, tenders, approvals, quotations] = await Promise.all([
        ids.opportunity.length ? supabase.from("opportunities").select("id, project_name, owner_id, main_contractor, next_action, tier").in("id", ids.opportunity) : Promise.resolve({ data: [] }),
        ids.rfq.length ? supabase.from("rfqs").select("id, rfq_number").in("id", ids.rfq) : Promise.resolve({ data: [] }),
        ids.tender.length ? supabase.from("tenders").select("id, tender_name").in("id", ids.tender) : Promise.resolve({ data: [] }),
        ids.approval.length ? supabase.from("approvals").select("id, approval_type").in("id", ids.approval) : Promise.resolve({ data: [] }),
        ids.quotation.length ? supabase.from("quotations").select("id, quote_number").in("id", ids.quotation) : Promise.resolve({ data: [] }),
      ]);
      const map = new Map<string, { label: string; sub?: string; linkId?: string }>();
      for (const o of opps.data ?? []) map.set(`opportunity:${o.id}`, { label: o.project_name, sub: o.main_contractor ?? undefined, linkId: o.id });
      for (const r of rfqs.data ?? []) map.set(`rfq:${r.id}`, { label: r.rfq_number ?? r.id.slice(0, 8) });
      for (const tdr of tenders.data ?? []) map.set(`tender:${tdr.id}`, { label: tdr.tender_name });
      for (const a of approvals.data ?? []) map.set(`approval:${a.id}`, { label: humanize(a.approval_type) });
      for (const q of quotations.data ?? []) map.set(`quotation:${q.id}`, { label: q.quote_number });
      return map;
    },
  });

  const { data: owners } = useQuery({
    queryKey: ["action-queue-owners", ownerIds.join(",")],
    enabled: ownerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ownerIds);
      const map = new Map<string, string>();
      for (const p of data ?? []) map.set(p.id, p.full_name || p.email || p.id.slice(0, 8));
      return map;
    },
  });

  const filtered = useMemo(() => {
    const arr = typeFilter === "all" ? flags : flags.filter((f) => f.queue_action_type === typeFilter);
    return [...arr].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  }, [flags, typeFilter]);

  const activeFlags = useMemo(() => flags.filter((f) => (ACTIVE_FLAG_STATUSES as string[]).includes(f.status)), [flags]);
  const overdueCount = activeFlags.filter((f) => f.due_date && f.due_date < today).length;
  const escalatedBlockedCount = activeFlags.filter((f) => f.status === "escalated" || f.status === "blocked").length;
  const aiCount = activeFlags.filter((f) => f.ai_generated).length;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["action-queue"] });

  async function handleStart(f: FlagRow) {
    try {
      await startAction(f.id);
      invalidate();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }

  const dialogFields: DialogField[] =
    dialog?.kind === "complete"
      ? [{ key: "note", type: "textarea", label: t("ac_complete_note") }]
      : dialog?.kind === "dismiss"
        ? [{ key: "reason", type: "textarea", label: t("ac_dismiss_reason"), required: true }]
        : dialog?.kind === "escalate"
          ? [{ key: "note", type: "textarea", label: t("ac_escalate_note") }]
          : [{ key: "reason", type: "textarea", label: t("ac_block_reason"), required: true }];

  async function handleDialogSubmit(values: Record<string, string>) {
    if (!dialog) return;
    try {
      if (dialog.kind === "complete") await completeAction(dialog.flag.id, values.note);
      else if (dialog.kind === "dismiss") await dismissAction(dialog.flag.id, values.reason);
      else if (dialog.kind === "escalate") await escalateAction(dialog.flag.id, values.note);
      else await blockAction(dialog.flag.id, values.reason);
      invalidate();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
      throw e;
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={lang === "ar" ? "أولوية العمل" : "Priority work"}
        title={t("ac_title")}
        description={t("ac_subtitle")}
        actions={
          isManager ? (
            <button
              onClick={async () => {
                try {
                  const r: any = await runAutomations();
                  toast.success(`${t("wf_run_automations")}: ${r.raised}`);
                  invalidate();
                } catch (e) {
                  toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                }
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 bg-surface/60 px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <PlayCircle className="h-3.5 w-3.5" /> {t("wf_run_automations")}
            </button>
          ) : null
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <KpiCard label={t("ac_kpi_open")} value={formatNumber(activeFlags.length, lang)} hint={lang === "ar" ? "بانتظار الفريق" : "Waiting on the team"} />
        <KpiCard label={t("ac_kpi_overdue")} value={formatNumber(overdueCount, lang)} hint={lang === "ar" ? "تجاوزت التاريخ" : "Past due date"} trend={overdueCount > 0 ? "down" : "flat"} />
        <KpiCard label={t("ac_kpi_escalated")} value={formatNumber(escalatedBlockedCount, lang)} hint={lang === "ar" ? "تحتاج تدخلاً" : "Needs intervention"} trend={escalatedBlockedCount > 0 ? "down" : "flat"} />
        <KpiCard label={t("ac_kpi_ai")} value={formatNumber(aiCount, lang)} hint={lang === "ar" ? "من محرك الإجراءات" : "From the action engine"} />
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(["active", "completed", "dismissed", "all"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                tab === k
                  ? "border-amber/40 bg-amber/10 text-amber-light"
                  : "border-border/70 bg-surface/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`ac_tab_${k}` as never)}
            </button>
          ))}
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as "all" | QueueActionType)}
        >
          <SelectTrigger className="h-8 w-auto min-w-[10rem] border-border/70 bg-surface/60 text-[11px] text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("crm_filter_all_types")}</SelectItem>
            {QUEUE_ACTION_TYPES.map((qt) => (
              <SelectItem key={qt} value={qt}>{t(TYPE_KEY[qt] as never)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        tab === "active" ? (
          <EmptyState
            icon={CheckIcon}
            title={t("empty_title_action_center")}
            description={t("empty_desc_action_center")}
          />
        ) : (
          <EmptyState message={t("wf_no_records")} compact />
        )
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {filtered.map((f) => {
            const high = f.priority === "A";
            const related = relatedRecords?.get(`${f.linked_record_type}:${f.linked_record_id}`);
            const ownerName = f.action_owner_id ? owners?.get(f.action_owner_id) : undefined;
            const overdue = !!f.due_date && f.due_date < today && (ACTIVE_FLAG_STATUSES as string[]).includes(f.status);
            const active = (ACTIVE_FLAG_STATUSES as string[]).includes(f.status);
            const listPath = RELATED_ROUTE[f.linked_record_type];
            return (
              <li key={f.id} className="border-t border-border/60 first:border-t-0">
                <div className="grid grid-cols-[3px_minmax(0,1fr)_auto] items-stretch">
                  <div className={high ? "bg-amber/70" : f.flag_kind === "risk" ? "bg-red-500/50" : "bg-transparent"} />
                  <div className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={f.flag_kind === "risk" ? "danger" : "attention"}>
                        {f.flag_kind === "risk" ? <ShieldAlert className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {f.queue_action_type ? t(TYPE_KEY[f.queue_action_type] as never) : humanize(f.action_type ?? f.risk_flag ?? f.flag_kind)}
                      </StatusPill>
                      <StatusPill tone={statusTone(f.status)}>{t((STATUS_KEY[f.status] ?? "acst_open") as never)}</StatusPill>
                      {f.priority ? <StatusPill tone={high ? "attention" : "muted"}>{t("label_tier")} {f.priority}</StatusPill> : null}
                      {f.ai_generated ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber-light">
                          <Sparkles className="h-2.5 w-2.5" /> {t("ac_ai_badge")}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">{t((RECORD_TYPE_KEY[f.linked_record_type] ?? "") as never) || humanize(f.linked_record_type)}</span>
                      {f.due_date ? (
                        <span
                          className={`inline-flex items-center gap-1 num text-[11px] ${overdue ? "font-medium text-red-400" : "text-muted-foreground"}`}
                          data-tabular="true"
                        >
                          {overdue ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                          {overdue ? t("urgency_overdue") : t("ac_due")}: {f.due_date}
                        </span>
                      ) : null}
                    </div>
                    {related ? (
                      f.linked_record_type === "opportunity" && related.linkId ? (
                        <Link to="/opportunities/$id" params={{ id: related.linkId }} className="mt-1.5 block truncate text-[13px] font-medium text-foreground hover:underline">
                          {related.label}
                        </Link>
                      ) : listPath ? (
                        <Link to={listPath as any} className="mt-1.5 block truncate text-[13px] font-medium text-foreground hover:underline">
                          {related.label}
                        </Link>
                      ) : (
                        <div className="mt-1.5 truncate text-[13px] font-medium text-foreground">{related.label}</div>
                      )
                    ) : null}
                    {f.reason ? <div className="mt-1 text-[12px] text-muted-foreground">{f.reason}</div> : null}
                    {f.recommended_action ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        <span className="text-amber-light">{t("ac_recommended_action")}:</span> {f.recommended_action}
                      </div>
                    ) : null}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("ac_owner")}: {ownerName ?? t("ac_unassigned")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 pe-4">
                    {active ? (
                      <>
                        {f.status === "open" ? (
                          <button
                            onClick={() => handleStart(f)}
                            aria-label={t("ac_start")}
                            title={t("ac_start")}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            <PlayIcon className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          onClick={() => setDialog({ kind: "complete", flag: f })}
                          aria-label={t("ac_complete")}
                          title={t("ac_complete")}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 transition-colors hover:bg-emerald-500/20"
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                        </button>
                        {f.status !== "escalated" ? (
                          <button
                            onClick={() => setDialog({ kind: "escalate", flag: f })}
                            aria-label={t("ac_escalate")}
                            title={t("ac_escalate")}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            <ArrowUpCircle className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {f.status !== "blocked" ? (
                          <button
                            onClick={() => setDialog({ kind: "block", flag: f })}
                            aria-label={t("ac_block")}
                            title={t("ac_block")}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            <PauseCircle className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          onClick={() => setDialog({ kind: "dismiss", flag: f })}
                          aria-label={t("ac_dismiss")}
                          title={t("ac_dismiss")}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/70 bg-background/40 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog ? (
        <ActionDialog
          open={!!dialog}
          onOpenChange={(v) => !v && setDialog(null)}
          title={t(
            (dialog.kind === "complete"
              ? "ac_complete_title"
              : dialog.kind === "dismiss"
                ? "ac_dismiss_title"
                : dialog.kind === "escalate"
                  ? "ac_escalate_title"
                  : "ac_block_title") as never,
          )}
          fields={dialogFields}
          submitLabel={t(
            (dialog.kind === "complete" ? "ac_complete" : dialog.kind === "dismiss" ? "ac_dismiss" : dialog.kind === "escalate" ? "ac_escalate" : "ac_block") as never,
          )}
          destructive={dialog.kind === "dismiss" || dialog.kind === "block"}
          onSubmit={handleDialogSubmit}
        />
      ) : null}
    </div>
  );
}
