import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, formatCurrency, formatNumber, type Lang } from "@/lib/i18n";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import {
  requestReview,
  scheduleFollowUp,
  assignOwner,
  escalateOpportunity,
  completeFollowUp,
  listTeamMembers,
  decideApproval,
  updateOpportunityStage,
} from "@/lib/opportunity-actions";
import { ArrowLeft, ArrowRight, ExternalLink, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/opportunities/$id")({
  head: () => ({
    meta: [
      { title: "Opportunity — PHC" },
      { name: "description", content: "Opportunity detail with evidence and decisions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OpportunityDetail,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(d: string | null | undefined, lang: Lang) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function recToTone(r: string | null | undefined): "attention" | "positive" | "danger" | "muted" {
  switch (r) {
    case "approve":
    case "advance":
    case "quote":
      return "positive";
    case "hold":
    case "review":
    case "escalate":
      return "attention";
    case "exclude":
    case "reject":
      return "danger";
    default:
      return "muted";
  }
}

type ActionKind = "review" | "approve" | "schedule" | "assign" | "escalate" | null;

function OpportunityDetail() {
  const { id } = Route.useParams();
  const { t, lang, dir } = useI18n();
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionKind>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [decideFor, setDecideFor] = useState<{ id: string; kind: "approved" | "returned" } | null>(
    null,
  );

  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["opp", id] });
    qc.invalidateQueries({ queryKey: ["opp-fu", id] });
    qc.invalidateQueries({ queryKey: ["opp-app", id] });
    qc.invalidateQueries({ queryKey: ["cc-metrics"] });
    qc.invalidateQueries({ queryKey: ["all-followups"] });
    qc.invalidateQueries({ queryKey: ["approvals"] });
  };

  const runSafe = async (fn: () => Promise<unknown>, okKey: Parameters<typeof t>[0]) => {
    try {
      await fn();
      toast.success(t(okKey));
      invalidate();
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  };


  const oppQ = useQuery({
    queryKey: ["opp", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("opportunities").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data as any;
    },
  });

  const stakeholdersQ = useQuery({
    queryKey: ["opp-stake", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("stakeholders")
        .select("*")
        .eq("opportunity_id", id)
        .order("contact_order", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const evidenceQ = useQuery({
    queryKey: ["opp-ev", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("evidence_sources")
        .select("*")
        .eq("related_opportunity_id", id)
        .order("source_date", { ascending: false, nullsFirst: false });
      return data ?? [];
    },
  });

  const followUpsQ = useQuery({
    queryKey: ["opp-fu", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("follow_ups")
        .select("*")
        .eq("opportunity_id", id)
        .order("due_date", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const approvalsQ = useQuery({
    queryKey: ["opp-app", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("approvals")
        .select("*")
        .eq("related_opportunity_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (oppQ.isLoading) {
    return <div className="mx-auto max-w-7xl text-sm text-muted-foreground">{t("loading")}</div>;
  }
  const o = oppQ.data;
  if (!o) {
    return (
      <div className="mx-auto max-w-7xl">
        <EmptyState message={t("not_found")} />
      </div>
    );
  }

  const val = o.quotation_value ?? o.estimated_value_max ?? o.estimated_value_min;
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const recTone = recToTone(o.agent_recommendation);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Link to="/opportunities" className="inline-flex items-center gap-1.5 hover:text-foreground">
          <BackIcon className="h-3.5 w-3.5" />
          {t("nav_opportunities")}
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{o.project_name}</span>
      </div>

      {/* 1. ALERT — headline + recommendation */}
      <Panel
        title={t("section_alert")}
        tone={recTone === "attention" || recTone === "danger" ? "attention" : "default"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={o.tier === "A" ? "attention" : "neutral"}>
              {t("label_tier")} {o.tier}
            </StatusPill>
            <StatusPill tone="muted">{humanize(o.stage)}</StatusPill>
            {o.agent_recommendation ? (
              <StatusPill tone={recTone}>{humanize(o.agent_recommendation)}</StatusPill>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{o.project_name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {o.client ?? "—"}
              {o.main_contractor ? ` · ${o.main_contractor}` : ""}
              {o.location ? ` · ${o.location}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <DataField
              label={t("label_quotation")}
              value={formatCurrency(val, lang, o.currency)}
              mono
            />
            <DataField
              label={t("label_value_range")}
              value={
                o.estimated_value_min || o.estimated_value_max
                  ? `${formatCurrency(o.estimated_value_min, lang, o.currency)} – ${formatCurrency(
                      o.estimated_value_max,
                      lang,
                      o.currency,
                    )}`
                  : "—"
              }
              mono
            />
            <DataField label={t("label_next_action")} value={o.next_action} />
            <DataField label={t("label_due")} value={fmtDate(o.next_action_due, lang)} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <ActionButton primary onClick={() => setAction("review")}>{t("action_review")}</ActionButton>
            <ActionButton onClick={() => setAction("approve")}>{t("action_approve")}</ActionButton>
            <ActionButton onClick={() => setAction("schedule")}>{t("action_schedule")}</ActionButton>
            <ActionButton onClick={() => setAction("assign")}>{t("action_assign")}</ActionButton>
            <ActionButton onClick={() => setAction("escalate")}>{t("action_escalate")}</ActionButton>
          </div>
        </div>
      </Panel>

      {/* 2. QUALIFICATION */}
      <Panel title={t("section_qualification")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DataField label={t("label_project_stage")} value={humanize(o.project_stage)} />
          <DataField label={t("label_package_status")} value={humanize(o.signage_package_status)} />
          <DataField
            label={t("label_package_confidence")}
            value={humanize(o.signage_package_confidence)}
          />
          <DataField
            label={t("label_budget_confirmed")}
            value={o.package_budget_confirmed ? t("yes") : t("no")}
          />
          <DataField
            label={t("label_contractor_confirmed")}
            value={o.main_contractor_confirmed ? t("yes") : t("no")}
          />
          <DataField label={t("label_decision_maker")} value={o.contractor_decision_maker} />
          <DataField label={t("label_prequal")} value={o.prequalification_status} />
          <DataField label={t("label_strategic_value")} value={o.strategic_value} />
          <DataField label={t("label_sector")} value={o.sector} />
        </div>
      </Panel>

      {/* 3. STAKEHOLDERS */}
      <Panel title={t("section_stakeholders")}>
        {stakeholdersQ.data && stakeholdersQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {stakeholdersQ.data.map((s: any) => (
              <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[s.role, s.organization].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {s.email || s.phone ? (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {[s.email, s.phone].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </div>
                <div className="text-right rtl:text-left">
                  {s.contact_confidence ? (
                    <StatusPill
                      tone={
                        s.contact_confidence === "high"
                          ? "positive"
                          : s.contact_confidence === "low"
                            ? "muted"
                            : "neutral"
                      }
                    >
                      {humanize(s.contact_confidence)}
                    </StatusPill>
                  ) : null}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {fmtDate(s.last_interaction_at, lang)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="—" />
        )}
      </Panel>

      {/* 4. EVIDENCE */}
      <Panel
        title={t("section_evidence")}
        subtitle={`${formatNumber(evidenceQ.data?.length ?? 0, lang)} · ${humanize(o.source_confidence)}`}
      >
        {evidenceQ.data && evidenceQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {evidenceQ.data.map((e: any) => (
              <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-3">
                <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{e.source_title || e.source_type}</div>
                  {e.extracted_summary ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {e.extracted_summary}
                    </div>
                  ) : null}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{humanize(e.source_type)}</span>
                    <span>·</span>
                    <span>{fmtDate(e.source_date, lang)}</span>
                    {e.confidence_level ? (
                      <>
                        <span>·</span>
                        <span>{humanize(e.confidence_level)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {e.source_url ? (
                  <a
                    href={e.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message={t("empty_evidence")} />
        )}
      </Panel>

      {/* 5. FOLLOW-UPS */}
      <Panel title={t("section_follow_ups")}>
        {followUpsQ.data && followUpsQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {followUpsQ.data.map((f: any) => {
              const overdue =
                f.due_date && f.status !== "completed" && new Date(f.due_date) < new Date();
              return (
                <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">
                      {humanize(f.channel)} · {humanize(f.cadence_tier)}
                    </div>
                    {f.notes ? (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.notes}</div>
                    ) : null}
                  </div>
                  <div className="text-right rtl:text-left">
                    <StatusPill
                      tone={
                        f.status === "completed"
                          ? "positive"
                          : overdue
                            ? "attention"
                            : "neutral"
                      }
                    >
                      {overdue ? "Overdue" : humanize(f.status)}
                    </StatusPill>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t("label_due")}: {fmtDate(f.due_date, lang)}
                    </div>
                    {f.status !== "completed" ? (
                      <button
                        onClick={() => setCompleteId(f.id)}
                        className="mt-1.5 text-[11px] text-amber-light hover:underline"
                      >
                        {t("action_complete")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState message={t("empty_follow_ups")} />
        )}
      </Panel>

      {/* 6. APPROVALS & DECISIONS */}
      <Panel title={t("section_approvals")}>
        {approvalsQ.data && approvalsQ.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {approvalsQ.data.map((a: any) => (
              <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{humanize(a.approval_type)}</div>
                  {a.decision_notes ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {a.decision_notes}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {fmtDate(a.decided_at ?? a.created_at, lang)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 rtl:items-start">
                  {a.recommendation ? (
                    <StatusPill tone="muted">{humanize(a.recommendation)}</StatusPill>
                  ) : null}
                  <StatusPill
                    tone={
                      a.decision === "approved" || a.status === "approved"
                        ? "positive"
                        : a.status === "returned"
                          ? "danger"
                          : "attention"
                    }
                  >
                    {humanize(a.decision ?? a.status)}
                  </StatusPill>
                  {a.status === "pending" ? (
                    <div className="mt-1 flex gap-2 text-[11px]">
                      <button
                        onClick={() => setDecideFor({ id: a.id, kind: "approved" })}
                        className="text-amber-light hover:underline"
                      >
                        {t("action_approve")}
                      </button>
                      <button
                        onClick={() => setDecideFor({ id: a.id, kind: "returned" })}
                        className="text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {t("action_return")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message={t("empty_approvals")} />
        )}
      </Panel>

      {/* 7. REASONING */}
      <Panel title={t("section_reasoning")}>
        <div className="grid gap-4">
          <DataField label={t("label_recommendation")} value={humanize(o.agent_recommendation)} />
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("label_reasoning")}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {o.agent_reasoning || "—"}
            </p>
          </div>
          {o.management_review_reason ? (
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Management review
              </div>
              <p className="mt-2 text-sm text-foreground">{o.management_review_reason}</p>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function ActionButton({
  children,
  primary,
  onClick,
}: {
  children: React.ReactNode;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
        (primary
          ? "border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20"
          : "border-border bg-surface text-foreground hover:bg-muted")
      }
    >
      {children}
    </button>
  );
}
