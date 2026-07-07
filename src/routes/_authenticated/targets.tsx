import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { upsertSalesTarget } from "@/lib/sales-actions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/targets")({
  head: () => ({
    meta: [{ title: "Targets & Performance — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: TargetsPage,
});

function monthStart(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function ProgressRow({
  label,
  actual,
  target,
  money,
  lang,
}: {
  label: string;
  actual: number;
  target: number;
  money?: boolean;
  lang: "en" | "ar";
}) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const fmt = (n: number) => (money ? formatCurrency(n, lang) : formatNumber(n, lang));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="num text-foreground" data-tabular="true">
          {fmt(actual)} / {fmt(target)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-amber")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TargetsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isManager = hasRole("ceo") || hasRole("sales_manager");
  const [setOpen, setSetOpen] = useState(false);
  const period = monthStart();

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ["targets", period],
    queryFn: async () =>
      (
        await supabase
          .from("sales_targets")
          .select("*")
          .eq("period_type", "monthly")
          .eq("period_start", period)
      ).data ?? [],
  });

  const { data: members = [] } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () =>
      (
        await supabase
          .from("profiles")
          .select("id, full_name, email")
          .order("full_name", { ascending: true, nullsFirst: false })
      ).data ?? [],
  });

  const { data: opps = [] } = useQuery({
    queryKey: ["opps-for-targets"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, owner_id, stage, quotation_value, estimated_value_max, updated_at")
      ).data ?? [],
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["quotes-for-targets"],
    queryFn: async () =>
      (
        await supabase
          .from("quotations")
          .select("id, owner_id, status, value, updated_at")
      ).data ?? [],
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["fu-for-targets"],
    queryFn: async () =>
      (
        await supabase
          .from("follow_ups")
          .select("id, owner_id, status, last_contact_at")
          .eq("status", "completed")
      ).data ?? [],
  });

  const rows = useMemo(() => {
    const periodDate = new Date(period);
    const inPeriod = (iso: string | null) => iso && new Date(iso) >= periodDate;
    return targets.map((tg: any) => {
      const member = members.find((m: any) => m.id === tg.user_id);
      const mine = (arr: any[], key = "owner_id") => arr.filter((r) => r[key] === tg.user_id);
      const won = mine(opps)
        .filter((o: any) => o.stage === "won" && inPeriod(o.updated_at))
        .reduce((s: number, o: any) => s + (o.quotation_value ?? o.estimated_value_max ?? 0), 0);
      const pipeline = mine(opps)
        .filter((o: any) => !["won", "lost", "archived"].includes(o.stage))
        .reduce((s: number, o: any) => s + (o.quotation_value ?? o.estimated_value_max ?? 0), 0);
      const submitted = mine(quotes).filter(
        (q: any) => !["draft", "under_internal_review"].includes(q.status) && inPeriod(q.updated_at),
      ).length;
      const activities = mine(followUps).filter((f: any) => inPeriod(f.last_contact_at)).length;
      return { target: tg, member, actuals: { won, pipeline, submitted, activities } };
    });
  }, [targets, members, opps, quotes, followUps, period]);

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_targets")}
        hint={t("targets_intro")}
        action={
          isManager ? (
            <button
              onClick={() => setSetOpen(true)}
              className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20"
            >
              {t("action_set_target")}
            </button>
          ) : undefined
        }
      />

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("empty_targets")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ target: tg, member, actuals }) => (
            <div key={tg.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <div className="truncate text-sm font-semibold text-foreground">
                  {member?.full_name ?? member?.email ?? "—"}
                </div>
                <div className="num text-xs text-muted-foreground" data-tabular="true">
                  {tg.period_start}
                </div>
              </div>
              <div className="space-y-4">
                <ProgressRow
                  label={t("target_sales")}
                  actual={actuals.won}
                  target={Number(tg.sales_target)}
                  money
                  lang={lang}
                />
                <ProgressRow
                  label={t("target_pipeline")}
                  actual={actuals.pipeline}
                  target={Number(tg.pipeline_target)}
                  money
                  lang={lang}
                />
                <ProgressRow
                  label={t("target_quotations")}
                  actual={actuals.submitted}
                  target={tg.quotation_target}
                  lang={lang}
                />
                <ProgressRow
                  label={t("target_activities")}
                  actual={actuals.activities}
                  target={tg.activity_target}
                  lang={lang}
                />
              </div>
              {tg.notes ? (
                <div className="mt-4 text-xs text-muted-foreground">{tg.notes}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ActionDialog
        open={setOpen}
        onOpenChange={setSetOpen}
        title={t("dialog_set_target_title")}
        description={t("dialog_set_target_desc")}
        submitLabel={t("action_set_target")}
        fields={[
          {
            key: "userId",
            type: "select",
            label: t("field_member"),
            required: true,
            options: members.map((m: any) => ({
              value: m.id,
              label: m.full_name ?? m.email ?? m.id,
            })),
          },
          {
            key: "periodStart",
            type: "date",
            label: t("field_period_start"),
            required: true,
            defaultValue: period,
          },
          { key: "salesTarget", type: "text", label: t("field_sales_target"), required: true },
          { key: "pipelineTarget", type: "text", label: t("field_pipeline_target"), required: true },
          { key: "quotationTarget", type: "text", label: t("field_quotation_target"), required: true },
          { key: "activityTarget", type: "text", label: t("field_activity_target"), required: true },
          { key: "notes", type: "textarea", label: t("field_notes") },
        ]}
        onSubmit={async (v) => {
          try {
            await upsertSalesTarget({
              userId: v.userId,
              periodType: "monthly",
              periodStart: v.periodStart,
              salesTarget: Number(v.salesTarget) || 0,
              pipelineTarget: Number(v.pipelineTarget) || 0,
              quotationTarget: Number(v.quotationTarget) || 0,
              activityTarget: Number(v.activityTarget) || 0,
              notes: v.notes || undefined,
            });
            toast.success(t("toast_target_saved"));
            qc.invalidateQueries({ queryKey: ["targets", period] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
