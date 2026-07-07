import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, FileText, AlertTriangle, CheckCircle2, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import {
  createQuotation,
  updateQuotationStatus,
  type QuotationStatus,
} from "@/lib/sales-actions";

export const Route = createFileRoute("/_authenticated/quotations")({
  head: () => ({
    meta: [{ title: "Quotations — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: QuotationsPage,
});

const STATUSES: QuotationStatus[] = [
  "draft",
  "under_internal_review",
  "approved_for_submission",
  "submitted",
  "follow_up",
  "negotiation",
  "revised",
  "won",
  "lost",
  "expired",
];

const CLOSED: QuotationStatus[] = ["won", "lost", "expired"];

function statusTone(s: QuotationStatus): "positive" | "attention" | "neutral" | "danger" {
  if (s === "won") return "positive";
  if (s === "lost") return "danger";
  if (s === "expired") return "attention";
  return "neutral";
}

function QuotationsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFor, setStatusFor] = useState<{ id: string; oppId: string } | null>(null);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotations"],
    queryFn: async () =>
      (
        await supabase
          .from("quotations")
          .select("*, opportunities(id, project_name, client)")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const { data: opps = [] } = useQuery({
    queryKey: ["opps-for-quote"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, project_name")
          .not("stage", "in", "(won,lost,archived)")
          .order("project_name")
      ).data ?? [],
  });

  const now = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);

  const filtered = useMemo(() => {
    if (filter === "all") return quotes;
    return quotes.filter((q: any) =>
      filter === "closed"
        ? CLOSED.includes(q.status)
        : !CLOSED.includes(q.status),
    );
  }, [quotes, filter]);

  const kpis = useMemo(() => {
    const open = quotes.filter((q: any) => !CLOSED.includes(q.status));
    const openValue = open.reduce((s: number, q: any) => s + (q.value ?? 0), 0);
    const expiring = open.filter(
      (q: any) => q.valid_until && new Date(q.valid_until) >= now && new Date(q.valid_until) < soon,
    ).length;
    const won = quotes.filter((q: any) => q.status === "won");
    const wonValue = won.reduce((s: number, q: any) => s + (q.value ?? 0), 0);
    return { openCount: open.length, openValue, expiring, wonValue, wonCount: won.length };
  }, [quotes]);

  const statusLabel = (s: QuotationStatus) => t(`quote_status_${s}` as never);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("nav_commercial" as never) || "Commercial"}
        title={t("nav_quotations")}
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("action_new_quotation")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={lang === "ar" ? "مفتوحة" : "Open quotations"} value={kpis.openCount} icon={<FileText className="h-3.5 w-3.5" />} />
        <KpiCard label={lang === "ar" ? "قيمة المفتوحة" : "Open value"} value={formatCurrency(kpis.openValue, lang)} icon={<Wallet className="h-3.5 w-3.5" />} />
        <KpiCard label={t("expiring_soon")} value={kpis.expiring} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <KpiCard label={lang === "ar" ? "قيمة الفائزة" : "Won value"} value={formatCurrency(kpis.wonValue, lang)} hint={`${kpis.wonCount}`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
      </div>

      <div className="mb-4 flex gap-2">
        {(["open", "closed", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? "rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light"
                : "rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            {f === "open"
              ? lang === "ar" ? "مفتوحة" : "Open"
              : f === "closed"
                ? lang === "ar" ? "مغلقة" : "Closed"
                : t("timeline_all")}
          </button>
        ))}
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("empty_quotations")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {filtered.map((q: any) => {
            const expired =
              q.valid_until && !CLOSED.includes(q.status) && new Date(q.valid_until) < new Date();
            const expiringSoon =
              !expired &&
              q.valid_until &&
              !CLOSED.includes(q.status) &&
              new Date(q.valid_until) < soon;
            return (
              <div
                key={q.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/50 px-5 py-4 first:border-t-0 hover:bg-surface"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-xs font-medium text-foreground" data-tabular="true">
                      {q.quote_number} · v{q.version}
                    </span>
                    <StatusPill tone={statusTone(q.status)}>{statusLabel(q.status)}</StatusPill>
                    {expired ? (
                      <StatusPill tone="danger">{t("expired")}</StatusPill>
                    ) : expiringSoon ? (
                      <StatusPill tone="attention">{t("expiring_soon")}</StatusPill>
                    ) : null}
                  </div>
                  {q.opportunities?.project_name ? (
                    <Link
                      to="/opportunities/$id"
                      params={{ id: q.opportunities.id }}
                      className="mt-1 block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {q.opportunities.project_name}
                      {q.opportunities.client ? (
                        <span className="text-muted-foreground"> — {q.opportunities.client}</span>
                      ) : null}
                    </Link>
                  ) : null}
                  {q.win_loss_reason ? (
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {t("label_win_loss_reason")}: {q.win_loss_reason}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-end">
                    <div className="num text-sm font-semibold text-foreground" data-tabular="true">
                      {formatCurrency(q.value, lang, q.currency)}
                    </div>
                    {q.valid_until ? (
                      <div className="num text-[11px] text-muted-foreground" data-tabular="true">
                        {t("label_valid_until")}: {q.valid_until}
                      </div>
                    ) : null}
                  </div>
                  {!CLOSED.includes(q.status) ? (
                    <button
                      onClick={() =>
                        setStatusFor({ id: q.id, oppId: q.related_opportunity_id })
                      }
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t("action_change_status")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("dialog_new_quotation_title")}
        description={t("dialog_new_quotation_desc")}
        submitLabel={t("action_new_quotation")}
        fields={[
          {
            key: "opportunityId",
            type: "select",
            label: t("field_opportunity"),
            required: true,
            options: opps.map((o: any) => ({ value: o.id, label: o.project_name })),
          },
          { key: "quoteNumber", type: "text", label: t("field_quote_number"), required: true },
          { key: "value", type: "text", label: t("field_value") },
          { key: "issuedDate", type: "date", label: t("field_issued_date") },
          { key: "validUntil", type: "date", label: t("field_valid_until") },
          { key: "notes", type: "textarea", label: t("field_notes") },
        ]}
        onSubmit={async (v) => {
          try {
            await createQuotation({
              opportunityId: v.opportunityId,
              quoteNumber: v.quoteNumber,
              value: v.value ? Number(v.value) : null,
              issuedDate: v.issuedDate || null,
              validUntil: v.validUntil || null,
              notes: v.notes || undefined,
            });
            toast.success(t("toast_quotation_created"));
            qc.invalidateQueries({ queryKey: ["quotations"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!statusFor}
        onOpenChange={(v) => !v && setStatusFor(null)}
        title={t("dialog_quote_status_title")}
        description={t("dialog_quote_status_desc")}
        submitLabel={t("action_change_status")}
        fields={[
          {
            key: "status",
            type: "select",
            label: t("field_new_status"),
            required: true,
            options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
          },
          { key: "reason", type: "textarea", label: t("field_reason") },
        ]}
        onSubmit={async (v) => {
          try {
            await updateQuotationStatus({
              quotationId: statusFor!.id,
              opportunityId: statusFor!.oppId,
              status: v.status as QuotationStatus,
              reason: v.reason || undefined,
            });
            toast.success(t("toast_quotation_updated"));
            qc.invalidateQueries({ queryKey: ["quotations"] });
            qc.invalidateQueries({ queryKey: ["opps"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
