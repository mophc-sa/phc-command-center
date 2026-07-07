import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { Panel } from "@/components/phc/Panel";
import { MetricTile } from "@/components/phc/MetricTile";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { logActivity, type ActivityType } from "@/lib/activity-actions";
import { RecommendationCard } from "@/components/phc/RecommendationCard";
import { acceptRecommendation, dismissRecommendation } from "@/lib/recommendation-actions";

export const Route = createFileRoute("/_authenticated/my-workspace")({
  head: () => ({ meta: [{ title: "My Workspace — PHC" }, { name: "robots", content: "noindex" }] }),
  component: WorkspacePage,
});

const ACTIVITY_TYPES: ActivityType[] = [
  "call", "visit", "meeting", "note", "email_draft", "whatsapp_draft",
];

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function WorkspacePage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";
  const [logOpen, setLogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace", uid],
    enabled: !!uid,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [target, accounts, opps, followups, tasks, activities, myOppIds] = await Promise.all([
        supabase.from("sales_targets").select("*").eq("user_id", uid).eq("period_start", monthStart()).maybeSingle(),
        supabase.from("companies").select("id, name, company_type, account_status").eq("account_owner_id", uid).order("updated_at", { ascending: false }),
        supabase.from("opportunities").select("id, project_name, stage, pipeline_step, estimated_value_max, currency").eq("owner_id", uid).not("stage", "in", "(won,lost,archived)").order("updated_at", { ascending: false }),
        supabase.from("follow_ups").select("id, opportunity_id, due_date, status").eq("owner_id", uid).in("status", ["due", "overdue"]).order("due_date", { ascending: true }),
        supabase.from("tasks").select("id, title, due_date, status").eq("owner_id", uid).lte("due_date", today).neq("status", "done").order("due_date", { ascending: true }),
        supabase.from("activities").select("id, activity_type, summary, occurred_at, related_opportunity_id").eq("owner_id", uid).order("occurred_at", { ascending: false }).limit(8),
        supabase.from("opportunities").select("id").eq("owner_id", uid),
      ]);
      return {
        target: target.data,
        accounts: accounts.data ?? [],
        opps: opps.data ?? [],
        followups: followups.data ?? [],
        tasks: tasks.data ?? [],
        activities: activities.data ?? [],
        oppCount: (myOppIds.data ?? []).length,
      };
    },
  });

  const { data: myOpps = [] } = useQuery({
    queryKey: ["ws-opps-min", uid],
    enabled: !!uid,
    queryFn: async () => (await supabase.from("opportunities").select("id, project_name").eq("owner_id", uid).order("project_name")).data ?? [],
  });

  const { data: recs = [] } = useQuery({
    queryKey: ["ws-recs", uid],
    enabled: !!uid,
    queryFn: async () =>
      (
        await supabase
          .from("recommendations")
          .select("*")
          .eq("suggested_owner_id", uid)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const { data: wf } = useQuery({
    queryKey: ["ws-workflow", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [rfqs, tenders, verbal] = await Promise.all([
        supabase.from("rfqs").select("id").eq("sales_owner_id", uid).eq("status", "open"),
        supabase.from("tenders").select("id").eq("tender_owner_id", uid).not("tender_stage", "in", "(converted_to_jih,tender_lost_or_archived)"),
        supabase.from("opportunities").select("id").eq("owner_id", uid).eq("sales_stage", "verbally_awarded"),
      ]);
      return {
        rfqs: (rfqs.data ?? []).length,
        tenders: (tenders.data ?? []).length,
        verbal: (verbal.data ?? []).length,
      };
    },
  });

  if (isLoading || !data) return <EmptyState message={t("loading")} />;

  const pipelineValue = data.opps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0);
  const tg = data.target;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <SectionHeader
        title={t("ws_title")}
        hint={user?.email ?? ""}
        action={
          <button onClick={() => setLogOpen(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
            {t("ws_log_activity")}
          </button>
        }
      />

      {/* Targets */}
      <Panel title={t("ws_my_targets")}>
        {!tg ? (
          <div className="text-xs text-muted-foreground">{t("ws_no_target")}</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricTile label={t("ws_target_sales")} value={formatCurrency(tg.sales_target, lang, "SAR")} />
            <MetricTile label={t("ws_target_pipeline")} value={formatCurrency(pipelineValue, lang, "SAR")} hint={`${t("ws_of")} ${formatCurrency(tg.pipeline_target, lang, "SAR")}`} tone={pipelineValue < tg.pipeline_target ? "attention" : "neutral"} />
            <MetricTile label={t("ws_target_quotations")} value={formatNumber(tg.quotation_target, lang)} />
            <MetricTile label={t("ws_target_activities")} value={formatNumber(tg.activity_target, lang)} />
          </div>
        )}
      </Panel>

      {/* My sales workflow */}
      <Panel title={t("nav_rfq_jih")}>
        <div className="grid grid-cols-3 gap-4">
          <Link to="/rfq-jih"><MetricTile label={t("wf_new_rfq")} value={formatNumber(wf?.rfqs ?? 0, lang)} /></Link>
          <Link to="/tenders"><MetricTile label={t("nav_tenders")} value={formatNumber(wf?.tenders ?? 0, lang)} /></Link>
          <Link to="/award-queue"><MetricTile label={t("sstage_verbally_awarded")} value={formatNumber(wf?.verbal ?? 0, lang)} tone={wf?.verbal ? "attention" : "neutral"} /></Link>
        </div>
      </Panel>

      {recs.length > 0 ? (
        <Panel title={t("rec_title")} subtitle={t("rec_disclaimer")} tone="attention">
          <div className="grid gap-3 md:grid-cols-2">
            {recs.map((r: any) => (
              <RecommendationCard
                key={r.id}
                rec={r}
                onAccept={async () => {
                  try {
                    await acceptRecommendation(r);
                    toast.success(t("rec_accept"));
                    qc.invalidateQueries({ queryKey: ["ws-recs", uid] });
                    qc.invalidateQueries({ queryKey: ["approvals"] });
                  } catch (e) {
                    toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                  }
                }}
                onDismiss={async () => {
                  try {
                    await dismissRecommendation(r.id);
                    qc.invalidateQueries({ queryKey: ["ws-recs", uid] });
                  } catch (e) {
                    toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                  }
                }}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("ws_open_opportunities")} subtitle={String(data.opps.length)}>
          {data.opps.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t("ws_none")}</div>
          ) : (
            <ul className="space-y-2">
              {data.opps.map((o: any) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <Link to="/opportunities/$id" params={{ id: o.id }} className="truncate text-sm text-foreground hover:underline">{o.project_name}</Link>
                  <div className="flex items-center gap-2">
                    <StatusPill tone="muted">{humanize(o.pipeline_step ?? o.stage)}</StatusPill>
                    <span className="num text-xs text-muted-foreground" data-tabular="true">{formatCurrency(o.estimated_value_max, lang, o.currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("ws_my_accounts")} subtitle={String(data.accounts.length)}>
          {data.accounts.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t("ws_none")}</div>
          ) : (
            <ul className="space-y-2">
              {data.accounts.map((c: any) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link to="/accounts/$id" params={{ id: c.id }} className="truncate text-sm text-foreground hover:underline">{c.name}</Link>
                  <StatusPill tone={c.account_status === "active" ? "positive" : c.account_status === "pending_review" ? "attention" : "muted"}>
                    {t(`company_type_${c.company_type}` as never)}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("ws_overdue_followups")} subtitle={String(data.followups.length)} tone={data.followups.length > 0 ? "attention" : "default"}>
          {data.followups.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t("ws_none")}</div>
          ) : (
            <ul className="space-y-2">
              {data.followups.map((f: any) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to="/opportunities/$id" params={{ id: f.opportunity_id }} className="text-foreground hover:underline">{f.due_date}</Link>
                  <StatusPill tone={f.status === "overdue" ? "danger" : "attention"}>{humanize(f.status)}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("ws_tasks_today")} subtitle={String(data.tasks.length)}>
          {data.tasks.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t("ws_none")}</div>
          ) : (
            <ul className="space-y-2">
              {data.tasks.map((tk: any) => (
                <li key={tk.id} className="flex items-center justify-between gap-2 text-sm text-foreground">
                  <span className="truncate">{tk.title}</span>
                  <span className="text-xs text-muted-foreground">{tk.due_date}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={t("ws_recent_activity")} subtitle={String(data.activities.length)}>
        {data.activities.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t("ws_none")}</div>
        ) : (
          <ul className="space-y-2">
            {data.activities.map((a: any) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <StatusPill tone="muted">{t(`activity_type_${a.activity_type}` as never)}</StatusPill>
                  <span className="truncate text-foreground">{a.summary ?? "—"}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(a.occurred_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ActionDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        title={t("ws_log_activity")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "type", type: "select", label: t("crm_filter_all_types"), required: true, defaultValue: "call", options: ACTIVITY_TYPES.map((a) => ({ value: a, label: t(`activity_type_${a}` as never) })) },
          { key: "opportunityId", type: "select", label: t("crm_linked_opportunities"), options: [{ value: "", label: "—" }, ...myOpps.map((o: any) => ({ value: o.id, label: o.project_name }))] },
          { key: "summary", type: "text", label: t("activity_summary") },
          { key: "draftContent", type: "textarea", label: t("activity_draft_body") },
        ]}
        onSubmit={async (v) => {
          try {
            await logActivity({
              type: v.type as ActivityType,
              opportunityId: v.opportunityId || null,
              summary: v.summary || undefined,
              draftContent: v.draftContent || undefined,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["workspace", uid] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
